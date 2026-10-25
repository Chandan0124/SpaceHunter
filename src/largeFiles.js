const fs = require('fs');
const path = require('path');
const { formatBytes } = require('./drives');

const PROTECTED_DIRS = new Set([
  '$recycle.bin',
  'system volume information',
  'recovery',
  'msocache',
  'config.msi',
  'documents and settings'
]);

const FILE_CATEGORIES = {
  ai_model: new Set(['.gguf', '.safetensors', '.bin', '.pt', '.pth', '.onnx', '.ckpt', '.model', '.weights']),
  disk_image: new Set(['.iso', '.vhdx', '.vmdk', '.img', '.vdi', '.qcow2', '.wim']),
  video: new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.ts', '.m4v']),
  archive: new Set(['.zip', '.rar', '.7z', '.tar', '.gz', '.xz', '.bz2', '.tgz']),
  installer: new Set(['.msi', '.msixbundle', '.appx', '.exe']),
  database: new Set(['.bak', '.sql', '.db', '.sqlite', '.sqlite3', '.mdf', '.ldf', '.log', '.dump'])
};

function getFileCategory(ext) {
  const lowerExt = ext.toLowerCase();
  for (const [cat, exts] of Object.entries(FILE_CATEGORIES)) {
    if (exts.has(lowerExt)) return cat;
  }
  return 'other';
}

function getCategoryLabel(cat) {
  switch (cat) {
    case 'ai_model': return 'AI / ML Weights';
    case 'disk_image': return 'Disk & VM Image';
    case 'video': return 'Video / Media';
    case 'archive': return 'Compressed Archive';
    case 'installer': return 'Installer / Setup';
    case 'database': return 'Database / Backup / Log';
    default: return 'Other File';
  }
}

async function findLargeFiles(rootPath, options = {}, onProgress) {
  const minBytes = options.minBytes || 100 * 1024 * 1024; // 100MB default
  const maxDepth = options.maxDepth || 20;
  const maxResults = options.limit || 500;
  const categoryFilter = options.category || 'all';

  const matches = [];
  let totalScanned = 0;
  let totalMatchBytes = 0;

  async function walk(currentPath, depth) {
    if (depth > maxDepth) return;

    let entries;
    try {
      entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
    } catch (e) {
      return;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;

      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        const lowerName = entry.name.toLowerCase();
        if (PROTECTED_DIRS.has(lowerName)) continue;
        await walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        totalScanned++;
        if (onProgress && totalScanned % 1000 === 0) {
          onProgress({
            scannedCount: totalScanned,
            currentPath: fullPath,
            matchCount: matches.length,
            matchBytes: totalMatchBytes
          });
        }

        try {
          const stat = await fs.promises.stat(fullPath);
          if (stat.size >= minBytes) {
            const ext = path.extname(entry.name);
            const category = getFileCategory(ext);

            if (categoryFilter === 'all' || categoryFilter === category) {
              totalMatchBytes += stat.size;
              matches.push({
                name: entry.name,
                path: fullPath,
                parentDir: currentPath,
                sizeBytes: stat.size,
                formattedSize: formatBytes(stat.size),
                extension: ext.toLowerCase(),
                category,
                categoryLabel: getCategoryLabel(category),
                lastModified: stat.mtime ? stat.mtime.toISOString().split('T')[0] : 'Unknown'
              });
            }
          }
        } catch (e) {
          // File locked or inaccessible
        }
      }
    }
  }

  await walk(rootPath, 1);

  // Sort descending by file size
  matches.sort((a, b) => b.sizeBytes - a.sizeBytes);

  return {
    items: matches.slice(0, maxResults),
    totalCount: matches.length,
    totalBytes: totalMatchBytes,
    formattedTotal: formatBytes(totalMatchBytes),
    totalScanned
  };
}

module.exports = {
  findLargeFiles,
  getFileCategory,
  getCategoryLabel
};
