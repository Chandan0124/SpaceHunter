const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Reveal a file or directory in Windows File Explorer
 */
function revealInExplorer(targetPath) {
  return new Promise((resolve, reject) => {
    try {
      const resolved = path.resolve(targetPath);
      // Windows explorer /select,"path" highlights the item in its parent folder
      exec(`explorer.exe /select,"${resolved}"`, (err) => {
        // explorer.exe often returns exit code 1 even on success, so we ignore error
        resolve();
      });
    } catch (e) {
      resolve();
    }
  });
}

/**
 * Launch Desktop App Mode using Edge or Chrome
 */
function launchDesktopApp(url) {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const windowArgs = [`--app=${url}`, '--window-size=1300,860', '--window-position=100,100'];

  if (fs.existsSync(edgePath)) {
    const child = spawn(edgePath, windowArgs, { detached: true, stdio: 'ignore' });
    child.unref();
    return { type: 'edge-app', path: edgePath };
  }

  if (fs.existsSync(chromePath)) {
    const child = spawn(chromePath, windowArgs, { detached: true, stdio: 'ignore' });
    child.unref();
    return { type: 'chrome-app', path: chromePath };
  }

  // Fallback: open default browser
  exec(`start "" "${url}"`);
  return { type: 'default-browser', path: 'default' };
}

module.exports = {
  revealInExplorer,
  launchDesktopApp
};
