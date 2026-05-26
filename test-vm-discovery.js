#!/usr/bin/env node

/**
 * VM Discovery Test Script
 * 
 * Usage:
 *   node test-vm-discovery.js
 * 
 * This script tests the VM discovery functionality without running the full server.
 */

require('dotenv').config({ path: './.env' });

const {
  discoverVMs,
  parseIPsFromInput,
  isValidIP,
  ipRangeFromCIDR,
} = require('./utils/vmDiscovery');

async function runTests() {
  console.log('='.repeat(60));
  console.log('VM Discovery Test Suite');
  console.log('='.repeat(60));

  // Test 1: IP Validation
  console.log('\n[Test 1] IP Validation');
  console.log('isValidIP("192.168.139.1"):', isValidIP('192.168.139.1')); // true
  console.log('isValidIP("256.1.1.1"):', isValidIP('256.1.1.1')); // false
  console.log('isValidIP("invalid"):', isValidIP('invalid')); // false

  // Test 2: Parse IPs from CIDR
  console.log('\n[Test 2] Parse CIDR (192.168.139.0/30)');
  const cidrIPs = ipRangeFromCIDR('192.168.139.0/30');
  console.log(`Found ${cidrIPs.length} IPs:`, cidrIPs);

  // Test 3: Parse IPs from comma-separated list
  console.log('\n[Test 3] Parse comma-separated IPs');
  const csvIPs = parseIPsFromInput('192.168.139.10,192.168.139.20,192.168.139.30');
  console.log(`Found ${csvIPs.length} IPs:`, csvIPs);

  // Test 4: Parse from single IP
  console.log('\n[Test 4] Parse single IP');
  const singleIP = parseIPsFromInput('192.168.139.50');
  console.log(`Found ${singleIP.length} IP(s):`, singleIP);

  // Test 5: Full discovery (actual HTTP checks)
  console.log('\n[Test 5] Full VM Discovery');
  console.log('Running discovery with current config:');
  console.log(`  - Subnet/IPs: ${process.env.VM_DISCOVERY_SUBNET || process.env.VM_DISCOVERY_IPS || 'not set'}`);
  console.log(`  - Exporter Port: ${process.env.NODE_EXPORTER_PORT || 9100}`);
  console.log(`  - Check Timeout: ${process.env.VM_CHECK_TIMEOUT || 2000}ms`);
  console.log('');

  try {
    const result = await discoverVMs();
    console.log('Discovery Result:');
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Discovery failed:', err.message);
  }

  console.log('\n' + '='.repeat(60));
  console.log('Tests completed');
  console.log('='.repeat(60));
}

// Run tests
runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
