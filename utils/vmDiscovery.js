const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * VM Discovery Service for Prometheus
 * 
 * Automatically discovers active VMs in a subnet or predefined IP list
 * by checking for node_exporter on port 9100, then generates a
 * Prometheus file_sd_configs target file.
 */

// Configuration
const CONFIG = {
  // Subnet to scan (CIDR notation) or individual IPs to check
  SUBNET_OR_IPS: process.env.VM_DISCOVERY_SUBNET || process.env.VM_DISCOVERY_IPS || '192.168.139.0/24',
  
  // Port where node_exporter listens
  EXPORTER_PORT: parseInt(process.env.NODE_EXPORTER_PORT || '9100', 10),
  
  // HTTP timeout for checks (ms)
  CHECK_TIMEOUT: parseInt(process.env.VM_CHECK_TIMEOUT || '2000', 10),
  
  // Target file paths (primary and fallback)
  TARGET_FILE_PRIMARY: '/etc/prometheus/targets/vm.json',
  TARGET_FILE_FALLBACK: './vm.json',
  
  // Job name in Prometheus labels
  JOB_NAME: process.env.VM_JOB_NAME || 'vm-servers',
  
  // Concurrency for HTTP checks (avoid overwhelming network)
  CHECK_CONCURRENCY: parseInt(process.env.VM_CHECK_CONCURRENCY || '20', 10),
};

/**
 * Parse CIDR notation or comma-separated IPs into array of IPs
 * @param {string} input - CIDR notation (e.g. "192.168.139.0/24") or "IP1,IP2,IP3"
 * @returns {string[]} Array of IP addresses
 */
function parseIPsFromInput(input) {
  if (!input) return [];

  // If contains commas, treat as comma-separated list
  if (input.includes(',')) {
    return input
      .split(',')
      .map((ip) => ip.trim())
      .filter((ip) => ip && isValidIP(ip));
  }

  // Otherwise treat as CIDR
  if (input.includes('/')) {
    return ipRangeFromCIDR(input);
  }

  // Single IP
  if (isValidIP(input)) {
    return [input];
  }

  return [];
}

/**
 * Validate IPv4 address format
 * @param {string} ip
 * @returns {boolean}
 */
function isValidIP(ip) {
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = ip.match(ipv4Regex);
  if (!match) return false;
  return match.slice(1, 5).every((octet) => parseInt(octet, 10) <= 255);
}

/**
 * Generate IP range from CIDR notation
 * Simple implementation: only supports /24, /25, /26, /27, /28, /29, /30, /31, /32
 * @param {string} cidr - e.g. "192.168.139.0/24"
 * @returns {string[]} Array of IPs
 */
function ipRangeFromCIDR(cidr) {
  const [network, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr, 10);

  if (!isValidIP(network)) return [];

  const [a, b, c, d] = network.split('.').map((x) => parseInt(x, 10));
  const networkNum = (a << 24) | (b << 16) | (c << 8) | d;

  // Calculate number of hosts: 2^(32 - prefix)
  const hostBits = 32 - prefix;
  const numHosts = Math.pow(2, hostBits);

  // Limit to avoid memory issues; if > 1000, skip most
  const maxIPs = prefix >= 22 ? numHosts : Math.min(1000, numHosts);
  const ips = [];

  for (let i = 0; i < maxIPs; i++) {
    const ip = networkNum + i;
    const ipStr = `${(ip >>> 24) & 0xff}.${(ip >>> 16) & 0xff}.${(ip >>> 8) & 0xff}.${ip & 0xff}`;
    // Skip network and broadcast for /24 and smaller subnets
    if (hostBits > 1 && (i === 0 || i === maxIPs - 1)) continue;
    ips.push(ipStr);
  }

  return ips;
}

/**
 * Check if node_exporter is running on a given IP:PORT
 * @param {string} ip
 * @param {number} port
 * @returns {Promise<boolean>} true if responsive, false otherwise
 */
async function checkNodeExporter(ip, port) {
  try {
    const url = `http://${ip}:${port}/metrics`;
    const response = await axios.get(url, {
      timeout: CONFIG.CHECK_TIMEOUT,
      // Prevent following redirects (we just need a quick response)
      maxRedirects: 0,
    });
    // Any 2xx status means node_exporter is likely running
    return response.status >= 200 && response.status < 300;
  } catch (err) {
    // Timeout, connection refused, unreachable, etc. = node_exporter down
    return false;
  }
}

/**
 * Check multiple IPs concurrently with limited concurrency
 * @param {string[]} ips
 * @returns {Promise<string[]>} Array of IPs where node_exporter is active
 */
