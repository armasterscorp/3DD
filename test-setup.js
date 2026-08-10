#!/usr/bin/env node

/**
 * Quick test script to verify setup is working
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const FRONTEND_PORT = 7200;
const API_PORT = 7201;
const DB_STUDIO_PORT = 5555;

const tests = [];

// Test frontend
tests.push({
  name: 'Frontend',
  url: `http://localhost:${FRONTEND_PORT}`,
  port: FRONTEND_PORT,
  type: 'http',
});

// Test API
tests.push({
  name: 'API',
  url: `http://localhost:${API_PORT}/api/health`,
  port: API_PORT,
  type: 'http',
});

// Test Database Studio
tests.push({
  name: 'Database Studio',
  url: `http://localhost:${DB_STUDIO_PORT}`,
  port: DB_STUDIO_PORT,
  type: 'http',
});

// Check env file
tests.push({
  name: '.env.local file',
  check: () => {
    return fs.existsSync(path.join(process.cwd(), '.env.local'));
  },
});

async function testConnection(url) {
  return new Promise((resolve) => {
    const client = http.get(url, (res) => {
      client.abort();
      resolve(res.statusCode < 400);
    });

    client.on('error', () => {
      resolve(false);
    });

    setTimeout(() => {
      client.abort();
      resolve(false);
    }, 2000);
  });
}

async function runTests() {
  console.log('\n🧪 3D Suite Setup Verification\n');
  console.log('================================\n');

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    if (test.check) {
      const result = test.check();
      if (result) {
        console.log(`✅ ${test.name}`);
        passed++;
      } else {
        console.log(`❌ ${test.name}`);
        failed++;
      }
    } else if (test.type === 'http') {
      process.stdout.write(`⏳ Testing ${test.name}... `);
      const result = await testConnection(test.url);
      if (result) {
        console.log('✅');
        passed++;
      } else {
        console.log('❌');
        failed++;
      }
    }
  }

  console.log('\n================================\n');

  if (failed === 0) {
    console.log(`✅ All tests passed (${passed}/${passed})\n`);
    console.log('🎉 Your setup is ready!\n');
    console.log('Access the application:');
    console.log(`  Frontend: http://localhost:${FRONTEND_PORT}`);
    console.log(`  API:      http://localhost:${API_PORT}/api/health`);
    console.log(`  Database: http://localhost:${DB_STUDIO_PORT}\n`);
  } else {
    console.log(`⚠️  ${failed} test(s) failed\n`);
    console.log('Troubleshooting:');
    console.log('1. Make sure Docker is running: docker ps');
    console.log('2. Check .env.local exists and is configured');
    console.log('3. Ensure dev servers are running: npm run dev');
    console.log('4. Check firewall settings\n');
  }
}

runTests().catch(console.error);
