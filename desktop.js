const { startServer } = require('./src/server');
const { launchDesktopApp } = require('./src/system');

async function main() {
  console.log('====================================================');
  console.log('   SpaceHunter - Local Deep Disk Space & Bloat Hunter');
  console.log('====================================================');
  console.log('[*] Initializing secure local server...');

  try {
    const { address } = await startServer(4880);
    console.log(`[*] Server active at ${address}`);
    console.log('[*] Launching SpaceHunter Desktop Window...');

    const appLaunch = launchDesktopApp(address);
    console.log(`[*] Desktop mode active (${appLaunch.type})`);
    console.log('[*] Press Ctrl+C in this terminal at any time to stop.');
  } catch (err) {
    console.error('[!] Failed to start SpaceHunter:', err);
    process.exit(1);
  }
}

main();
