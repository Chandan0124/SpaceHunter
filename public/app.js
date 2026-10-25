// SpaceHunter Frontend Logic - 100% Local Vanilla JS

let allDrives = [];
let bloatScanItems = [];
let devScanItems = [];
let currentTreePath = 'B:\\';
let eventSource = null;

// Format bytes helper
function formatBytes(bytes, decimals = 2) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// ----------------------------------------------------
// 1. Initial Setup & SSE Connection
// ----------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupSSE();
  loadDrives();
  setupBloatHunter();
  setupDevHunter();
  setupLargeHunter();
  setupDuplicateHunter();
  setupTreemap();
  setupModals();
});

function setupTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      
      btn.classList.add('active');
      const targetId = `tab-${btn.dataset.tab}`;
      const pane = document.getElementById(targetId);
      if (pane) pane.classList.add('active');
    });
  });
}

function setupSSE() {
  try {
    eventSource = new EventSource('/api/scan/progress');

    eventSource.addEventListener('scan_start', (e) => {
      const data = JSON.parse(e.data);
      showScannerBanner(data.type, data.rootPath);
    });

    eventSource.addEventListener('scan_progress', (e) => {
      const data = JSON.parse(e.data);
      updateScannerProgress(data);
    });

    eventSource.addEventListener('scan_complete', (e) => {
      hideScannerBanner();
    });
  } catch (err) {
    console.error('SSE initialization error:', err);
  }
}

function showScannerBanner(type, rootPath) {
  const banner = document.getElementById('scannerBanner');
  banner.classList.remove('hidden');

  const indicator = document.getElementById('statusIndicator');
  indicator.className = 'status-badge scanning';
  document.getElementById('statusText').textContent = 'Scanning...';

  document.getElementById('scanTypeLabel').textContent = `Hunting ${type.toUpperCase()}`;
  document.getElementById('scanCurrentPath').textContent = rootPath || '';
}

function updateScannerProgress(data) {
  if (data.currentPath) {
    document.getElementById('scanCurrentPath').textContent = data.currentPath;
  }
  if (data.scannedCount || data.fileCount || data.totalDiscoveredFiles) {
    const count = data.scannedCount || data.fileCount || data.totalDiscoveredFiles || 0;
    document.getElementById('scanFilesCount').textContent = `${count.toLocaleString()} items checked`;
  }
  if (data.totalBytes || data.totalDiscoveredBytes || data.matchBytes) {
    const bytes = data.totalBytes || data.totalDiscoveredBytes || data.matchBytes || 0;
    document.getElementById('scanFoundBytes').textContent = `${formatBytes(bytes)} found`;
  }
}

function hideScannerBanner() {
  const banner = document.getElementById('scannerBanner');
  banner.classList.add('hidden');

  const indicator = document.getElementById('statusIndicator');
  indicator.className = 'status-badge ready';
  document.getElementById('statusText').textContent = 'Ready';
}

// ----------------------------------------------------
// 2. Drives Handling
// ----------------------------------------------------
async function loadDrives() {
  const container = document.getElementById('drivesContainer');
  try {
    const res = await fetch('/api/drives');
    const data = await res.json();
    if (!data.success) return;

    allDrives = data.drives;
    container.innerHTML = '';

    const devSelect = document.getElementById('devDriveSelect');
    const largeSelect = document.getElementById('largeDriveSelect');
    const dupeSelect = document.getElementById('dupeDriveSelect');
    devSelect.innerHTML = '';
    largeSelect.innerHTML = '';
    if (dupeSelect) dupeSelect.innerHTML = '';

    allDrives.forEach(drive => {
      // Add drive card
      const card = document.createElement('div');
      card.className = `drive-card ${drive.isLowSpace ? 'low-space' : ''}`;
      
      const progressClass = drive.usedPercent > 85 ? 'warning' : 'normal';

      card.innerHTML = `
        <div class="drive-header">
          <span class="drive-letter">${drive.letter}</span>
          <span class="drive-name" title="${drive.name}">${drive.name}</span>
        </div>
        <div class="drive-progress-track">
          <div class="drive-progress-fill ${progressClass}" style="width: ${drive.usedPercent}%"></div>
        </div>
        <div class="drive-details">
          <span>${drive.usedFormatted} used</span>
          <span class="drive-free">${drive.freeFormatted} free</span>
        </div>
      `;
      container.appendChild(card);

      // Populate select options
      const opt = document.createElement('option');
      opt.value = drive.letter + '\\';
      opt.textContent = `${drive.letter} [${drive.name}] (${drive.freeFormatted} free)`;
      devSelect.appendChild(opt.cloneNode(true));
      largeSelect.appendChild(opt.cloneNode(true));
      if (dupeSelect) dupeSelect.appendChild(opt.cloneNode(true));
    });

    const dupeCustomPath = document.getElementById('dupeCustomPath');
    if (dupeCustomPath && dupeSelect && !dupeCustomPath.value) {
      dupeCustomPath.value = dupeSelect.value;
    }

  } catch (err) {
    console.error('Failed to load drives:', err);
  }
}

document.getElementById('refreshDrivesBtn').addEventListener('click', loadDrives);

// ----------------------------------------------------
// 3. Quick Bloat Hunter
// ----------------------------------------------------
function setupBloatHunter() {
  const scanBtn = document.getElementById('startBloatScanBtn');
  const selectAllBtn = document.getElementById('selectAllSafeBtn');
  const deselectAllBtn = document.getElementById('deselectAllBtn');

  scanBtn.addEventListener('click', runBloatScan);

  selectAllBtn.addEventListener('click', () => {
    document.querySelectorAll('.bloat-checkbox').forEach(cb => {
      const isSafe = cb.dataset.safe === 'true';
      cb.checked = isSafe;
    });
    updateBloatSelection();
  });

  deselectAllBtn.addEventListener('click', () => {
    document.querySelectorAll('.bloat-checkbox').forEach(cb => {
      cb.checked = false;
    });
    updateBloatSelection();
  });
}

