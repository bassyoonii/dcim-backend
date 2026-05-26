#!/usr/bin/env node

/**
 * Test script for Prometheus VMs API
 * 
 * Usage:
 *   node test-vms-api.js
 * 
 * Tests:
 * 1. GET /api/vms/active - Active VMs only
 * 2. GET /api/vms - All VMs with status
 * 3. GET /api/vms/status - Single VM status check
 */

require('dotenv').config({ path: './.env' });

const axios = require('axios');

const API_BASE_URL = `http://localhost:${process.env.PORT || 5000}`;

async function testVMsAPI() {
  console.log('='.repeat(60));
  console.log('Prometheus VMs API Test');
  console.log('='.repeat(60));
  console.log(`API Base URL: ${API_BASE_URL}\n`);

  // Test 1: Get active VMs
  console.log('[Test 1] GET /api/vms/active - Fetch active VMs only');
  console.log('-'.repeat(60));
  try {
    const response = await axios.get(`${API_BASE_URL}/api/vms/active`, { timeout: 5000 });
    console.log('✓ Success');
    console.log(`  Count: ${response.data.count}`);
    console.log(`  VMs: ${response.data.vms.join(', ') || 'none'}`);
    console.log(`  Response:`, JSON.stringify(response.data, null, 2));
  } catch (err) {
    console.error('✗ Failed');
    console.error(`  Error: ${err.message}`);
    if (err.response) {
      console.error(`  Status: ${err.response.status}`);
      console.error(`  Response:`, err.response.data);
    }
  }

  console.log('\n');

  // Test 2: Get all VMs
  console.log('[Test 2] GET /api/vms - Fetch all VMs (active + inactive)');
  console.log('-'.repeat(60));
  try {
    const response = await axios.get(`${API_BASE_URL}/api/vms`, { timeout: 5000 });
    console.log('✓ Success');
    console.log(`  Total: ${response.data.count}`);
    console.log(`  Active: ${response.data.activeCount}`);
    console.log(`  Response:`, JSON.stringify(response.data, null, 2));
  } catch (err) {
    console.error('✗ Failed');
    console.error(`  Error: ${err.message}`);
    if (err.response) {
      console.error(`  Status: ${err.response.status}`);
      console.error(`  Response:`, err.response.data);
    }
  }

  console.log('\n');

  // Test 3: Get status of a specific VM
  const testInstance = '192.168.139.128:9100';
  console.log(`[Test 3] GET /api/vms/status?instance=${testInstance}`);
  console.log('-'.repeat(60));
  try {
    const response = await axios.get(`${API_BASE_URL}/api/vms/status`, {
      params: { instance: testInstance },
      timeout: 5000,
    });
    console.log('✓ Success');
    console.log(`  Instance: ${response.data.instance}`);
    console.log(`  Up: ${response.data.up}`);
    console.log(`  Response:`, JSON.stringify(response.data, null, 2));
  } catch (err) {
    console.error('✗ Failed');
    console.error(`  Error: ${err.message}`);
    if (err.response) {
      console.error(`  Status: ${err.response.status}`);
      console.error(`  Response:`, err.response.data);
    }
  }

  console.log('\n');

  // Test 4: Error handling - missing instance parameter
  console.log('[Test 4] GET /api/vms/status (missing instance param) - Error handling');
  console.log('-'.repeat(60));
  try {
    const response = await axios.get(`${API_BASE_URL}/api/vms/status`, { timeout: 5000 });
    console.log('✗ Should have failed (missing parameter)');
    console.log(`  Response:`, response.data);
  } catch (err) {
    if (err.response?.status === 400) {
      console.log('✓ Correctly returned 400 Bad Request');
      console.log(`  Error: ${err.response.data.message}`);
    } else {
      console.error('✗ Unexpected error');
      console.error(`  Status: ${err.response?.status}`);
      console.error(`  Error: ${err.message}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Tests completed');
  console.log('='.repeat(60));
}

// Run tests
testVMsAPI().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
