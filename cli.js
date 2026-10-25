const path = require('path');
const { getWindowsDrives, formatBytes } = require('./src/drives');
const { scanBloatAreas, scanProjectBloat } = require('./src/scanner');
const { findLargeFiles } = require('./src/largeFiles');
const { findDuplicateFiles } = require('./src/duplicates');
const { cleanBatch } = require('./src/cleaner');
const { startServer } = require('./src/server');
const { launchDesktopApp } = require('./src/system');

// Simple ANSI color helpers
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgBlue: '\x1b[44m',
  bgRed: '\x1b[41m'
};

function printBanner() {
  console.log(`
${C.cyan}${C.bold}╔═══════════════════════════════════════════════════════════╗
║                      SPACE HUNTER                         ║
║     Deep Local Disk Space Cleaner & Unknown Bloat Hunter  ║
╚═══════════════════════════════════════════════════════════╝${C.reset}
`);
}

function printHelp() {
  printBanner();
  console.log(`${C.bold}USAGE:${C.reset}`);
  console.log(`  node cli.js <command> [options]\n`);
  console.log(`${C.bold}COMMANDS:${C.reset}`);
  console.log(`  ${C.green}drives${C.reset}                  List all drives, total/free space, and capacity warnings`);
  console.log(`  ${C.green}scan${C.reset}                    Scan Windows temp, browser caches, GPU shaders, package managers`);
  console.log(`  ${C.green}clean${C.reset} [options]         Clean detected bloat items safely`);
  console.log(`         --dry-run        Simulate space freed without deleting anything`);
  console.log(`         --permanent      Delete permanently instead of sending to Recycle Bin`);
  console.log(`         --id <ids>       Comma-separated category IDs to clean`);
  console.log(`  ${C.green}dev${C.reset} <path>              Scan a directory or drive for node_modules, .venv, target, bin/obj`);
  console.log(`  ${C.green}large${C.reset} <path> [options]  Find large files (>100MB, 500MB, 1GB+)`);
  console.log(`         --min <size>     Minimum size (e.g. 100MB, 500MB, 1GB, 5GB) [default: 100MB]`);
  console.log(`         --cat <type>     Filter: all, video, archive, installer, ai_model, database`);
  console.log(`  ${C.green}dupes${C.reset} <path> [options]  Find duplicate files (blazing fast parallel scanner)`);
  console.log(`         --mode <type>    Matching mode: name, name_size, exact [default: name]`);
  console.log(`         --cat <type>     Filter: all, image, video, audio, document, archive [default: all]`);
  console.log(`         --min <size>     Minimum file size (e.g. 100KB, 1MB, 10MB) [default: 0]`);
  console.log(`         --all-dirs       Include dev folders (node_modules, .git)`);
  console.log(`  ${C.green}ui${C.reset}                      Launch the visual Desktop App Window`);
  console.log(`  ${C.green}help${C.reset}                    Show this help screen\n`);
  console.log(`${C.bold}EXAMPLES:${C.reset}`);
  console.log(`  node cli.js drives`);
  console.log(`  node cli.js scan`);
  console.log(`  node cli.js clean --dry-run`);
  console.log(`  node cli.js clean --id win_user_temp,pkg_npm,pkg_pip`);
  console.log(`  node cli.js dev B:\\`);
  console.log(`  node cli.js large C:\\ --min 500MB`);
  console.log(`  node cli.js dupes B:\\ --mode name`);
  console.log(`  node cli.js dupes C:\\ --mode name_size --min 1MB`);
  console.log(`  node cli.js ui\n`);
}

function makeProgressBar(percent, length = 20) {
  const filled = Math.round((percent / 100) * length);
  const empty = length - filled;
  const color = percent > 85 ? C.red : percent > 70 ? C.yellow : C.green;
  return `${color}[${'█'.repeat(filled)}${'-'.repeat(empty)}] ${percent}%${C.reset}`;
}