async function runBloatScan() {
  const scanBtn = document.getElementById('startBloatScanBtn');
  scanBtn.disabled = true;
  scanBtn.innerHTML = `Scanning...`;

  const container = document.getElementById('bloatItemsContainer');
  container.innerHTML = `
    <div class="empty-state">
      <div class="pulse-indicator" style="margin: 0 auto 16px auto; width: 18px; height: 18px;"></div>
      <h3>Scanning Bloat & Hidden Caches...</h3>
      <p>Examining Windows Temp, Crash Dumps, Shader Caches, Package Stores, and Browsers...</p>
    </div>
  `;

  try {
    const res = await fetch('/api/scan/bloat');
    const data = await res.json();
    if (!data.success) {
      container.innerHTML = `<div class="info-note text-danger">Scan error: ${data.error}</div>`;
      return;
    }

    bloatScanItems = data.items;
    renderBloatResults(data);
  } catch (err) {
    container.innerHTML = `<div class="info-note text-danger">Failed to scan: ${err.message}</div>`;
  } finally {
    scanBtn.disabled = false;
    scanBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
      </svg>
      Scan Common Bloat
    `;
  }
}

function renderBloatResults(data) {
  const container = document.getElementById('bloatItemsContainer');
  const summaryCard = document.getElementById('bloatSummaryCard');

  if (!data.items.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎉</div>
        <h3>Zero Bloat Detected!</h3>
        <p>All scanned cache, dump, and temporary directories are clean.</p>
      </div>
    `;
    summaryCard.classList.add('hidden');
    return;
  }

  summaryCard.classList.remove('hidden');
  document.getElementById('metricTotalBytes').textContent = data.formattedTotal;
  document.getElementById('metricTotalFiles').textContent = `${data.totalFiles.toLocaleString()} files discovered`;

  // Compute safe bytes
  const safeItems = data.items.filter(i => i.safeToClean);
  const safeBytes = safeItems.reduce((acc, i) => acc + i.totalBytes, 0);
  document.getElementById('metricSafeBytes').textContent = formatBytes(safeBytes);

  // Group by Category
  const groups = {};
  data.items.forEach(item => {
    if (!groups[item.category]) groups[item.category] = [];
    groups[item.category].push(item);
  });

  // Find top category
  let topCatName = '-';
  let topCatBytes = 0;
  for (const [cat, items] of Object.entries(groups)) {
    const total = items.reduce((sum, i) => sum + i.totalBytes, 0);
    if (total > topCatBytes) {
      topCatBytes = total;
      topCatName = cat;
    }
  }
  document.getElementById('metricTopCategory').textContent = topCatName;
  document.getElementById('metricTopCatSize').textContent = formatBytes(topCatBytes);

  container.innerHTML = '';

  for (const [categoryName, items] of Object.entries(groups)) {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'category-group';

    const groupTotal = items.reduce((sum, i) => sum + i.totalBytes, 0);

    groupDiv.innerHTML = `
      <div class="category-group-header">
        <span>${categoryName}</span>
        <span class="badge badge-cyan">${formatBytes(groupTotal)}</span>
      </div>
      <div class="category-group-items"></div>
    `;

    const itemsContainer = groupDiv.querySelector('.category-group-items');

    items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'bloat-item-row';

      const safeBadge = item.safeToClean
        ? `<span class="badge badge-success">Safe to Clean</span>`
        : `<span class="badge badge-warning">Review First</span>`;

      row.innerHTML = `
        <div class="bloat-item-left">
          <input type="checkbox" class="bloat-checkbox" data-id="${item.id}" data-size="${item.totalBytes}" data-safe="${item.safeToClean}" ${item.safeToClean ? 'checked' : ''}>
          <div class="bloat-item-info">
            <div class="bloat-item-name">
              ${item.name}
              ${safeBadge}
            </div>
            <div class="bloat-item-desc">${item.description}</div>
            <div class="bloat-item-path" title="${item.path}">${item.path}</div>
          </div>
        </div>
        <div class="bloat-item-right">
          <div>
            <div class="bloat-item-size">${item.formattedSize}</div>
            <div class="bloat-item-files">${item.fileCount} files</div>
          </div>
          <button class="btn btn-secondary btn-xs open-folder-btn" data-path="${encodeURIComponent(item.path)}" title="Reveal in Windows File Explorer">
            📁 Reveal
          </button>
        </div>
      `;
      itemsContainer.appendChild(row);
    });

    container.appendChild(groupDiv);
  }

  // Bind checkbox clicks
  document.querySelectorAll('.bloat-checkbox').forEach(cb => {
    cb.addEventListener('change', updateBloatSelection);
  });

  // Bind Reveal in Explorer buttons
  document.querySelectorAll('.open-folder-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const path = decodeURIComponent(btn.dataset.path);
      revealPath(path);
    });
  });

  updateBloatSelection();
}

function updateBloatSelection() {
  const checkboxes = document.querySelectorAll('.bloat-checkbox:checked');
  let totalBytes = 0;
  checkboxes.forEach(cb => {
    totalBytes += Number(cb.dataset.size);
  });

  document.getElementById('selectedSpaceCount').textContent = formatBytes(totalBytes);
  document.getElementById('selectedItemCount').textContent = checkboxes.length;

  const dryRunBtn = document.getElementById('dryRunBtn');
  const cleanBtn = document.getElementById('openCleanModalBtn');

  if (checkboxes.length > 0) {
    dryRunBtn.disabled = false;
    cleanBtn.disabled = false;
  } else {
    dryRunBtn.disabled = true;
    cleanBtn.disabled = true;
  }
}

