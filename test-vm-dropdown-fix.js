#!/usr/bin/env node

/**
 * Test Script: Verify VM Dropdown Fix
 * 
 * This script tests:
 * 1. Backend correctly filters only ACTIVE VMs (value === 1)
 * 2. Inactive VMs (value === 0) are NOT returned
 * 3. Multiple calls return consistent data
 * 
 * Usage:
 *   node test-vm-dropdown-fix.js
 */

require('dotenv').config({ path: './.env' });

const axios = require('axios');

const API_BASE_URL = `http://localhost:${process.env.PORT || 5000}`;
const PROMETHEUS_URL = process.env.PROMETHEUS_URL || 'http://localhost:9090';

console.log('='.repeat(70));
console.log('VM Dropdown Fix Validation Test');
console.log('='.repeat(70));
console.log(`API Base URL: ${API_BASE_URL}`);
console.log(`Prometheus URL: ${PROMETHEUS_URL}\n`);

/**
 * Test 1: Direct Prometheus Query
 */
async function testPrometheusQuery() {
  console.log('[Test 1] Direct Prometheus Query - Check all metrics');
  console.log('-'.repeat(70));
  try {
    const query = 'up{job="vm-servers"}';
    const url = `${PROMETHEUS_URL}/api/v1/query`;
    
    console.log(`Query: ${query}`);
    const response = await axios.get(url, {
      params: { query },
      timeout: 5000,
    });

    const results = response.data?.data?.result || [];
    console.log(`✓ Prometheus returned ${results.length} metric(s)\n`);

    if (results.length === 0) {
      console.warn('  ⚠ Warning: No metrics found. Check Prometheus is running and has vm-servers job.\n');
      return [];
    }

    console.log('  Metrics breakdown:');
    const active = results.filter(r => r.value?.[1] === '1' || r.value?.[1] === 1);
    const inactive = results.filter(r => r.value?.[1] === '0' || r.value?.[1] === 0);
    
    console.log(`    • Active (up=1):   ${active.length}`);
    active.forEach(m => console.log(`      └ ${m.metric?.instance}`));
    
    console.log(`    • Inactive (up=0): ${inactive.length}`);
    inactive.forEach(m => console.log(`      └ ${m.metric?.instance}`));
    
    console.log();
    return results;
  } catch (err) {
    console.error('✗ Failed');
    console.error(`  Error: ${err.message}\n`);
    return [];
  }
}

/**
 * Test 2: Backend /api/vms/active Endpoint
 */
async function testBackendActive() {
  console.log('[Test 2] Backend GET /api/vms/active - Should return ONLY active VMs');
  console.log('-'.repeat(70));
  try {
    const response = await axios.get(`${API_BASE_URL}/api/vms/active`, { timeout: 5000 });
    console.log('✓ Success');
    console.log(`  Count: ${response.data.count}`);
    console.log(`  VMs: ${response.data.vms.join(', ') || 'none'}`);
    
    if (response.data.count === 0) {
      console.log('  ⚠ No active VMs. All VMs are down or not monitored.');
    }
    
    console.log();
    return response.data;
  } catch (err) {
    console.error('✗ Failed');
    console.error(`  Error: ${err.message}`);
    if (err.response) {
      console.error(`  Status: ${err.response.status}`);
      console.error(`  Response:`, err.response.data);
    }
    console.log();
    return null;
  }
}

/**
 * Test 3: Multiple Calls - Consistency Check
 */
async function testMultipleCalls() {
  console.log('[Test 3] Multiple Backend Calls - Verify consistency (no stale data)');
  console.log('-'.repeat(70));
  try {
    const results = [];
    
    for (let i = 1; i <= 3; i++) {
      const response = await axios.get(`${API_BASE_URL}/api/vms/active`, { timeout: 5000 });
      results.push(response.data.vms);
      console.log(`  Call ${i}: ${response.data.vms.length} VM(s) - ${response.data.vms.join(', ') || 'none'}`);
    }

    // Check consistency
    const allSame = results.every(r => 
      r.length === results[0].length && 
      r.every(vm => results[0].includes(vm))
    );

    if (allSame) {
      console.log('✓ All calls returned consistent data (GOOD)');
    } else {
      console.warn('⚠ Data changed between calls (expected if VMs changed state)');
    }
    console.log();
  } catch (err) {
    console.error('✗ Failed');
    console.error(`  Error: ${err.message}\n`);
  }
}

/**
 * Test 4: Verify No Inactive VMs Returned
 */
async function testNoInactiveVMs() {
  console.log('[Test 4] Verify Inactive VMs are NOT returned by backend');
  console.log('-'.repeat(70));
  try {
    // Get all VMs from Prometheus
    const query = 'up{job="vm-servers"}';
    const promResponse = await axios.get(`${PROMETHEUS_URL}/api/v1/query`, {
      params: { query },
      timeout: 5000,
    });
    const allMetrics = promResponse.data?.data?.result || [];
    const inactiveFromProm = allMetrics.filter(r => r.value?.[1] === '0' || r.value?.[1] === 0);

    // Get active VMs from backend
    const backendResponse = await axios.get(`${API_BASE_URL}/api/vms/active`, { timeout: 5000 });
    const activeFromBackend = backendResponse.data.vms;

    console.log(`  Prometheus shows ${inactiveFromProm.length} INACTIVE VM(s):`);
    inactiveFromProm.forEach(m => console.log(`    • ${m.metric?.instance} (up=${m.value?.[1]})`));

    console.log(`\n  Backend returns ${activeFromBackend.length} ACTIVE VM(s):`);
    activeFromBackend.forEach(vm => console.log(`    • ${vm}`));

    // Check for any overlap
    const hasInactive = inactiveFromProm.some(m => 
      activeFromBackend.includes(m.metric?.instance)
    );

    if (hasInactive) {
      console.error('\n✗ ERROR: Backend returned INACTIVE VMs! This is the bug.');
      console.error('  → Fix: Backend must filter value === "1" only');
    } else {
      console.log('\n✓ GOOD: No inactive VMs in backend response');
    }
    console.log();
  } catch (err) {
    console.error('✗ Test failed');
    console.error(`  Error: ${err.message}\n`);
  }
}

/**
 * Main Test Runner
 */
async function runAllTests() {
  try {
    await testPrometheusQuery();
    const backendData = await testBackendActive();
    
    if (backendData) {
      await testMultipleCalls();
      await testNoInactiveVMs();
    }

    console.log('='.repeat(70));
    console.log('Test Suite Completed');
    console.log('='.repeat(70));
    console.log('\nSummary:');
    console.log('- If Test 4 shows ✓, the fix is working correctly');
    console.log('- If Test 4 shows ✗, backend is still returning inactive VMs');
    console.log('- Frontend will then hide them on next refresh (every 5s)\n');
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  }
}

// Run tests
runAllTests();
