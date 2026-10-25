const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { formatBytes } = require('./drives');

// Absolute forbidden paths that MUST never be touched under any circumstances
const FORBIDDEN_ROOTS = [
  'c:\\',
  'd:\\',
  'e:\\',
  'f:\\',
  'g:\\',
  'h:\\',
  'b:\\',
  'j:\\',
  'c:\\windows',
  'c:\\windows\\system32',
  'c:\\program files',
  'c:\\program files (x86)',
  'c:\\programdata',
  os.homedir().toLowerCase(), // User profile root
  path.join(os.homedir(), 'desktop').toLowerCase(),
  path.join(os.homedir(), 'documents').toLowerCase(),
  path.join(os.homedir(), 'pictures').toLowerCase()
];

function isSafeTarget(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') return false;
  const normalized = path.resolve(targetPath).toLowerCase();

  // Check if matches forbidden roots exactly
  if (FORBIDDEN_ROOTS.includes(normalized)) return false;

  // Check if path is root drive (e.g. "C:\" or "C:")
  if (/^[a-zA-Z]:\\?$/.test(normalized)) return false;

  return true;
}

/**
 * Send a file or directory to Windows Recycle Bin via PowerShell
 */
async function sendToRecycleBin(targetPath, isDir = true) {
  const sanitized = targetPath.replace(/'/g, "''");
  const method = isDir ? 'DeleteDirectory' : 'DeleteFile';
  const script = `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::${method}('${sanitized}', 'OnlyErrorDialogs', 'SendToRecycleBin')`;
  await execPromise(`powershell -NoProfile -NonInteractive -Command "${script}"`, { windowsHide: true });
}

/**
 * Cleans a single item or its contents
 */
async function cleanTarget(targetPath, options = {}) {
  const { dryRun = false, safeRecycle = true, cleanMode = 'contents' } = options;

  if (!isSafeTarget(targetPath)) {
    throw new Error(`Target path "${targetPath}" is protected for system security.`);
  }

  let freedBytes = 0;
  let deletedCount = 0;
  let skippedCount = 0;
  const errors = [];

  let stat;
  try {
    stat = await fs.promises.stat(targetPath);
  } catch (e) {
    return { freedBytes: 0, deletedCount: 0, skippedCount: 0, errors: ['Path does not exist'] };
  }

  // If target is a single file:
  if (stat.isFile()) {
    freedBytes = stat.size;
    if (!dryRun) {
      try {
        if (safeRecycle) {
          await sendToRecycleBin(targetPath, false);
        } else {
          await fs.promises.unlink(targetPath);
        }
        deletedCount++;
      } catch (e) {
        skippedCount++;
        errors.push(`Could not delete file: ${e.message}`);
      }
    } else {
      deletedCount++;
    }
    return { freedBytes, deletedCount, skippedCount, errors };
  }

  // If target is a directory:
  if (cleanMode === 'contents') {
    // Clean all items inside the directory, but preserve the directory itself
    let entries;
    try {
      entries = await fs.promises.readdir(targetPath, { withFileTypes: true });
    } catch (e) {
      return { freedBytes: 0, deletedCount: 0, skippedCount: 0, errors: [e.message] };
    }

    for (const entry of entries) {
      const fullChild = path.join(targetPath, entry.name);
      try {
        const childStat = await fs.promises.stat(fullChild);
        const childSize = childStat.size;

        if (dryRun) {
          freedBytes += childSize;
          deletedCount++;
          continue;
        }

        if (safeRecycle) {
          await sendToRecycleBin(fullChild, entry.isDirectory());
          freedBytes += childSize;
          deletedCount++;
        } else {
          if (entry.isDirectory()) {
            await fs.promises.rm(fullChild, { recursive: true, force: true });
          } else {
            await fs.promises.unlink(fullChild);
          }
          freedBytes += childSize;
          deletedCount++;
        }
      } catch (e) {
        // File in use / locked by active process or permission denied
        skippedCount++;
        errors.push(`Skipped locked item: ${entry.name}`);
      }
    }
  } else {
    // Delete the entire directory itself (e.g. node_modules, .next, target, .venv)
    try {
      if (dryRun) {
        deletedCount++;
      } else {
        if (safeRecycle) {
          await sendToRecycleBin(targetPath, true);
        } else {
          await fs.promises.rm(targetPath, { recursive: true, force: true });
        }
        deletedCount++;
      }
    } catch (e) {
      skippedCount++;
      errors.push(`Could not delete directory: ${e.message}`);
    }
  }

  return { freedBytes, deletedCount, skippedCount, errors };
}

/**
 * Batch clean multiple targets
 */
async function cleanBatch(items, options = {}) {
  let totalFreed = 0;
  let totalDeleted = 0;
  let totalSkipped = 0;
  const results = [];

  for (const item of items) {
    const targetPath = typeof item === 'string' ? item : item.path;
    const cleanMode = (item && item.cleanMode) ? item.cleanMode : 'contents';

    try {
      const res = await cleanTarget(targetPath, {
        ...options,
        cleanMode
      });

      totalFreed += res.freedBytes;
      totalDeleted += res.deletedCount;
      totalSkipped += res.skippedCount;

      results.push({
        path: targetPath,
        success: res.errors.length === 0,
        freedBytes: res.freedBytes,
        formattedFreed: formatBytes(res.freedBytes),
        deletedCount: res.deletedCount,
        skippedCount: res.skippedCount,
        errors: res.errors
      });
    } catch (err) {
      results.push({
        path: targetPath,
        success: false,
        freedBytes: 0,
        formattedFreed: '0 B',
        deletedCount: 0,
        skippedCount: 1,
        errors: [err.message]
      });
      totalSkipped++;
    }
  }

  return {
    success: true,
    dryRun: !!options.dryRun,
    safeRecycle: !!options.safeRecycle,
    totalFreedBytes: totalFreed,
    formattedTotalFreed: formatBytes(totalFreed),
    totalDeleted,
    totalSkipped,
    items: results
  };
}

module.exports = {
  cleanTarget,
  cleanBatch,
  isSafeTarget,
  sendToRecycleBin
};
