const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { formatBytes } = require('./drives');

// Known Windows protected/system folders to skip during whole-drive traversal
const PROTECTED_DIRS = new Set([
  '$recycle.bin',
  'system volume information',
  'recovery',
  'msocache',
  'config.msi',
  'documents and settings',
  'windows'
]);

// Developer/build artifact directories to optionally skip
const DEV_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '.venv',
  'venv',
  'env',
  '__pycache__',
  '.next',
  '.nuxt',
  'target',
  'bin',
  'obj',
  'vendor',
  '.gradle',
  '.cache'
]);

const EXT_CATEGORIES = {
  image: new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.tiff', '.ico', '.psd', '.raw', '.cr2', '.nef', '.heic']),
  video: new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.ts', '.m4v', '.3gp', '.vob']),
  audio: new Set(['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a', '.alac', '.opus', '.aiff']),
  document: new Set(['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.txt', '.rtf', '.csv', '.odt', '.md', '.epub', '.mobi']),
  archive: new Set(['.zip', '.rar', '.7z', '.tar', '.gz', '.xz', '.bz2', '.tgz', '.iso', '.cab', '.7zip']),
  installer: new Set(['.msi', '.msixbundle', '.appx', '.exe', '.dmg', '.pkg', '.deb', '.rpm']),
  code: new Set(['.js', '.ts', '.py', '.java', '.cpp', '.c', '.cs', '.html', '.css', '.json', '.xml', '.sql', '.php', '.go', '.rs', '.rb'])
};

function getFileCategory(ext) {
  const lower = (ext || '').toLowerCase();
  for (const [cat, exts] of Object.entries(EXT_CATEGORIES)) {
    if (exts.has(lower)) return cat;
  }
  return 'other';
}

function getCategoryLabel(cat) {
  switch (cat) {
    case 'image': return 'Image / Photo';
    case 'video': return 'Video / Media';
    case 'audio': return 'Audio / Music';
    case 'document': return 'Document';
    case 'archive': return 'Compressed Archive';
    case 'installer': return 'Installer / App';
    case 'code': return 'Code / Source';
    default: return 'Other File';
  }
}

/**
 * Computes a fast partial hash for rapid verification of identically-sized files.
 * Reads first 64KB and last 64KB + incorporates file size.
 */
async function getFastPartialHash(filePath, size) {
  if (size === 0) return 'empty_file_0_bytes';
  let fd;
  try {
    fd = await fs.promises.open(filePath, 'r');
    const hash = crypto.createHash('sha256');
    hash.update(Buffer.from(String(size)));

    const sampleSize = Math.min(65536, size);
    const buf1 = Buffer.alloc(sampleSize);
    await fd.read(buf1, 0, sampleSize, 0);
    hash.update(buf1);

    if (size > sampleSize * 2) {
      const buf2 = Buffer.alloc(sampleSize);
      await fd.read(buf2, 0, sampleSize, size - sampleSize);
      hash.update(buf2);
    }
    return hash.digest('hex');
  } catch (err) {
    return null;
  } finally {
    if (fd) await fd.close().catch(() => {});
  }
}

/**
 * Super-fast duplicate scanner with multi-worker parallel directory queue traversal.
 * 
 * @param {string} rootPath - Drive or directory to scan
 * @param {Object} options - Scanning options
 * @param {string} options.matchMode - 'name' | 'name_size' | 'exact' (default 'name')
 * @param {number} options.minSizeBytes - Minimum file size in bytes (default 0)
 * @param {boolean} options.ignoreDevDirs - Skip node_modules, .git, etc. (default true)
 * @param {boolean} options.includeWindowsDir - Scan C:\Windows if C:\ selected (default false)
 * @param {number} options.limit - Max duplicate groups to return (default 1000)
 * @param {Function} onProgress - SSE progress callback
 */
