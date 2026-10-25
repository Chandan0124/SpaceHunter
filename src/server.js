const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const { getWindowsDrives, formatBytes } = require('./drives');
const { scanBloatAreas, scanProjectBloat } = require('./scanner');
const { findLargeFiles } = require('./largeFiles');
const { findDuplicateFiles } = require('./duplicates');
const { analyzeFolderHierarchy } = require('./treemap');
const { cleanBatch } = require('./cleaner');
const { revealInExplorer } = require('./system');

const PORT = process.env.PORT || 4880;
const HOST = '127.0.0.1'; // Strictly loopback to guarantee privacy & no data leaks

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Global SSE clients for live scanning events
const sseClients = new Set();

function broadcastSSE(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 1e7) { // 10MB limit
        req.destroy();
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(data));
}

function serveStatic(req, res, pathname) {
  let safePath = pathname === '/' ? '/index.html' : pathname;
  // Prevent directory traversal
  const resolved = path.join(PUBLIC_DIR, path.normalize(safePath).replace(/^(\.\.[\/\\])+/, ''));

  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Access Denied');
  }

  const ext = path.extname(resolved).toLowerCase();
  const mimeMap = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon'
  };

  fs.readFile(resolved, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        return res.end('Not Found');
      }
      res.writeHead(500);
      return res.end('Server Error');
    }

    res.writeHead(200, {
      'Content-Type': mimeMap[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // CORS for local requests
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  // 1. SSE Progress Endpoint
  if (req.method === 'GET' && pathname === '/api/scan/progress') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write(':\n\n'); // Send initial ping
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // 2. Drives Endpoint
  if (req.method === 'GET' && pathname === '/api/drives') {
    try {
      const drives = await getWindowsDrives();
      return sendJson(res, 200, { success: true, drives });
    } catch (e) {
      return sendJson(res, 500, { success: false, error: e.message });
    }
  }

  // 3. Scan Common Bloat Areas
  if (req.method === 'GET' && pathname === '/api/scan/bloat') {
    try {
      broadcastSSE('scan_start', { type: 'bloat' });
      const result = await scanBloatAreas((progress) => {
        broadcastSSE('scan_progress', progress);
      });
      broadcastSSE('scan_complete', { type: 'bloat', summary: result.formattedTotal });
      return sendJson(res, 200, { success: true, ...result });
    } catch (e) {
      return sendJson(res, 500, { success: false, error: e.message });
    }
  }

  // 4. Scan Project Bloat
  if (req.method === 'POST' && pathname === '/api/scan/projects') {
    try {
      const body = await parseBody(req);
      const rootPath = body.rootPath || 'C:\\';
      const maxDepth = body.maxDepth || 6;

      broadcastSSE('scan_start', { type: 'projects', rootPath });
      const result = await scanProjectBloat(rootPath, { maxDepth }, (progress) => {
        broadcastSSE('scan_progress', progress);
      });
      broadcastSSE('scan_complete', { type: 'projects', summary: result.formattedTotal });
      return sendJson(res, 200, { success: true, rootPath, ...result });
    } catch (e) {
      return sendJson(res, 500, { success: false, error: e.message });
    }
  }

  // 5. Scan Large Files
  if (req.method === 'POST' && pathname === '/api/scan/large-files') {
    try {
      const body = await parseBody(req);
      const rootPath = body.rootPath || 'C:\\';
      const minBytes = Number(body.minBytes) || 100 * 1024 * 1024;
      const category = body.category || 'all';

      broadcastSSE('scan_start', { type: 'large-files', rootPath });
      const result = await findLargeFiles(rootPath, { minBytes, category }, (progress) => {
        broadcastSSE('scan_progress', progress);
      });
      broadcastSSE('scan_complete', { type: 'large-files', summary: result.formattedTotal });
      return sendJson(res, 200, { success: true, rootPath, ...result });
    } catch (e) {
      return sendJson(res, 500, { success: false, error: e.message });
    }
  }

  // 6. Treemap / Directory Hierarchy
  if (req.method === 'POST' && pathname === '/api/scan/treemap') {
    try {
      const body = await parseBody(req);
      const rootPath = body.rootPath || 'C:\\';
      const depth = Number(body.depth) || 2;

      broadcastSSE('scan_start', { type: 'treemap', rootPath });
      const result = await analyzeFolderHierarchy(rootPath, depth, (progress) => {
        broadcastSSE('scan_progress', progress);
      });
      broadcastSSE('scan_complete', { type: 'treemap' });
      return sendJson(res, 200, { success: true, ...result });
    } catch (e) {
      return sendJson(res, 500, { success: false, error: e.message });
    }
  }

  // 7. Duplicate File Hunter
  if (req.method === 'POST' && pathname === '/api/scan/duplicates') {
    try {
      const body = await parseBody(req);
      const rootPath = body.rootPath || 'C:\\';
      const matchMode = body.matchMode || 'name'; // 'name' | 'name_size' | 'exact'
      const category = body.category || 'all';
      const minSizeBytes = Number(body.minSizeBytes) || 0;
      const ignoreDevDirs = body.ignoreDevDirs !== false;
      const includeWindowsDir = !!body.includeWindowsDir;
      const limit = Number(body.limit) || 1000;

      broadcastSSE('scan_start', { type: 'duplicates', rootPath });
      const result = await findDuplicateFiles(
        rootPath,
        { matchMode, category, minSizeBytes, ignoreDevDirs, includeWindowsDir, limit },
        (progress) => {
          broadcastSSE('scan_progress', progress);
        }
      );
      broadcastSSE('scan_complete', {
        type: 'duplicates',
        summary: `${result.totalGroupsCount} duplicate sets (${result.formattedTotalWasted} wasted)`
      });
      return sendJson(res, 200, { success: true, rootPath, ...result });
    } catch (e) {
      return sendJson(res, 500, { success: false, error: e.message });
    }
  }

  // 8. Clean Action
  if (req.method === 'POST' && pathname === '/api/clean') {
    try {
      const body = await parseBody(req);
      const items = body.items || [];
      const dryRun = !!body.dryRun;
      const safeRecycle = body.safeRecycle !== false; // Default true (safe mode)

      if (!items.length) {
        return sendJson(res, 400, { success: false, error: 'No items provided for cleaning.' });
      }

      const result = await cleanBatch(items, { dryRun, safeRecycle });
      return sendJson(res, 200, result);
    } catch (e) {
      return sendJson(res, 500, { success: false, error: e.message });
    }
  }

  // 9. Open in Windows File Explorer
  if (req.method === 'POST' && pathname === '/api/open-explorer') {
    try {
      const body = await parseBody(req);
      if (body.path) {
        await revealInExplorer(body.path);
        return sendJson(res, 200, { success: true });
      }
      return sendJson(res, 400, { success: false, error: 'Path required' });
    } catch (e) {
      return sendJson(res, 500, { success: false, error: e.message });
    }
  }

  // 10. Local Image Thumbnail Preview
  if (req.method === 'GET' && pathname === '/api/preview-thumbnail') {
    const filePath = parsedUrl.query.path;
    if (!filePath) {
      res.writeHead(400);
      return res.end('Path required');
    }
    const ext = path.extname(filePath).toLowerCase();
    const imageMimes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon'
    };
    const mime = imageMimes[ext];
    if (!mime) {
      res.writeHead(415);
      return res.end('Unsupported preview type');
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end('Not found');
      }
      res.writeHead(200, {
        'Content-Type': mime,
        'Cache-Control': 'max-age=86400'
      });
      res.end(data);
    });
    return;
  }

  // Default: Serve frontend static files
  serveStatic(req, res, pathname);
});

function startServer(port = PORT) {
  return new Promise((resolve, reject) => {
    server.listen(port, HOST, () => {
      const address = `http://${HOST}:${port}`;
      console.log(`[SpaceHunter Server] Running securely at ${address}`);
      resolve({ server, port, address });
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`Port ${port} in use, trying ${port + 1}...`);
        resolve(startServer(port + 1));
      } else {
        reject(err);
      }
    });
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  startServer,
  server,
  PORT,
  HOST
};