async function handleDrives() {
  printBanner();
  console.log(`${C.bold}Analyzing Connected Storage Drives...${C.reset}\n`);
  const drives = await getWindowsDrives();

  console.log(`  ${'Drive'.padEnd(10)} ${'Volume Name'.padEnd(16)} ${'Used / Total'.padEnd(20)} ${'Free Space'.padEnd(14)} Usage`);
  console.log(`  ${'─'.repeat(75)}`);

  for (const d of drives) {
    const warning = d.isLowSpace ? ` ${C.bgRed}${C.white} LOW SPACE ${C.reset}` : '';
    const usedTotal = `${d.usedFormatted} / ${d.totalFormatted}`;
    console.log(
      `  ${C.bold}${d.letter.padEnd(10)}${C.reset} ${d.name.slice(0, 15).padEnd(16)} ${usedTotal.padEnd(20)} ${C.cyan}${d.freeFormatted.padEnd(14)}${C.reset} ${makeProgressBar(d.usedPercent)}${warning}`
    );
  }
  console.log('');
}

async function handleScan() {
  printBanner();
  console.log(`${C.bold}Scanning Known Bloat & Hidden Cache Locations...${C.reset}\n`);

  let lastTime = 0;
  let lastLineLength = 0;
  const result = await scanBloatAreas((p) => {
    const now = Date.now();
    if (now - lastTime > 150 || p.itemIndex === p.totalItems) {
      lastTime = now;
      const msg = `[*] Checking [${p.itemIndex}/${p.totalItems}]: ${p.currentItem}...`;
      process.stdout.write(`\r${msg.padEnd(lastLineLength)}`);
      lastLineLength = msg.length;
    }
  });

  process.stdout.write(`\r${' '.repeat(lastLineLength)}\r`);

  if (!result.items.length) {
    console.log(`${C.green}✓ No significant bloat detected! Your system is clean.${C.reset}\n`);
    return;
  }

  // Group by category
  const categories = {};
  for (const item of result.items) {
    if (!categories[item.category]) categories[item.category] = [];
    categories[item.category].push(item);
  }

  console.log(`  ${'Category / Target'.padEnd(36)} ${'Size'.padEnd(12)} ${'Files'.padEnd(10)} ID`);
  console.log(`  ${'─'.repeat(75)}`);

  for (const [catName, items] of Object.entries(categories)) {
    console.log(`\n  ${C.yellow}${C.bold}► ${catName}${C.reset}`);
    for (const item of items) {
      console.log(
        `    ${item.name.padEnd(34)} ${C.bold}${item.formattedSize.padEnd(12)}${C.reset} ${(item.fileCount + ' files').padEnd(10)} ${C.dim}${item.id}${C.reset}`
      );
    }
  }

  console.log(`\n  ${'─'.repeat(75)}`);
  console.log(`  ${C.bold}Total Bloat Discovered:${C.reset} ${C.green}${C.bold}${result.formattedTotal}${C.reset} across ${result.totalFiles} files\n`);
  console.log(`  ${C.cyan}Tip: To clean safely (to Recycle Bin), run:${C.reset}`);
  console.log(`  node cli.js clean\n`);
  console.log(`  ${C.cyan}Or to preview dry-run:${C.reset}`);
  console.log(`  node cli.js clean --dry-run\n`);
}