// ----------------------------------------------------
// 4. Developer Bloat Hunter
// ----------------------------------------------------
function setupDevHunter() {
  const scanBtn = document.getElementById('startDevScanBtn');
  const cleanBtn = document.getElementById('cleanDevBtn');
  const devSelect = document.getElementById('devDriveSelect');
  const devInput = document.getElementById('devCustomPath');

  devSelect.addEventListener('change', () => {
    devInput.value = devSelect.value;
  });

  scanBtn.addEventListener('click', async () => {
    const targetPath = devInput.value.trim() || devSelect.value || 'B:\\';
    scanBtn.disabled = true;
    scanBtn.textContent = 'Hunting...';

    const container = document.getElementById('devResultsContainer');
    container.innerHTML = `
      <div class="empty-state">
        <div class="pulse-indicator" style="margin: 0 auto 16px auto; width: 18px; height: 18px;"></div>
        <h3>Hunting Developer Bloat in ${targetPath}...</h3>
        <p>Looking for node_modules, .next, target, bin/obj, __pycache__, .venv...</p>
      </div>
    `;

    try {
      const res = await fetch('/api/scan/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rootPath: targetPath, maxDepth: 6 })
      });
      const data = await res.json();
      if (!data.success) {
        container.innerHTML = `<div class="info-note text-danger">Error: ${data.error}</div>`;
        return;
      }

      devScanItems = data.items;
      renderDevResults(data);
    } catch (e) {
      container.innerHTML = `<div class="info-note text-danger">Failed to scan: ${e.message}</div>`;
    } finally {
      scanBtn.disabled = false;
      scanBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        Hunt Dev Bloat
      `;
    }
  });

  cleanBtn.addEventListener('click', () => {
    const selected = getSelectedDevItems();
    if (!selected.length) return;
    openCleanupModal(selected, 'dev');
  });
}

function renderDevResults(data) {
  const container = document.getElementById('devResultsContainer');
  if (!data.items.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">✨</div>
        <h3>Clean Workspace!</h3>
        <p>No unused dependencies or build outputs detected in this location.</p>
      </div>
    `;
    return;
  }

  let html = `
    <div class="data-table-container">
      <table class="data-table">
        <thead>
          <tr>
            <th width="40"><input type="checkbox" id="devSelectAll"></th>
            <th>Artifact Type</th>
            <th>Project Directory</th>
            <th>Size</th>
            <th>Files</th>
            <th>Last Modified</th>
            <th width="120">Action</th>
          </tr>
        </thead>
        <tbody>
  `;

  data.items.forEach((item, idx) => {
    html += `
      <tr>
        <td><input type="checkbox" class="dev-item-cb" data-idx="${idx}"></td>
        <td><span class="badge badge-cyan">${item.type}</span></td>
        <td>
          <div style="font-weight: 600; color: #fff;">${item.name}</div>
          <div style="font-size: 0.72rem; color: var(--text-dim); font-family: monospace;">${item.parentDir}</div>
        </td>
        <td style="font-weight: 700; color: var(--accent-green);">${item.formattedSize}</td>
        <td>${item.fileCount.toLocaleString()}</td>
        <td style="color: var(--text-muted);">${item.lastModified}</td>
        <td>
          <button class="btn btn-secondary btn-xs open-dev-folder" data-path="${encodeURIComponent(item.path)}">
            📁 Reveal
          </button>
        </td>
      </tr>
    `;
  });

  html += `</tbody></table></div>`;
  container.innerHTML = html;

  document.getElementById('devSelectAll').addEventListener('change', (e) => {
    document.querySelectorAll('.dev-item-cb').forEach(cb => cb.checked = e.target.checked);
    updateDevSelection();
  });

  document.querySelectorAll('.dev-item-cb').forEach(cb => {
    cb.addEventListener('change', updateDevSelection);
  });

  document.querySelectorAll('.open-dev-folder').forEach(btn => {
    btn.addEventListener('click', () => {
      revealPath(decodeURIComponent(btn.dataset.path));
    });
  });

  updateDevSelection();
}

function updateDevSelection() {
  const selected = getSelectedDevItems();
  const total = selected.reduce((sum, i) => sum + i.totalBytes, 0);
  document.getElementById('selectedDevSpace').textContent = formatBytes(total);
  document.getElementById('cleanDevBtn').disabled = selected.length === 0;
}

function getSelectedDevItems() {
  const selected = [];
  document.querySelectorAll('.dev-item-cb:checked').forEach(cb => {
    const idx = Number(cb.dataset.idx);
    if (devScanItems[idx]) {
      selected.push({
        ...devScanItems[idx],
        cleanMode: 'directory' // Dev artifacts like node_modules should have the whole folder removed
      });
    }
  });
  return selected;
}

// ----------------------------------------------------
// 5. Large File Hunter
// ----------------------------------------------------
function setupLargeHunter() {
  const scanBtn = document.getElementById('startLargeScanBtn');
  const largeSelect = document.getElementById('largeDriveSelect');
  const largeInput = document.getElementById('largeCustomPath');
  const minSizeSelect = document.getElementById('largeMinSize');
  const catSelect = document.getElementById('largeCategorySelect');

  largeSelect.addEventListener('change', () => {
    largeInput.value = largeSelect.value;
  });

  scanBtn.addEventListener('click', async () => {
    const targetPath = largeInput.value.trim() || largeSelect.value || 'C:\\';
    const minBytes = Number(minSizeSelect.value);
    const category = catSelect.value;

    scanBtn.disabled = true;
    scanBtn.textContent = 'Hunting...';

    const container = document.getElementById('largeResultsContainer');
    container.innerHTML = `
      <div class="empty-state">
        <div class="pulse-indicator" style="margin: 0 auto 16px auto; width: 18px; height: 18px;"></div>
        <h3>Hunting Large Files (> ${formatBytes(minBytes)}) in ${targetPath}...</h3>
      </div>
    `;

    try {
      const res = await fetch('/api/scan/large-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rootPath: targetPath, minBytes, category })
      });
      const data = await res.json();
      if (!data.success) {
        container.innerHTML = `<div class="info-note text-danger">Error: ${data.error}</div>`;
        return;
      }

      renderLargeResults(data);
    } catch (e) {
      container.innerHTML = `<div class="info-note text-danger">Failed to scan: ${e.message}</div>`;
    } finally {
      scanBtn.disabled = false;
      scanBtn.textContent = 'Find Large Files';
    }
  });
}

