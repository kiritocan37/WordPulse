'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const pino = require('pino-http');
const apiRoutes = require('./src/routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'https://word-pulse-nine.vercel.app'
}));

// Compression
app.use(compression());

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // limit each IP to 60 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Simple logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.path} ${res.statusCode} - ${duration}ms`);
  });
  next();
});

// Enhanced health check endpoint with system metrics
app.get('/health', async (req, res) => {
  try {
    // Basic health check
    const healthData = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      // Check if we can access cache (basic test)
      cacheStatus: 'unknown'
    };

    // Test cache connectivity
    try {
      const { cache } = require('./src/cache');
      // Try a simple cache operation
      await cache.getOrFetch('__health_check_test', async () => {
        return 'test';
      });
      healthData.cacheStatus = 'ok';
    } catch (cacheErr) {
      healthData.cacheStatus = 'error';
      healthData.cacheError = cacheErr.message;
      // Don't fail the health check for cache issues
    }

    res.status(200).json(healthData);
  } catch (err) {
    console.error('Health check failed:', err);
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: err.message
    });
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// API Routes
app.use('/api', apiRoutes);

// Fallback for SPA/Frontend
app.get(/(.*)/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = app.listen(PORT, () => {
  console.log(`WorldPulse server is running on port ${PORT}`);
});
server.setTimeout(60000); // Increased timeout to 60 seconds

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});

module.exports = app;