async function handleClean(args) {
  printBanner();
  const dryRun = args.includes('--dry-run');
  const permanent = args.includes('--permanent');
  const safeRecycle = !permanent;

  let targetIds = null;
  const idIdx = args.indexOf('--id');
  if (idIdx !== -1 && args[idIdx + 1]) {
    targetIds = new Set(args[idIdx + 1].split(',').map(s => s.trim()));
  }

  console.log(`${C.bold}Scanning for items to clean...${C.reset}`);
  const scanResult = await scanBloatAreas();
  let itemsToClean = scanResult.items;

  if (targetIds) {
    itemsToClean = itemsToClean.filter(i => targetIds.has(i.id));
  } else {
    // By default clean safeToClean items
    itemsToClean = itemsToClean.filter(i => i.safeToClean);
  }

  if (!itemsToClean.length) {
    console.log(`${C.yellow}No items selected or found to clean.${C.reset}\n`);
    return;
  }

  const modeText = dryRun
    ? `${C.yellow}[DRY RUN - SIMULATION ONLY]${C.reset}`
    : safeRecycle
    ? `${C.green}[SAFE MODE - Send to Recycle Bin]${C.reset}`
    : `${C.red}[PERMANENT DELETION]${C.reset}`;

  console.log(`\nCleanup Mode: ${modeText}\n`);
  console.log(`Targets (${itemsToClean.length} items):`);
  for (const it of itemsToClean) {
    console.log(`  - ${it.name} (${it.formattedSize}) -> ${C.dim}${it.path}${C.reset}`);
  }
  console.log('');

  const cleanResult = await cleanBatch(itemsToClean, { dryRun, safeRecycle });

  console.log(`${C.bold}Cleanup Results:${C.reset}`);
  console.log(`  Status:         ${cleanResult.success ? C.green + 'Completed' : C.red + 'Errors occurred'}${C.reset}`);
  console.log(`  Space Saved:    ${C.green}${C.bold}${cleanResult.formattedTotalFreed}${C.reset}`);
  console.log(`  Files Processed:${cleanResult.totalDeleted}`);
  if (cleanResult.totalSkipped > 0) {
    console.log(`  Files Skipped:  ${C.yellow}${cleanResult.totalSkipped} (locked or in-use by running apps)${C.reset}`);
  }
  console.log('');
}

async function handleDev(args) {
  printBanner();
  const targetDir = args[1] || process.cwd();
  console.log(`${C.bold}Scanning for Developer Bloat in:${C.reset} ${C.cyan}${targetDir}${C.reset}\n`);

  let lastTime = 0;
  let lastLine = 0;
  const result = await scanProjectBloat(targetDir, { maxDepth: 6 }, (p) => {
    const now = Date.now();
    if (now - lastTime > 150) {
      lastTime = now;
      const msg = `[*] Scanned ${p.scannedCount} dirs, found ${p.foundCount} artifacts (${formatBytes(p.totalBytes)})...`;
      process.stdout.write(`\r${msg.padEnd(lastLine)}`);
      lastLine = msg.length;
    }
  });

  process.stdout.write(`\r${' '.repeat(lastLine)}\r`);

  if (!result.items.length) {
    console.log(`${C.green}✓ No project bloat (node_modules, .venv, target, etc.) found in ${targetDir}.${C.reset}\n`);
    return;
  }

  console.log(`  ${'Type'.padEnd(26)} ${'Size'.padEnd(12)} ${'Files'.padEnd(10)} Project Location`);
  console.log(`  ${'─'.repeat(75)}`);

  for (const it of result.items) {
    console.log(
      `  ${C.bold}${it.type.padEnd(26)}${C.reset} ${C.green}${it.formattedSize.padEnd(12)}${C.reset} ${(it.fileCount + ' files').padEnd(10)} ${C.dim}${it.parentDir}${C.reset}`
    );
  }

  console.log(`  ${'─'.repeat(75)}`);
  console.log(`  ${C.bold}Total Reclaimable Dev Space:${C.reset} ${C.green}${C.bold}${result.formattedTotal}${C.reset} (${result.items.length} projects)\n`);
}