function renderLargeResults(data) {
  const container = document.getElementById('largeResultsContainer');
  if (!data.items.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <h3>No Large Files Found</h3>
        <p>No files matched your threshold in this location.</p>
      </div>
    `;
    return;
  }

  let html = `
    <div style="margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
      <span class="selection-counter">Found: <strong>${data.totalCount} files</strong> totaling <strong>${data.formattedTotal}</strong></span>
    </div>
    <div class="data-table-container">
      <table class="data-table">
        <thead>
          <tr>
            <th>File Name</th>
            <th>Type</th>
            <th>Size</th>
            <th>Modified</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
  `;

  data.items.forEach(file => {
    html += `
      <tr>
        <td>
          <div style="font-weight: 600; color: #fff;">${file.name}</div>
          <div style="font-size: 0.72rem; color: var(--text-dim); font-family: monospace;">${file.path}</div>
        </td>
        <td><span class="badge badge-cyan">${file.categoryLabel}</span></td>
        <td style="font-weight: 700; color: var(--accent-green); font-size: 0.95rem;">${file.formattedSize}</td>
        <td style="color: var(--text-muted);">${file.lastModified}</td>
        <td>
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-secondary btn-xs open-file-btn" data-path="${encodeURIComponent(file.path)}">
              📁 Reveal
            </button>
            <button class="btn btn-danger btn-xs delete-file-btn" data-path="${encodeURIComponent(file.path)}" data-size="${file.sizeBytes}" data-name="${encodeURIComponent(file.name)}">
              🗑️ Delete
            </button>
          </div>
        </td>
      </tr>
    `;
  });

  html += `</tbody></table></div>`;
  container.innerHTML = html;

  document.querySelectorAll('.open-file-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      revealPath(decodeURIComponent(btn.dataset.path));
    });
  });

  document.querySelectorAll('.delete-file-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const filePath = decodeURIComponent(btn.dataset.path);
      const name = decodeURIComponent(btn.dataset.name);
      const sizeBytes = Number(btn.dataset.size);
      openCleanupModal([{
        name,
        path: filePath,
        totalBytes: sizeBytes,
        formattedSize: formatBytes(sizeBytes),
        cleanMode: 'directory' // Single file removal
      }], 'single_file');
    });
  });
}

// ----------------------------------------------------
// 5. Duplicate File Hunter
// ----------------------------------------------------
let currentDupeResult = null;
let dupeCurrentPage = 1;
let dupePageSize = 50;
const selectedDupeMap = new Map(); // path -> { name, path, totalBytes, formattedSize, cleanMode: 'directory' }

function setupDuplicateHunter() {
  const scanBtn = document.getElementById('startDupeScanBtn');
  const driveSelect = document.getElementById('dupeDriveSelect');
  const customInput = document.getElementById('dupeCustomPath');
  const matchModeSelect = document.getElementById('dupeMatchMode');
  const categorySelect = document.getElementById('dupeCategorySelect');
  const minSizeSelect = document.getElementById('dupeMinSize');
  const ignoreDevCheckbox = document.getElementById('dupeIgnoreDev');
  const searchInput = document.getElementById('dupeSearchInput');
  const keepNewestBtn = document.getElementById('dupeKeepNewestBtn');
  const keepOldestBtn = document.getElementById('dupeKeepOldestBtn');
  const deselectAllBtn = document.getElementById('dupeDeselectAllBtn');
  const cleanDupesBtn = document.getElementById('cleanDupesBtn');
  const resultsContainer = document.getElementById('dupeResultsContainer');
  const prevPageBtn = document.getElementById('dupePrevPageBtn');
  const nextPageBtn = document.getElementById('dupeNextPageBtn');
  const pageSizeSelect = document.getElementById('dupePageSizeSelect');

  if (driveSelect && customInput) {
    driveSelect.addEventListener('change', () => {
      customInput.value = driveSelect.value;
    });
  }

  if (prevPageBtn) {
    prevPageBtn.addEventListener('click', () => {
      if (dupeCurrentPage > 1) {
        dupeCurrentPage--;
        renderDuplicateList(currentDupeResult ? currentDupeResult.items : [], searchInput.value.trim());
        const target = document.getElementById('dupeActionToolbar');
        if (target) window.scrollTo({ top: target.offsetTop - 50, behavior: 'smooth' });
      }
    });
  }

  if (nextPageBtn) {
    nextPageBtn.addEventListener('click', () => {
      dupeCurrentPage++;
      renderDuplicateList(currentDupeResult ? currentDupeResult.items : [], searchInput.value.trim());
      const target = document.getElementById('dupeActionToolbar');
      if (target) window.scrollTo({ top: target.offsetTop - 50, behavior: 'smooth' });
    });
  }

  if (pageSizeSelect) {
    pageSizeSelect.addEventListener('change', () => {
      dupePageSize = Number(pageSizeSelect.value) || 50;
      dupeCurrentPage = 1;
      renderDuplicateList(currentDupeResult ? currentDupeResult.items : [], searchInput.value.trim());
    });
  }

  // High-performance Event Delegation: 1 change listener for all checkboxes
  resultsContainer.addEventListener('change', (e) => {
    const cb = e.target.closest('.dupe-file-cb');
    if (!cb) return;

    const filePath = decodeURIComponent(cb.dataset.path);
    const name = decodeURIComponent(cb.dataset.name);
    const size = Number(cb.dataset.size);
    const row = cb.closest('.dupe-file-row');

    if (cb.checked) {
      selectedDupeMap.set(filePath, {
        name,
        path: filePath,
        totalBytes: size,
        formattedSize: formatBytes(size),
        cleanMode: 'directory'
      });
      if (row) row.classList.add('selected-for-clean');
    } else {
      selectedDupeMap.delete(filePath);
      if (row) row.classList.remove('selected-for-clean');
    }
    updateDupeSelectionUI();
  });

  // High-performance Event Delegation: 1 click listener for all buttons inside the container
  resultsContainer.addEventListener('click', (e) => {
    // 1. Reveal in Explorer
    const revealBtn = e.target.closest('.open-file-btn');
    if (revealBtn) {
      revealPath(decodeURIComponent(revealBtn.dataset.path));
      return;
    }

    // 2. Delete single file
    const delBtn = e.target.closest('.delete-file-btn');
    if (delBtn) {
      const filePath = decodeURIComponent(delBtn.dataset.path);
      const name = decodeURIComponent(delBtn.dataset.name);
      const sizeBytes = Number(delBtn.dataset.size);
      openCleanupModal([{
        name,
        path: filePath,
        totalBytes: sizeBytes,
        formattedSize: formatBytes(sizeBytes),
        cleanMode: 'directory'
      }], 'single_file');
      return;
    }

    // 3. Select Extra Copies in group
    const extraBtn = e.target.closest('.dupe-select-extra-btn');
    if (extraBtn && currentDupeResult) {
      const groupId = extraBtn.dataset.groupId;
      const group = currentDupeResult.items.find(g => g.id === groupId);
      if (group) {
        group.files.forEach((f, idx) => {
          if (idx > 0) {
            selectedDupeMap.set(f.path, {
              name: group.name,
              path: f.path,
              totalBytes: f.size,
              formattedSize: f.formattedSize,
              cleanMode: 'directory'
            });
          }
        });
        syncDupeCheckboxes();
        updateDupeSelectionUI();
      }
      return;
    }
  });

  if (scanBtn) {
    scanBtn.addEventListener('click', async () => {
      const targetPath = (customInput.value || '').trim() || (driveSelect ? driveSelect.value : '') || 'C:\\';
      const matchMode = matchModeSelect.value;
      const category = categorySelect ? categorySelect.value : 'all';
      const minSizeBytes = Number(minSizeSelect.value) || 0;
      const ignoreDevDirs = ignoreDevCheckbox.checked;

      scanBtn.disabled = true;
      scanBtn.innerHTML = `
        <span class="pulse-indicator" style="display:inline-block; vertical-align:middle; width:12px; height:12px; margin-right:6px;"></span>
        Hunting Duplicates...
      `;
      selectedDupeMap.clear();
      dupeCurrentPage = 1;
      updateDupeSelectionUI();

      const paginationBar = document.getElementById('dupePagination');
      if (paginationBar) paginationBar.classList.add('hidden');

      resultsContainer.innerHTML = `
        <div class="empty-state">
          <div class="pulse-indicator" style="margin: 0 auto 16px auto; width: 18px; height: 18px;"></div>
          <h3>Scanning ${targetPath} for Duplicate Files...</h3>
          <p>Multi-worker parallel directory walk active. Duplicates grouped by name & metadata will appear shortly.</p>
        </div>
      `;

      try {
        const res = await fetch('/api/scan/duplicates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rootPath: targetPath,
            matchMode,
            category,
            minSizeBytes,
            ignoreDevDirs
          })
        });

        const data = await res.json();
        if (!data.success) {
          resultsContainer.innerHTML = `<div class="info-note text-danger">Error: ${data.error}</div>`;
          return;
        }

        currentDupeResult = data;
        dupeCurrentPage = 1;
        renderDuplicateSummary(data);
        renderDuplicateList(data.items, (searchInput.value || '').trim());

      } catch (e) {
        resultsContainer.innerHTML = `<div class="info-note text-danger">Failed to scan: ${e.message}</div>`;
      } finally {
        scanBtn.disabled = false;
        scanBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          Scan Duplicates
        `;
      }
    });
  }

  // Real-time search filter with pagination reset
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      if (currentDupeResult) {
        dupeCurrentPage = 1;
        renderDuplicateList(currentDupeResult.items, searchInput.value.trim());
      }
    });
  }

  // Keep Newest: in each duplicate group, select older copies (files[1..n]) for cleanup
  if (keepNewestBtn) {
    keepNewestBtn.addEventListener('click', () => {
      if (!currentDupeResult) return;
      selectedDupeMap.clear();
      currentDupeResult.items.forEach(group => {
        group.files.forEach((f, idx) => {
          if (idx > 0) { // idx 0 is newest
            selectedDupeMap.set(f.path, {
              name: group.name,
              path: f.path,
              totalBytes: f.size,
              formattedSize: f.formattedSize,
              cleanMode: 'directory'
            });
          }
        });
      });
      syncDupeCheckboxes();
      updateDupeSelectionUI();
    });
  }

  // Keep Oldest: in each duplicate group, select newer copies (files[0..n-2]) for cleanup
  if (keepOldestBtn) {
    keepOldestBtn.addEventListener('click', () => {
      if (!currentDupeResult) return;
      selectedDupeMap.clear();
      currentDupeResult.items.forEach(group => {
        group.files.forEach((f, idx) => {
          if (idx < group.files.length - 1) { // last is oldest
            selectedDupeMap.set(f.path, {
              name: group.name,
              path: f.path,
              totalBytes: f.size,
              formattedSize: f.formattedSize,
              cleanMode: 'directory'
            });
          }
        });
      });
      syncDupeCheckboxes();
      updateDupeSelectionUI();
    });
  }

  // Deselect All
  if (deselectAllBtn) {
    deselectAllBtn.addEventListener('click', () => {
      selectedDupeMap.clear();
      syncDupeCheckboxes();
      updateDupeSelectionUI();
    });
  }

  // Clean Selected Dupes
  if (cleanDupesBtn) {
    cleanDupesBtn.addEventListener('click', () => {
      const items = Array.from(selectedDupeMap.values());
      if (!items.length) return;
      openCleanupModal(items, 'duplicates');
    });
  }
}

