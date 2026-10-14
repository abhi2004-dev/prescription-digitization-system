/**
 * scripts/start-dev.js
 *
 * Automated LAN development launcher for React Native / Expo.
 *
 * Automatically detects the current active LAN IPv4 address on your machine,
 * configures Metro/Expo (REACT_NATIVE_PACKAGER_HOSTNAME) and the frontend
 * API base URL (EXPO_PUBLIC_API_URL), then launches the Expo development server.
 *
 * Zero manual IP configuration required when switching networks (Hotspot, Wi-Fi, etc.).
 */

const os = require('os');
const { spawn } = require('child_process');

const BACKEND_PORT = 8000;
const BACKEND_API_PATH = '/api/v1';

/**
 * Parses command line arguments passed to the script.
 * Supports:
 *   --ip=<custom_ip>
 *   --port=<custom_port>
 *   --interface=<interface_name>
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const forwardedArgs = [];
  let customIp = null;
  let customPort = BACKEND_PORT;

  for (const arg of args) {
    if (arg.startsWith('--ip=')) {
      customIp = arg.split('=')[1];
    } else if (arg.startsWith('--backend-port=')) {
      customPort = parseInt(arg.split('=')[1], 10) || BACKEND_PORT;
    } else {
      forwardedArgs.push(arg);
    }
  }

  return { customIp, customPort, forwardedArgs };
}

/**
 * Discovers and scores all non-internal IPv4 interfaces on the host machine.
 */
function getAvailableIPv4Addresses() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal && addr.address !== '127.0.0.1') {
        const lowerName = name.toLowerCase();

        // Identify virtual/adapter interfaces (WSL, Hyper-V, VirtualBox, Docker)
        const isVirtual =
          lowerName.includes('vethernet') ||
          lowerName.includes('virtualbox') ||
          lowerName.includes('vmware') ||
          lowerName.includes('wsl') ||
          lowerName.includes('docker') ||
          lowerName.includes('loopback');

        // Identify Hotspot adapters (e.g. Windows Mobile Hotspot "Local Area Connection* X")
        const isHotspot =
          lowerName.includes('local area connection*') ||
          lowerName.includes('hotspot') ||
          addr.address.startsWith('192.168.137.');

        // Identify Wi-Fi / Wireless adapters
        const isWifi =
          lowerName.includes('wi-fi') ||
          lowerName.includes('wifi') ||
          lowerName.includes('wireless') ||
          lowerName.includes('wlan');

        // Identify Ethernet adapters
        const isEthernet =
          lowerName.includes('ethernet') ||
          lowerName.includes('eth');

        let score = 50;
        if (isHotspot) score = 100;
        else if (isWifi) score = 90;
        else if (isEthernet) score = 80;
        if (isVirtual) score = 10;

        candidates.push({
          name,
          address: addr.address,
          score,
          isVirtual,
          isHotspot,
          isWifi,
          isEthernet,
        });
      }
    }
  }

  // Sort descending by priority score
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

/**
 * Selects the best active LAN IPv4 address or uses user override.
 */
function detectActiveLanIp(customIp) {
  if (customIp) {
    console.log(`\n📌 Using manual IP override: ${customIp}`);
    return customIp;
  }

  const candidates = getAvailableIPv4Addresses();

  if (candidates.length === 0) {
    console.warn('\n⚠️  No active LAN IPv4 network interface found. Falling back to 127.0.0.1.');
    return '127.0.0.1';
  }

  console.log('\n📡 Scanning Network Interfaces...');
  candidates.forEach((c, idx) => {
    const isSelected = idx === 0 ? ' [ACTIVE SELECTION]' : '';
    console.log(`   • ${c.name.padEnd(28)} -> ${c.address}${isSelected}`);
  });

  const selected = candidates[0];
  return selected.address;
}

function startDev() {
  const { customIp, customPort, forwardedArgs } = parseArgs();
  const detectedIp = detectActiveLanIp(customIp);
  const apiUrl = `http://${detectedIp}:${customPort}${BACKEND_API_PATH}`;

  console.log('\n======================================================');
  console.log(`🚀 Automated Development Configuration:`);
  console.log(`   • Host LAN IP:      ${detectedIp}`);
  console.log(`   • Backend API URL:  ${apiUrl}`);
  console.log(`   • Target Backend:   http://0.0.0.0:${customPort}`);
  console.log('======================================================\n');

  // Inject detected IP into Expo environment
  const env = {
    ...process.env,
    REACT_NATIVE_PACKAGER_HOSTNAME: detectedIp,
    EXPO_PUBLIC_BACKEND_IP: detectedIp,
    EXPO_PUBLIC_API_URL: apiUrl,
  };

  // Build Expo arguments using local Expo CLI
  let expoCli;
  try {
    expoCli = require.resolve('expo/bin/cli');
  } catch (e) {
    expoCli = 'expo';
  }

  const childArgs = [expoCli, 'start', '--host', 'lan', ...forwardedArgs];

  console.log(`Launching Metro: node ${childArgs.join(' ')}\n`);

  const child = spawn(process.execPath, childArgs, {
    stdio: 'inherit',
    env,
  });

  child.on('error', (err) => {
    console.error('Failed to start Expo development server:', err);
    process.exit(1);
  });

  child.on('close', (code) => {
    process.exit(code || 0);
  });
}

startDev();
