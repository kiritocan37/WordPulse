'use strict';

const fs = require('fs');
const path = require('path');
const Sentry = require('@sentry/node');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const pino = require('pino-http');
const apiRoutes = require('./src/routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Read index.html template at startup
const indexHtmlTemplate = fs.readFileSync(
  path.join(__dirname, 'public', 'index.html'),
  'utf8'
);

// Sentry initialization
const sentryDsn = process.env.SENTRY_DSN || '';
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    tracesSampleRate: 1.0,
  });

  // The request handler must be the first middleware on the app
  app.use(Sentry.Handlers.requestHandler());
}

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

// Sitemap
app.get('/sitemap.xml', (req, res) => {
  const domain = 'https://word-pulse-nine.vercel.app';
  const lastModDate = new Date();
  const xmlLastMod = lastModDate.toISOString().split('T')[0]; // YYYY-MM-DD
  const httpLastMod = lastModDate.toUTCString();

  const urls = [
    {
      loc: domain + '/',
      lastmod: xmlLastMod,
      changefreq: 'daily',
      priority: '1.0'
    }
  ];

  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(url => '  <url>\n' +
      '    <loc>' + url.loc + '</loc>\n' +
      '    <lastmod>' + url.lastmod + '</lastmod>\n' +
      '    <changefreq>' + url.changefreq + '</changefreq>\n' +
      '    <priority>' + url.priority + '</priority>\n' +
      '  </url>').join('\n') +
    '\n</urlset>';

  res.setHeader('Last-Modified', httpLastMod);
  res.header('Content-Type', 'application/xml');
  res.send(xml);
});

// Sentry error handler and tracing (only if DSN is provided)
if (sentryDsn) {
  app.use(Sentry.Handlers.errorHandler());
}

// Fallback for SPA/Frontend
app.get(/(.*)/, (req, res) => {
  const sentryDsn = process.env.SENTRY_DSN || '';
  const modifiedHtml = indexHtmlTemplate.replace(
    /<meta name="sentry-dsn" content="[^"]*">/,
    `<meta name="sentry-dsn" content="${sentryDsn}">`
  );
  res.send(modifiedHtml);
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