async function handleLarge(args) {
  printBanner();
  const targetDir = args[1] || process.cwd();

  let minBytes = 100 * 1024 * 1024;
  const minIdx = args.indexOf('--min');
  if (minIdx !== -1 && args[minIdx + 1]) {
    const val = args[minIdx + 1].toUpperCase();
    if (val.endsWith('GB')) minBytes = parseFloat(val) * 1024 * 1024 * 1024;
    else if (val.endsWith('MB')) minBytes = parseFloat(val) * 1024 * 1024;
  }

  let category = 'all';
  const catIdx = args.indexOf('--cat');
  if (catIdx !== -1 && args[catIdx + 1]) {
    category = args[catIdx + 1].toLowerCase();
  }

  console.log(`${C.bold}Hunting Large Files (> ${formatBytes(minBytes)}) in:${C.reset} ${C.cyan}${targetDir}${C.reset}\n`);

  let lastTime = 0;
  let lastLine = 0;
  const result = await findLargeFiles(targetDir, { minBytes, category }, (p) => {
    const now = Date.now();
    if (now - lastTime > 150) {
      lastTime = now;
      const msg = `[*] Scanned ${p.scannedCount} files, found ${p.matchCount} large files (${formatBytes(p.matchBytes)})...`;
      process.stdout.write(`\r${msg.padEnd(lastLine)}`);
      lastLine = msg.length;
    }
  });

  process.stdout.write(`\r${' '.repeat(lastLine)}\r`);

  if (!result.items.length) {
    console.log(`${C.green}✓ No files found exceeding ${formatBytes(minBytes)} in ${targetDir}.${C.reset}\n`);
    return;
  }

  console.log(`  ${'Size'.padEnd(12)} ${'Type'.padEnd(24)} File Name & Location`);
  console.log(`  ${'─'.repeat(80)}`);

  for (const it of result.items.slice(0, 40)) {
    console.log(
      `  ${C.green}${C.bold}${it.formattedSize.padEnd(12)}${C.reset} ${it.categoryLabel.padEnd(24)} ${it.name}\n  ${' '.repeat(14)}${C.dim}${it.path}${C.reset}`
    );
  }

  console.log(`\n  ${'─'.repeat(80)}`);
  console.log(`  ${C.bold}Found:${C.reset} ${result.items.length} files totaling ${C.green}${C.bold}${result.formattedTotal}${C.reset} (from ${result.totalScanned} scanned files)\n`);
}