function renderDuplicateSummary(data) {
  const summaryCard = document.getElementById('dupeSummaryCard');
  const actionToolbar = document.getElementById('dupeActionToolbar');
  if (summaryCard) summaryCard.classList.remove('hidden');
  if (actionToolbar) actionToolbar.classList.remove('hidden');

  const speedElem = document.getElementById('metricDupeSpeed');
  const scannedElem = document.getElementById('metricDupeScanned');
  const setsElem = document.getElementById('metricDupeSets');
  const copiesElem = document.getElementById('metricDupeCopies');
  const wastedElem = document.getElementById('metricDupeWasted');

  if (speedElem) speedElem.textContent = `${data.scanSpeedFilesPerSec.toLocaleString()} files/s`;
  if (scannedElem) scannedElem.textContent = `${data.totalFilesScanned.toLocaleString()} files in ${(data.scanDurationMs / 1000).toFixed(2)}s`;
  if (setsElem) setsElem.textContent = `${data.totalGroupsCount.toLocaleString()} sets`;
  if (copiesElem) copiesElem.textContent = `${data.totalDuplicateFiles.toLocaleString()} duplicate files`;
  if (wastedElem) wastedElem.textContent = data.formattedTotalWasted;
}

function renderDuplicateList(groups, filterText = '') {
  const container = document.getElementById('dupeResultsContainer');
  const paginationBar = document.getElementById('dupePagination');
  if (!container) return;

  const query = filterText.toLowerCase();
  const filtered = query
    ? groups.filter(g => g.name.toLowerCase().includes(query) || (g.categoryLabel && g.categoryLabel.toLowerCase().includes(query)))
    : groups;

  if (!filtered.length) {
    if (paginationBar) paginationBar.classList.add('hidden');
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${groups.length === 0 ? '🎉' : '🔍'}</div>
        <h3>${groups.length === 0 ? 'No Duplicate Files Found!' : 'No Matching Duplicates'}</h3>
        <p>${groups.length === 0 ? 'Every scanned file in this location has a unique name.' : 'Try a different search term.'}</p>
      </div>
    `;
    return;
  }

  // High-performance windowed pagination: only render dupePageSize items into the DOM
  const totalItems = filtered.length;
  const totalPages = Math.ceil(totalItems / dupePageSize) || 1;
  if (dupeCurrentPage > totalPages) dupeCurrentPage = totalPages;
  if (dupeCurrentPage < 1) dupeCurrentPage = 1;

  const startIndex = (dupeCurrentPage - 1) * dupePageSize;
  const endIndex = Math.min(startIndex + dupePageSize, totalItems);
  const pageItems = filtered.slice(startIndex, endIndex);

  // Update Pagination Controls
  if (paginationBar) {
    paginationBar.classList.remove('hidden');
    const info = document.getElementById('dupePageInfo');
    const badge = document.getElementById('dupePageBadge');
    const prevBtn = document.getElementById('dupePrevPageBtn');
    const nextBtn = document.getElementById('dupeNextPageBtn');

    if (info) info.textContent = `Showing ${startIndex + 1}–${endIndex} of ${totalItems.toLocaleString()} duplicate sets`;
    if (badge) badge.textContent = `Page ${dupeCurrentPage} of ${totalPages}`;
    if (prevBtn) prevBtn.disabled = dupeCurrentPage <= 1;
    if (nextBtn) nextBtn.disabled = dupeCurrentPage >= totalPages;
  }

  let html = '';

  pageItems.forEach(group => {
    html += `
      <div class="dupe-group-card" id="card_${group.id}">
        <div class="dupe-group-header">
          <div class="dupe-group-header-left">
            <span class="badge badge-cyan">${group.categoryLabel}</span>
            <span class="dupe-group-name" title="${group.name}">${group.name}</span>
            <span class="badge badge-muted">${group.count} copies</span>
            ${group.allSameSize ? '<span class="badge badge-success" title="Identical file size">Same Size</span>' : '<span class="badge badge-muted" title="Sizes vary">Different Sizes</span>'}
          </div>
          <div class="dupe-group-header-right">
            <span class="dupe-wasted-badge">Reclaimable: <strong>${group.formattedWasted}</strong></span>
            <button class="btn btn-secondary btn-xs dupe-select-extra-btn" data-group-id="${group.id}">
              Select Extra Copies
            </button>
          </div>
        </div>
        <div class="dupe-group-body">
    `;

    group.files.forEach((file, idx) => {
      const isSelected = selectedDupeMap.has(file.path);
      const tagBadge = file.isNewest
        ? '<span class="badge badge-success" style="font-size:0.68rem;">Newest</span>'
        : file.isOldest
        ? '<span class="badge badge-muted" style="font-size:0.68rem;">Oldest</span>'
        : '';

      html += `
        <div class="dupe-file-row ${isSelected ? 'selected-for-clean' : ''}" data-path="${encodeURIComponent(file.path)}">
          <div class="dupe-file-left">
            <input type="checkbox" class="dupe-file-cb" 
              data-path="${encodeURIComponent(file.path)}" 
              data-name="${encodeURIComponent(group.name)}" 
              data-size="${file.size}" 
              ${isSelected ? 'checked' : ''}>
            ${tagBadge}
            ${group.category === 'image' ? `<img src="/api/preview-thumbnail?path=${encodeURIComponent(file.path)}" class="dupe-img-thumb" alt="thumb" title="Hover to enlarge" loading="lazy" onerror="this.style.display='none'">` : ''}
            <span class="dupe-file-path" title="${file.path}">${file.path}</span>
          </div>
          <div class="dupe-file-right">
            <span class="dupe-file-size">${file.formattedSize}</span>
            <span class="dupe-file-mtime">${file.modified}</span>
            <button class="btn btn-secondary btn-xs open-file-btn" data-path="${encodeURIComponent(file.path)}" title="Reveal in Windows Explorer">
              📁 Reveal
            </button>
            <button class="btn btn-danger btn-xs delete-file-btn" data-path="${encodeURIComponent(file.path)}" data-size="${file.size}" data-name="${encodeURIComponent(group.name)}" title="Delete this copy">
              🗑️
            </button>
          </div>
        </div>
      `;
    });

    html += `
        </div>
      </div>
    `;
  });

  // Direct injection with zero querySelectorAll listener loop overhead!
  container.innerHTML = html;
}

function syncDupeCheckboxes() {
  document.querySelectorAll('.dupe-file-cb').forEach(cb => {
    const p = decodeURIComponent(cb.dataset.path);
    const isSelected = selectedDupeMap.has(p);
    cb.checked = isSelected;
    const row = cb.closest('.dupe-file-row');
    if (row) {
      if (isSelected) row.classList.add('selected-for-clean');
      else row.classList.remove('selected-for-clean');
    }
  });
}

function updateDupeSelectionUI() {
  const countElem = document.getElementById('selectedDupeCount');
  const bytesElem = document.getElementById('selectedDupeBytes');
  const cleanBtn = document.getElementById('cleanDupesBtn');

  let totalBytes = 0;
  for (const item of selectedDupeMap.values()) {
    totalBytes += item.totalBytes;
  }

  const count = selectedDupeMap.size;
  if (countElem) countElem.textContent = count.toLocaleString();
  if (bytesElem) bytesElem.textContent = formatBytes(totalBytes);
  if (cleanBtn) cleanBtn.disabled = count === 0;
}

function syncDupeCheckboxes() {
  document.querySelectorAll('.dupe-file-cb').forEach(cb => {
    const p = decodeURIComponent(cb.dataset.path);
    const isSelected = selectedDupeMap.has(p);
    cb.checked = isSelected;
    const row = cb.closest('.dupe-file-row');
    if (row) {
      if (isSelected) row.classList.add('selected-for-clean');
      else row.classList.remove('selected-for-clean');
    }
  });
}

function updateDupeSelectionUI() {
  const countElem = document.getElementById('selectedDupeCount');
  const bytesElem = document.getElementById('selectedDupeBytes');
  const cleanBtn = document.getElementById('cleanDupesBtn');

  let totalBytes = 0;
  for (const item of selectedDupeMap.values()) {
    totalBytes += item.totalBytes;
  }

  const count = selectedDupeMap.size;
  if (countElem) countElem.textContent = count.toLocaleString();
  if (bytesElem) bytesElem.textContent = formatBytes(totalBytes);
  if (cleanBtn) cleanBtn.disabled = count === 0;
}

// ----------------------------------------------------
// 6. Visual Treemap / Directory Explorer
// ----------------------------------------------------
function setupTreemap() {
  const analyzeBtn = document.getElementById('startTreemapBtn');
  const pathInput = document.getElementById('treemapPathInput');
  const upBtn = document.getElementById('treeUpBtn');

  analyzeBtn.addEventListener('click', () => {
    loadTreemap(pathInput.value.trim() || 'B:\\');
  });

  upBtn.addEventListener('click', () => {
    const curr = pathInput.value.trim();
    const parts = curr.split(/[\/\\]/).filter(Boolean);
    if (parts.length > 1) {
      parts.pop();
      const parent = parts.join('\\') + (parts.length === 1 ? '\\' : '');
      pathInput.value = parent;
      loadTreemap(parent);
    } else if (parts.length === 1 && !curr.endsWith('\\')) {
      const parent = parts[0] + '\\';
      pathInput.value = parent;
      loadTreemap(parent);
    }
  });

  document.querySelectorAll('.chip[data-path]').forEach(chip => {
    chip.addEventListener('click', () => {
      pathInput.value = chip.dataset.path;
      loadTreemap(chip.dataset.path);
    });
  });

  document.getElementById('chipUserProfile').addEventListener('click', () => {
    pathInput.value = 'C:\\Users\\chand';
    loadTreemap('C:\\Users\\chand');
  });

  document.getElementById('chipTemp').addEventListener('click', () => {
    pathInput.value = 'C:\\Users\\chand\\AppData\\Local\\Temp';
    loadTreemap('C:\\Users\\chand\\AppData\\Local\\Temp');
  });
}

async function loadTreemap(folderPath) {
  const container = document.getElementById('treemapContainer');
  document.getElementById('currentTreePath').textContent = folderPath;
  document.getElementById('treemapPathInput').value = folderPath;

  container.innerHTML = `
    <div class="empty-state">
      <div class="pulse-indicator" style="margin: 0 auto 16px auto; width: 18px; height: 18px;"></div>
      <h3>Analyzing Directory Hierarchy: ${folderPath}...</h3>
    </div>
  `;

  try {
    const res = await fetch('/api/scan/treemap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootPath: folderPath, depth: 2 })
    });
    const data = await res.json();
    if (!data.success) {
      container.innerHTML = `<div class="info-note text-danger">Error: ${data.error}</div>`;
      return;
    }

    renderTreemap(data);
  } catch (e) {
    container.innerHTML = `<div class="info-note text-danger">Failed to analyze: ${e.message}</div>`;
  }
}

function renderTreemap(data) {
  const container = document.getElementById('treemapContainer');
  if (!data.children || !data.children.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📂</div>
        <h3>Empty Directory</h3>
        <p>No subfolders found in this directory.</p>
      </div>
    `;
    return;
  }

  let html = `
    <div style="margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center;">
      <span class="selection-counter">Total Subdirectory Space: <strong>${data.formattedSize}</strong></span>
    </div>
  `;

  data.children.forEach(node => {
    const barWidth = Math.max(Number(node.percent || 0), 2);

    html += `
      <div class="tree-node-row ${node.isDirectFiles ? 'is-direct' : ''}" data-path="${encodeURIComponent(node.path)}" data-is-files="${!!node.isDirectFiles}">
        <div class="tree-node-left">
          <span class="tree-folder-icon">${node.isDirectFiles ? '📄' : '📁'}</span>
          <div>
            <div class="tree-node-name">${node.name}</div>
            <div style="font-size: 0.7rem; color: var(--text-dim);">${node.fileCount ? node.fileCount.toLocaleString() + ' files' : ''}</div>
          </div>
        </div>
        <div class="tree-node-right">
          <div class="tree-bar-container" title="${node.percent}% of parent">
            <div class="tree-bar-fill" style="width: ${barWidth}%"></div>
          </div>
          <div class="tree-node-size">${node.formattedSize}</div>
          <button class="btn btn-secondary btn-xs open-tree-explorer" data-path="${encodeURIComponent(node.path)}" title="Open in File Explorer">
            📁
          </button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;

  // Bind click to drill-down
  container.querySelectorAll('.tree-node-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.open-tree-explorer')) return;
      if (row.dataset.isFiles === 'true') return;
      const targetPath = decodeURIComponent(row.dataset.path);
      loadTreemap(targetPath);
    });
  });

  // Bind Explorer buttons
  container.querySelectorAll('.open-tree-explorer').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      revealPath(decodeURIComponent(btn.dataset.path));
    });
  });
}

// ----------------------------------------------------
// 7. Modals & Safe Cleanup Actions
// ----------------------------------------------------
let pendingCleanItems = [];

function setupModals() {
  const cleanModal = document.getElementById('cleanModal');
  const reportModal = document.getElementById('reportModal');

  document.getElementById('closeModalBtn').addEventListener('click', () => cleanModal.classList.add('hidden'));
  document.getElementById('cancelModalBtn').addEventListener('click', () => cleanModal.classList.add('hidden'));
  document.getElementById('closeReportBtn').addEventListener('click', () => reportModal.classList.add('hidden'));
  document.getElementById('dismissReportBtn').addEventListener('click', () => reportModal.classList.add('hidden'));

  // Open clean modal from bloat tab
  document.getElementById('openCleanModalBtn').addEventListener('click', () => {
    const selected = getSelectedBloatItems();
    if (!selected.length) return;
    openCleanupModal(selected, 'bloat');
  });

  // Dry run preview from bloat tab
  document.getElementById('dryRunBtn').addEventListener('click', async () => {
    const selected = getSelectedBloatItems();
    if (!selected.length) return;
    executeCleanup(selected, true, true);
  });

  // Confirm button inside modal
  document.getElementById('confirmCleanBtn').addEventListener('click', () => {
    const mode = document.querySelector('input[name="cleanModeRadio"]:checked').value;
    const safeRecycle = mode === 'recycle';
    cleanModal.classList.add('hidden');
    executeCleanup(pendingCleanItems, false, safeRecycle);
  });
}

function getSelectedBloatItems() {
  const selected = [];
  document.querySelectorAll('.bloat-checkbox:checked').forEach(cb => {
    const id = cb.dataset.id;
    const item = bloatScanItems.find(i => i.id === id);
    if (item) selected.push(item);
  });
  return selected;
}

function openCleanupModal(items, context) {
  pendingCleanItems = items;
  const modal = document.getElementById('cleanModal');
  const totalBytes = items.reduce((sum, i) => sum + (i.totalBytes || i.sizeBytes || 0), 0);

  document.getElementById('modalSpaceToFree').textContent = formatBytes(totalBytes);
  document.getElementById('modalItemsCount').textContent = items.length;

  const list = document.getElementById('modalItemsList');
  list.innerHTML = '';

  items.slice(0, 15).forEach(item => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span>${item.name}</span>
      <span class="val">${item.formattedSize}</span>
    `;
    list.appendChild(li);
  });

  if (items.length > 15) {
    const li = document.createElement('li');
    li.style.fontStyle = 'italic';
    li.textContent = `...and ${items.length - 15} more items`;
    list.appendChild(li);
  }

  modal.classList.remove('hidden');
}