async function checkIPsConcurrent(ips) {
  const results = [];
  const activeIPs = [];

  // Process in batches
  for (let i = 0; i < ips.length; i += CONFIG.CHECK_CONCURRENCY) {
    const batch = ips.slice(i, i + CONFIG.CHECK_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((ip) => checkNodeExporter(ip, CONFIG.EXPORTER_PORT))
    );
    batchResults.forEach((isActive, idx) => {
      if (isActive) {
        activeIPs.push(batch[idx]);
      }
    });
  }

  return activeIPs;
}

/**
 * Generate Prometheus file_sd_configs format
 * @param {string[]} activeIPs
 * @returns {object[]} Target configuration array
 */
function generatePrometheusTargets(activeIPs) {
  if (activeIPs.length === 0) {
    return [];
  }

  return [
    {
      targets: activeIPs.map((ip) => `${ip}:${CONFIG.EXPORTER_PORT}`),
      labels: { job: CONFIG.JOB_NAME },
    },
  ];
}

/**
 * Write targets to file (try primary, fallback to secondary)
 * @param {object[]} targets
 * @returns {Promise<string>} Path where file was written
 */
async function writeTargetsFile(targets) {
  const json = JSON.stringify(targets, null, 2);

  // Try primary location
  try {
    const dir = path.dirname(CONFIG.TARGET_FILE_PRIMARY);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CONFIG.TARGET_FILE_PRIMARY, json, 'utf8');
    console.log(`[vmDiscovery] ✓ Written targets to ${CONFIG.TARGET_FILE_PRIMARY}`);
    return CONFIG.TARGET_FILE_PRIMARY;
  } catch (err) {
    console.warn(
      `[vmDiscovery] ⚠ Could not write to ${CONFIG.TARGET_FILE_PRIMARY}: ${err.message}`
    );
  }

  // Fallback location
  try {
    fs.writeFileSync(CONFIG.TARGET_FILE_FALLBACK, json, 'utf8');
    console.log(`[vmDiscovery] ✓ Written targets to ${CONFIG.TARGET_FILE_FALLBACK}`);
    return CONFIG.TARGET_FILE_FALLBACK;
  } catch (err) {
    console.error(
      `[vmDiscovery] ✗ Could not write to fallback location ${CONFIG.TARGET_FILE_FALLBACK}: ${err.message}`
    );
    throw err;
  }
}

/**
 * Main VM discovery function
 * @returns {Promise<object>} Discovery result { activeCount, filePath, targets }
 */
async function discoverVMs() {
  console.log('[vmDiscovery] Starting VM discovery...');
  const startTime = Date.now();

  try {
    // Step 1: Parse IPs from config
    const ipList = parseIPsFromInput(CONFIG.SUBNET_OR_IPS);
    console.log(`[vmDiscovery] Scanning ${ipList.length} IP(s)...`);

    if (ipList.length === 0) {
      console.warn('[vmDiscovery] No valid IPs to scan');
      return { activeCount: 0, filePath: null, targets: [] };
    }

    // Step 2: Check which VMs have active node_exporter
    const activeIPs = await checkIPsConcurrent(ipList);
    console.log(`[vmDiscovery] Found ${activeIPs.length} active VM(s): ${activeIPs.join(', ') || 'none'}`);

    // Step 3: Generate Prometheus targets
    const targets = generatePrometheusTargets(activeIPs);

    // Step 4: Write to file
    const filePath = await writeTargetsFile(targets);

    const elapsed = Date.now() - startTime;
    console.log(`[vmDiscovery] ✓ Discovery completed in ${elapsed}ms`);

    return {
      activeCount: activeIPs.length,
      filePath,
      targets,
      activeIPs,
    };
  } catch (err) {
    console.error(`[vmDiscovery] ✗ Discovery failed: ${err.message}`);
    return {
      activeCount: 0,
      filePath: null,
      targets: [],
      error: err.message,
    };
  }
}

/**
 * Start periodic VM discovery (runs once on boot, then every interval)
 * @param {number} intervalMs - Discovery interval in milliseconds (default 30 seconds)
 * @returns {NodeJS.Timeout} Interval ID for cleanup if needed
 */
function startPeriodicDiscovery(intervalMs = 30000) {
  console.log(`[vmDiscovery] Starting periodic discovery (every ${intervalMs}ms)`);

  // Run once immediately
  discoverVMs().catch((err) => {
    console.error('[vmDiscovery] Initial discovery failed:', err);
  });

  // Then run periodically
  const intervalId = setInterval(() => {
    discoverVMs().catch((err) => {
      console.error('[vmDiscovery] Periodic discovery failed:', err);
    });
  }, intervalMs);

  return intervalId;
}

module.exports = {
  discoverVMs,
  startPeriodicDiscovery,
  parseIPsFromInput,
  isValidIP,
  ipRangeFromCIDR,
  generatePrometheusTargets,
  writeTargetsFile,
};
