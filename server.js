'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const apiRoutes = require('./src/routes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
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
server.setTimeout(15000);

module.exports = app;