async function executeCleanup(items, dryRun, safeRecycle) {
  const indicator = document.getElementById('statusIndicator');
  indicator.className = 'status-badge scanning';
  document.getElementById('statusText').textContent = dryRun ? 'Simulating...' : 'Cleaning...';

  try {
    const res = await fetch('/api/clean', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, dryRun, safeRecycle })
    });
    const result = await res.json();

    showReportModal(result);

    // Refresh drives & bloat list if actual clean occurred
    if (!dryRun) {
      loadDrives();
      setTimeout(runBloatScan, 1500);
      if (selectedDupeMap.size > 0 && document.getElementById('startDupeScanBtn') && currentDupeResult) {
        selectedDupeMap.clear();
        updateDupeSelectionUI();
        setTimeout(() => {
          document.getElementById('startDupeScanBtn').click();
        }, 1200);
      }
    }
  } catch (err) {
    alert(`Cleanup failed: ${err.message}`);
  } finally {
    indicator.className = 'status-badge ready';
    document.getElementById('statusText').textContent = 'Ready';
  }
}

function showReportModal(result) {
  const modal = document.getElementById('reportModal');
  const freedElem = document.getElementById('reportFreedSpace');
  const headline = document.getElementById('reportHeadline');
  const details = document.getElementById('reportDetails');

  freedElem.textContent = result.formattedTotalFreed;

  if (result.dryRun) {
    headline.textContent = `Simulation Complete: ${result.formattedTotalFreed} would be reclaimed`;
    freedElem.className = 'stat-value text-yellow';
  } else {
    headline.textContent = `Reclaimed successfully to ${result.safeRecycle ? 'Windows Recycle Bin' : 'Permanently'}!`;
    freedElem.className = 'stat-value text-green';
  }

  let html = `<div style="font-weight: 600; margin-bottom: 6px;">Processed Items:</div>`;
  result.items.forEach(it => {
    html += `
      <div class="report-row">
        <span style="font-family: monospace; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; max-width: 380px;">${it.path}</span>
        <span style="font-weight: 700; color: #fff;">${it.formattedFreed}</span>
      </div>
    `;
  });

  if (result.totalSkipped > 0) {
    html += `
      <div class="info-note text-yellow" style="margin-top: 10px;">
        ${result.totalSkipped} file(s) were safely skipped because they are currently locked or in use by running applications.
      </div>
    `;
  }

  details.innerHTML = html;
  modal.classList.remove('hidden');
}

// ----------------------------------------------------
// 8. System Explorer Helper
// ----------------------------------------------------
async function revealPath(targetPath) {
  try {
    await fetch('/api/open-explorer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: targetPath })
    });
  } catch (err) {
    console.error('Failed to reveal path:', err);
  }
}