async function findDuplicateFiles(rootPath, options = {}, onProgress) {
  const startTime = Date.now();
  const matchMode = options.matchMode || 'name'; // 'name' | 'name_size' | 'exact'
  const minSizeBytes = Number(options.minSizeBytes) || 0;
  const categoryFilter = options.category || 'all';
  const ignoreDevDirs = options.ignoreDevDirs !== false;
  const includeWindowsDir = !!options.includeWindowsDir;
  const limit = options.limit || 1000;
  const concurrency = 8; // Parallel directory workers

  const byName = new Map();
  const queue = [rootPath];
  let totalFilesScanned = 0;
  let activeWorkers = 0;
  let lastProgressUpdate = 0;

  // ------------------------------------------------------------------
  // STAGE 1: Parallel BFS Directory Traversal (Zero file-stat overhead)
  // ------------------------------------------------------------------
  await new Promise((resolve) => {
    function processNext() {
      while (activeWorkers < concurrency && queue.length > 0) {
        const currentDir = queue.shift();
        activeWorkers++;

        fs.promises.readdir(currentDir, { withFileTypes: true })
          .then((entries) => {
            for (const entry of entries) {
              if (entry.isSymbolicLink()) continue;

              const lowerName = entry.name.toLowerCase();

              if (entry.isDirectory()) {
                if (PROTECTED_DIRS.has(lowerName) && !includeWindowsDir) continue;
                if (ignoreDevDirs && DEV_DIRS.has(lowerName)) continue;

                queue.push(path.join(currentDir, entry.name));
              } else if (entry.isFile()) {
                totalFilesScanned++;

                if (categoryFilter !== 'all') {
                  const ext = path.extname(entry.name);
                  if (getFileCategory(ext) !== categoryFilter) {
                    continue;
                  }
                }

                let list = byName.get(lowerName);
                if (!list) {
                  list = [];
                  byName.set(lowerName, list);
                }

                list.push({
                  name: entry.name,
                  parentDir: currentDir,
                  path: path.join(currentDir, entry.name)
                });

                const now = Date.now();
                if (onProgress && now - lastProgressUpdate > 120) {
                  lastProgressUpdate = now;
                  onProgress({
                    phase: 'scanning',
                    scannedCount: totalFilesScanned,
                    currentPath: currentDir,
                    uniqueNames: byName.size
                  });
                }
              }
            }
          })
          .catch(() => {
            // Permission denied or locked directory
          })
          .finally(() => {
            activeWorkers--;
            if (queue.length === 0 && activeWorkers === 0) {
              resolve();
            } else {
              processNext();
            }
          });
      }
    }

    processNext();
  });

  const walkDurationMs = Date.now() - startTime;

  // ------------------------------------------------------------------
  // STAGE 2: Filter Candidate Names (Names with count >= 2)
  // ------------------------------------------------------------------
  const candidateLists = [];
  let totalCandidateFiles = 0;

  for (const [lowerName, fileList] of byName.entries()) {
    if (fileList.length > 1) {
      candidateLists.push(fileList);
      totalCandidateFiles += fileList.length;
    }
  }

  // Clear name map to free memory immediately
  byName.clear();

  if (onProgress) {
    onProgress({
      phase: 'analyzing',
      scannedCount: totalFilesScanned,
      candidateCount: totalCandidateFiles,
      currentPath: `Analyzing metadata for ${totalCandidateFiles.toLocaleString()} candidate duplicate files...`
    });
  }

  // ------------------------------------------------------------------
  // STAGE 3: Batch Stat Candidates (Chunked concurrency)
  // ------------------------------------------------------------------
  const allCandidateFiles = candidateLists.flat();
  const STAT_CHUNK_SIZE = 256;
  let stattedSoFar = 0;

  for (let i = 0; i < allCandidateFiles.length; i += STAT_CHUNK_SIZE) {
    const chunk = allCandidateFiles.slice(i, i + STAT_CHUNK_SIZE);
    await Promise.all(
      chunk.map(async (f) => {
        try {
          const st = await fs.promises.stat(f.path);
          f.size = st.size;
          f.mtime = st.mtime ? st.mtime.toISOString().split('T')[0] : 'Unknown';
          f.mtimeMs = st.mtime ? st.mtime.getTime() : 0;
          f.valid = true;
        } catch {
          f.valid = false;
        }
      })
    );
    stattedSoFar += chunk.length;
    if (onProgress && (stattedSoFar % 1024 === 0 || stattedSoFar === allCandidateFiles.length)) {
      onProgress({
        phase: 'analyzing',
        scannedCount: totalFilesScanned,
        candidateCount: totalCandidateFiles,
        currentPath: `Analyzing file sizes (${stattedSoFar.toLocaleString()} / ${totalCandidateFiles.toLocaleString()})...`
      });
    }
  }

  // ------------------------------------------------------------------
  // STAGE 4: Match Mode Grouping & Hash Verification
  // ------------------------------------------------------------------
  let finalGroups = [];

  if (matchMode === 'name') {
    // Group strictly by filename
    for (const fileList of candidateLists) {
      const validFiles = fileList.filter((f) => f.valid && f.size >= minSizeBytes);
      if (validFiles.length < 2) continue;

      // Sort files: newest first
      validFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);

      const first = validFiles[0];
      const ext = path.extname(first.name).toLowerCase();
      const category = getFileCategory(ext);

      // Estimate wasted bytes:
      // If sizes identical: size * (count - 1)
      // If sizes differ: sum of sizes minus largest size (or keep newest)
      const allSameSize = validFiles.every((f) => f.size === first.size);
      let wastedBytes = 0;
      if (allSameSize) {
        wastedBytes = first.size * (validFiles.length - 1);
      } else {
        const sortedSizes = validFiles.map((f) => f.size).sort((a, b) => b - a);
        wastedBytes = sortedSizes.slice(1).reduce((acc, s) => acc + s, 0);
      }

      finalGroups.push({
        name: first.name,
        extension: ext,
        category,
        categoryLabel: getCategoryLabel(category),
        count: validFiles.length,
        allSameSize,
        wastedBytes,
        formattedWasted: formatBytes(wastedBytes),
        files: validFiles.map((f, idx) => ({
          path: f.path,
          parentDir: f.parentDir,
          size: f.size,
          formattedSize: formatBytes(f.size),
          modified: f.mtime,
          mtimeMs: f.mtimeMs,
          isNewest: idx === 0,
          isOldest: idx === validFiles.length - 1
        }))
      });
    }
  } else if (matchMode === 'name_size' || matchMode === 'exact') {
    // Group by filename AND exact byte size
    const byNameAndSize = new Map();

    for (const fileList of candidateLists) {
      for (const f of fileList) {
        if (!f.valid || f.size < minSizeBytes) continue;
        const key = `${f.name.toLowerCase()}:::${f.size}`;
        let sub = byNameAndSize.get(key);
        if (!sub) {
          sub = [];
          byNameAndSize.set(key, sub);
        }
        sub.push(f);
      }
    }

    if (matchMode === 'name_size') {
      for (const [key, subFiles] of byNameAndSize.entries()) {
        if (subFiles.length < 2) continue;

        subFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
        const first = subFiles[0];
        const ext = path.extname(first.name).toLowerCase();
        const category = getFileCategory(ext);
        const wastedBytes = first.size * (subFiles.length - 1);

        finalGroups.push({
          name: first.name,
          extension: ext,
          category,
          categoryLabel: getCategoryLabel(category),
          count: subFiles.length,
          allSameSize: true,
          exactSize: first.size,
          formattedExactSize: formatBytes(first.size),
          wastedBytes,
          formattedWasted: formatBytes(wastedBytes),
          files: subFiles.map((f, idx) => ({
            path: f.path,
            parentDir: f.parentDir,
            size: f.size,
            formattedSize: formatBytes(f.size),
            modified: f.mtime,
            mtimeMs: f.mtimeMs,
            isNewest: idx === 0,
            isOldest: idx === subFiles.length - 1
          }))
        });
      }
    } else {
      // Exact mode: Fast sample hash verification
      const byHash = new Map();

      for (const [key, subFiles] of byNameAndSize.entries()) {
        if (subFiles.length < 2) continue;

        for (const f of subFiles) {
          const hash = await getFastPartialHash(f.path, f.size);
          if (!hash) continue;
          f.hash = hash;
          const hashKey = `${key}:::${hash}`;
          let hSub = byHash.get(hashKey);
          if (!hSub) {
            hSub = [];
            byHash.set(hashKey, hSub);
          }
          hSub.push(f);
        }
      }

      for (const [hashKey, hFiles] of byHash.entries()) {
        if (hFiles.length < 2) continue;

        hFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
        const first = hFiles[0];
        const ext = path.extname(first.name).toLowerCase();
        const category = getFileCategory(ext);
        const wastedBytes = first.size * (hFiles.length - 1);

        finalGroups.push({
          name: first.name,
          extension: ext,
          category,
          categoryLabel: getCategoryLabel(category),
          count: hFiles.length,
          allSameSize: true,
          exactSize: first.size,
          formattedExactSize: formatBytes(first.size),
          hash: first.hash,
          isExactMatch: true,
          wastedBytes,
          formattedWasted: formatBytes(wastedBytes),
          files: hFiles.map((f, idx) => ({
            path: f.path,
            parentDir: f.parentDir,
            size: f.size,
            formattedSize: formatBytes(f.size),
            modified: f.mtime,
            mtimeMs: f.mtimeMs,
            isNewest: idx === 0,
            isOldest: idx === hFiles.length - 1,
            hash: f.hash
          }))
        });
      }
    }
  }

  // ------------------------------------------------------------------
  // STAGE 5: Sorting, Statistics & Summary
  // ------------------------------------------------------------------
  // Sort descending by wasted space (largest potential reclaim first)
  finalGroups.sort((a, b) => b.wastedBytes - a.wastedBytes);

  // Assign IDs
  finalGroups.forEach((g, idx) => {
    g.id = `dup_${idx + 1}`;
  });

  const totalGroupsCount = finalGroups.length;
  let totalDuplicateFiles = 0;
  let totalWastedBytes = 0;
  const categoryBreakdown = {};

  for (const g of finalGroups) {
    totalDuplicateFiles += g.count;
    totalWastedBytes += g.wastedBytes;

    if (!categoryBreakdown[g.category]) {
      categoryBreakdown[g.category] = {
        label: g.categoryLabel,
        groupsCount: 0,
        filesCount: 0,
        wastedBytes: 0
      };
    }
    categoryBreakdown[g.category].groupsCount++;
    categoryBreakdown[g.category].filesCount += g.count;
    categoryBreakdown[g.category].wastedBytes += g.wastedBytes;
  }

  for (const cat of Object.values(categoryBreakdown)) {
    cat.formattedWasted = formatBytes(cat.wastedBytes);
  }

  const totalDurationMs = Date.now() - startTime;
  const scanSpeedFilesPerSec = Math.round(totalFilesScanned / (totalDurationMs / 1000 || 1));

  return {
    items: finalGroups.slice(0, limit),
    totalGroupsCount,
    totalDuplicateFiles,
    totalWastedBytes,
    formattedTotalWasted: formatBytes(totalWastedBytes),
    totalFilesScanned,
    scanDurationMs: totalDurationMs,
    walkDurationMs,
    scanSpeedFilesPerSec,
    categoryBreakdown,
    matchMode
  };
}

module.exports = {
  findDuplicateFiles,
  getFastPartialHash,
  getFileCategory,
  getCategoryLabel
};