async function handleDuplicates(args) {
  printBanner();

  let targetDir = args[1] && !args[1].startsWith('--') ? args[1] : 'C:\\';
  if (/^[a-zA-Z]:$/.test(targetDir)) {
    targetDir = targetDir + '\\';
  }

  let matchMode = 'name';
  const modeIdx = args.indexOf('--mode');
  if (modeIdx !== -1 && args[modeIdx + 1]) {
    matchMode = args[modeIdx + 1].toLowerCase();
    if (!['name', 'name_size', 'exact'].includes(matchMode)) {
      matchMode = 'name';
    }
  }

  let minSizeBytes = 0;
  const minIdx = args.indexOf('--min');
  if (minIdx !== -1 && args[minIdx + 1]) {
    const raw = args[minIdx + 1].toUpperCase();
    if (raw.endsWith('GB')) minSizeBytes = parseFloat(raw) * 1024 * 1024 * 1024;
    else if (raw.endsWith('MB')) minSizeBytes = parseFloat(raw) * 1024 * 1024;
    else if (raw.endsWith('KB')) minSizeBytes = parseFloat(raw) * 1024;
    else minSizeBytes = parseFloat(raw) || 0;
  }

  let category = 'all';
  const catIdx = args.indexOf('--cat');
  if (catIdx !== -1 && args[catIdx + 1]) {
    category = args[catIdx + 1].toLowerCase();
  }

  const ignoreDevDirs = !args.includes('--all-dirs');

  const modeDescriptions = {
    name: 'By Name (Super Fast)',
    name_size: 'By Name & Exact Size',
    exact: 'Exact Bit-for-Bit Hash'
  };

  console.log(`${C.bold}Scanning for Duplicate Files in:${C.reset} ${C.cyan}${targetDir}${C.reset}`);
  console.log(`  Matching Mode: ${C.yellow}${modeDescriptions[matchMode] || matchMode}${C.reset}`);
  if (category !== 'all') console.log(`  Category: ${C.cyan}${category}${C.reset}`);
  if (minSizeBytes > 0) console.log(`  Minimum Size: ${C.dim}${formatBytes(minSizeBytes)}${C.reset}`);
  console.log(`  Skip Dev Dirs: ${C.dim}${ignoreDevDirs ? 'Yes (.git, node_modules, etc.)' : 'No'}${C.reset}\n`);

  let lastLine = 0;
  const result = await findDuplicateFiles(
    targetDir,
    { matchMode, category, minSizeBytes, ignoreDevDirs },
    (p) => {
      let msg = '';
      if (p.phase === 'scanning') {
        msg = `[*] Traversed ${p.scannedCount.toLocaleString()} files (${p.uniqueNames.toLocaleString()} unique names)...`;
      } else {
        msg = `[*] ${p.currentPath}`;
      }
      process.stdout.write(`\r${msg.padEnd(lastLine)}`);
      lastLine = msg.length;
    }
  );

  process.stdout.write(`\r${' '.repeat(lastLine)}\r`);

  if (!result.items.length) {
    console.log(`${C.green}✓ No duplicate files found in ${targetDir}.${C.reset}`);
    console.log(`  Scanned ${result.totalFilesScanned.toLocaleString()} files in ${(result.scanDurationMs / 1000).toFixed(2)}s (${result.scanSpeedFilesPerSec.toLocaleString()} files/sec).\n`);
    return;
  }

  console.log(`  ${'Duplicate Group / Files'.padEnd(45)} ${'Category'.padEnd(16)} ${'Copies'.padEnd(8)} Reclaimable`);
  console.log(`  ${'─'.repeat(85)}`);

  for (const group of result.items.slice(0, 30)) {
    console.log(
      `  ${C.bold}${C.white}${group.name.slice(0, 43).padEnd(45)}${C.reset} ${group.categoryLabel.slice(0, 15).padEnd(16)} ${C.yellow}${String(group.count).padEnd(8)}${C.reset} ${C.green}${C.bold}${group.formattedWasted}${C.reset}`
    );
    for (const f of group.files) {
      const tag = f.isNewest ? `${C.green}[NEWEST]${C.reset} ` : f.isOldest ? `${C.dim}[OLDEST]${C.reset} ` : '         ';
      console.log(`    ${tag}${C.dim}${f.formattedSize.padStart(9)}${C.reset}  ${f.path}`);
    }
    console.log();
  }

  if (result.items.length > 30) {
    console.log(`  ${C.dim}... and ${result.items.length - 30} more duplicate groups (use Web UI for full visual browser)${C.reset}\n`);
  }

  console.log(`  ${'─'.repeat(85)}`);
  console.log(`  ${C.bold}Scanned:${C.reset} ${result.totalFilesScanned.toLocaleString()} files in ${(result.scanDurationMs / 1000).toFixed(2)}s (${C.cyan}${result.scanSpeedFilesPerSec.toLocaleString()} files/sec${C.reset})`);
  console.log(`  ${C.bold}Duplicates Found:${C.reset} ${result.totalGroupsCount.toLocaleString()} duplicate sets (${result.totalDuplicateFiles.toLocaleString()} files)`);
  console.log(`  ${C.bold}Reclaimable Space:${C.reset} ${C.green}${C.bold}${result.formattedTotalWasted}${C.reset}\n`);
}

async function handleUI() {
  printBanner();
  console.log(`${C.bold}Starting SpaceHunter Local Web Server & Desktop Window...${C.reset}\n`);
  const { address } = await startServer(4880);
  console.log(`[*] SpaceHunter UI active at: ${C.cyan}${address}${C.reset}`);
  launchDesktopApp(address);
  console.log(`[*] Desktop application window opened. Press Ctrl+C to terminate.`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = (args[0] || 'help').toLowerCase();

  switch (command) {
    case 'drives':
      await handleDrives();
      break;
    case 'scan':
      await handleScan();
      break;
    case 'clean':
      await handleClean(args);
      break;
    case 'dev':
      await handleDev(args);
      break;
    case 'large':
      await handleLarge(args);
      break;
    case 'dupes':
    case 'duplicates':
    case 'duplicate':
      await handleDuplicates(args);
      break;
    case 'ui':
    case 'app':
    case 'gui':
      await handleUI();
      break;
    case 'help':
    case '--help':
    case '-h':
    default:
      printHelp();
      break;
  }
}

main().catch(err => {
  console.error(`${C.red}Error:${C.reset}`, err);
  process.exit(1);
});
