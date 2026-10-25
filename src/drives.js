const { exec } = require('child_process');
const fs = require('fs');
const util = require('util');
const execPromise = util.promisify(exec);

function formatBytes(bytes, decimals = 2) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

async function getWindowsDrives() {
  try {
    const cmd = `powershell -NoProfile -Command "Get-CimInstance -ClassName Win32_LogicalDisk | Where-Object DriveType -eq 3 | Select-Object DeviceID, VolumeName, Size, FreeSpace | ConvertTo-Json -Compress"`;
    const { stdout } = await execPromise(cmd, { windowsHide: true, timeout: 5000 });
    if (!stdout.trim()) return [];

    let parsed = JSON.parse(stdout.trim());
    if (!Array.isArray(parsed)) {
      parsed = [parsed];
    }

    return parsed.map(drive => {
      const size = Number(drive.Size || 0);
      const free = Number(drive.FreeSpace || 0);
      const used = size - free;
      const usedPercent = size > 0 ? Math.round((used / size) * 100) : 0;
      const freePercent = 100 - usedPercent;
      const isLowSpace = freePercent <= 15 || free < 20 * 1024 * 1024 * 1024;

      return {
        letter: drive.DeviceID,
        label: drive.VolumeName ? `${drive.DeviceID} (${drive.VolumeName})` : drive.DeviceID,
        name: drive.VolumeName || 'Local Disk',
        totalBytes: size,
        freeBytes: free,
        usedBytes: used,
        usedPercent,
        freePercent,
        isLowSpace,
        totalFormatted: formatBytes(size),
        freeFormatted: formatBytes(free),
        usedFormatted: formatBytes(used)
      };
    });
  } catch (err) {
    // Fallback: check drive letters A: to Z: via fs.statfsSync
    const drives = [];
    for (let c = 65; c <= 90; c++) {
      const letter = String.fromCharCode(c) + ':';
      try {
        if (fs.existsSync(letter + '\\')) {
          const stat = fs.statfsSync(letter + '\\');
          const total = stat.bsize * stat.blocks;
          const free = stat.bsize * stat.bfree;
          const used = total - free;
          const usedPercent = total > 0 ? Math.round((used / total) * 100) : 0;
          drives.push({
            letter,
            label: letter,
            name: 'Local Disk',
            totalBytes: total,
            freeBytes: free,
            usedBytes: used,
            usedPercent,
            freePercent: 100 - usedPercent,
            isLowSpace: 100 - usedPercent <= 15,
            totalFormatted: formatBytes(total),
            freeFormatted: formatBytes(free),
            usedFormatted: formatBytes(used)
          });
        }
      } catch (e) {
        // Drive not mounted or inaccessible
      }
    }
    return drives;
  }
}

module.exports = {
  getWindowsDrives,
  formatBytes
};
