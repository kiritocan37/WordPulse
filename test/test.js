'use strict';

const http = require('http');
const assert = require('assert');
const { spawn } = require('child_process');

const PORT = 3001; // Use different port for testing
let serverProcess;

function makeRequest(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${PORT}${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`Status ${res.statusCode}: ${data}`));
        } else {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        }
      });
    }).on('error', reject);
  });
}

async function runTests() {
  console.log('Starting test suite...');
  
  try {
    const startTime = Date.now();
    const articlesEn = await makeRequest('/api/articles?lang=en');
    const loadTime = Date.now() - startTime;
    
    console.log(`[Test] Cold start load time: ${loadTime}ms`);
    assert(loadTime < 10000, 'Server should respond within 10 seconds');
    assert(Array.isArray(articlesEn) && articlesEn.length > 0, 'Should return articles');
    
    // (a) Articles returned with non-empty titles
    console.log('[Test] Validating article structure...');
    articlesEn.forEach(a => {
      assert(a.title && a.title.trim().length > 0, 'Article title cannot be empty');
      assert(a.source, 'Article must have a source');
      assert(a.country, 'Article must have a country');
    });
    
    // (b) At least 3 different source countries appear
    console.log('[Test] Checking source diversity...');
    const countries = new Set(articlesEn.map(a => a.country));
    assert(countries.size >= 3, `Expected at least 3 source countries, found ${countries.size}`);
    
    // (c) Translation endpoint test (comparing RU to EN for a Russian source, etc.)
    console.log('[Test] Checking translation functionality...');
    const articlesRu = await makeRequest('/api/articles?lang=ru');
    assert(Array.isArray(articlesRu) && articlesRu.length > 0, 'Should return articles for ru lang');
    
    // Find an originally non-RU article to ensure it was translated into RU
    const enSourceArticle = articlesEn.find(a => a.originalLang === 'en');
    if (enSourceArticle) {
      const translated = articlesRu.find(a => a.link === enSourceArticle.link);
      if (translated) {
        // Just checking that the text changed
        // Note: translation might be the same for proper nouns, but titles should differ
        console.log(`Original (EN): ${enSourceArticle.title}`);
        console.log(`Translated (RU): ${translated.title}`);
        assert(enSourceArticle.title !== translated.title, 'Translated title should differ from original');
      }
    }
    
    console.log('All tests passed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
}

// Start server
console.log(`Starting server on port ${PORT}...`);
serverProcess = spawn('node', ['server.js'], {
  env: { ...process.env, PORT: PORT.toString() }
});

let outputStr = '';
serverProcess.stdout.on('data', (data) => {
  outputStr += data.toString();
  if (outputStr.includes(`port ${PORT}`)) {
    runTests();
  }
});

serverProcess.stderr.on('data', (data) => {
  console.error(`Server error: ${data}`);
});

serverProcess.on('close', (code) => {
  if (code !== 0) {
    console.error(`Server process exited with code ${code}`);
    process.exit(code);
  }
});

// Cleanup on exit
process.on('exit', () => {
  if (serverProcess) serverProcess.kill();
});
