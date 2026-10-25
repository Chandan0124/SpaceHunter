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

/**
 * Fast sum of directory bytes (non-recursive sub-tree summaries)
 */
async function getQuickDirSize(dirPath, maxFiles = 50000) {
  let size = 0;
  let fileCount = 0;

  async function walk(curr) {
    if (fileCount > maxFiles) return;
    let entries;
    try {
      entries = await fs.promises.readdir(curr, { withFileTypes: true });
    } catch (e) {
      return;
    }

    for (const ent of entries) {
      if (ent.isSymbolicLink()) continue;
      const full = path.join(curr, ent.name);
      try {
        if (ent.isDirectory()) {
          const lower = ent.name.toLowerCase();
          if (PROTECTED_DIRS.has(lower)) continue;
          await walk(full);
        } else if (ent.isFile()) {
          const stat = await fs.promises.stat(full);
          size += stat.size;
          fileCount++;
        }
      } catch (e) {}
    }
  }

  await walk(dirPath);
  return { size, fileCount };
}

/**
 * Generates hierarchical folder tree with sizes
 */
async function analyzeFolderHierarchy(rootPath, depth = 2, onProgress) {
  let entries;
  try {
    entries = await fs.promises.readdir(rootPath, { withFileTypes: true });
  } catch (e) {
    return { name: path.basename(rootPath) || rootPath, path: rootPath, sizeBytes: 0, children: [] };
  }

  const children = [];
  let rootDirectFileSize = 0;
  let rootDirectFileCount = 0;

  for (const ent of entries) {
    if (ent.isSymbolicLink()) continue;
    const full = path.join(rootPath, ent.name);

    if (ent.isDirectory()) {
      const lower = ent.name.toLowerCase();
      if (PROTECTED_DIRS.has(lower)) continue;

      if (onProgress) {
        onProgress({ currentFolder: full });
      }

      const { size, fileCount } = await getQuickDirSize(full);
      let subChildren = [];

      if (depth > 1 && size > 10 * 1024 * 1024) { // Only break down folders > 10MB
        try {
          const subEntries = await fs.promises.readdir(full, { withFileTypes: true });
          for (const subEnt of subEntries) {
            if (subEnt.isSymbolicLink() || !subEnt.isDirectory()) continue;
            const subFull = path.join(full, subEnt.name);
            const subLower = subEnt.name.toLowerCase();
            if (PROTECTED_DIRS.has(subLower)) continue;

            const subStats = await getQuickDirSize(subFull, 10000);
            if (subStats.size > 0) {
              subChildren.push({
                name: subEnt.name,
                path: subFull,
                sizeBytes: subStats.size,
                formattedSize: formatBytes(subStats.size),
                fileCount: subStats.fileCount
              });
            }
          }
          subChildren.sort((a, b) => b.sizeBytes - a.sizeBytes);
        } catch (e) {}
      }

      children.push({
        name: ent.name,
        path: full,
        sizeBytes: size,
        formattedSize: formatBytes(size),
        fileCount,
        children: subChildren.slice(0, 10)
      });
    } else if (ent.isFile()) {
      try {
        const stat = await fs.promises.stat(full);
        rootDirectFileSize += stat.size;
        rootDirectFileCount++;
      } catch (e) {}
    }
  }

  // Add direct files as a special item if significant
  if (rootDirectFileSize > 0) {
    children.push({
      name: '[Direct Files in Folder]',
      path: rootPath,
      sizeBytes: rootDirectFileSize,
      formattedSize: formatBytes(rootDirectFileSize),
      fileCount: rootDirectFileCount,
      isDirectFiles: true
    });
  }

  // Sort descending by size
  children.sort((a, b) => b.sizeBytes - a.sizeBytes);

  const totalSize = children.reduce((sum, c) => sum + c.sizeBytes, 0);

  // Compute percentage of each child
  children.forEach(c => {
    c.percent = totalSize > 0 ? ((c.sizeBytes / totalSize) * 100).toFixed(1) : 0;
    if (c.children) {
      c.children.forEach(sub => {
        sub.percent = c.sizeBytes > 0 ? ((sub.sizeBytes / c.sizeBytes) * 100).toFixed(1) : 0;
      });
    }
  });

  return {
    name: path.basename(rootPath) || rootPath,
    path: rootPath,
    sizeBytes: totalSize,
    formattedSize: formatBytes(totalSize),
    children
  };
}

module.exports = {
  analyzeFolderHierarchy
};
