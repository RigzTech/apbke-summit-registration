require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const express = require('express');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  console.log('[Startup] Creating missing data directory:', dataDir);
  fs.mkdirSync(dataDir, { recursive: true });
}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use('/api/mpesa/callback', express.text({ type: '*/*' }), (req, res, next) => {
  if (typeof req.body === 'string' && req.body.length > 0) {
    try {
      req.body = JSON.parse(req.body);
    } catch (e) {
      try {
        const qs = require('querystring');
        req.body = qs.parse(req.body);
      } catch (e2) {
        console.warn('Could not parse body');
      }
    }
  }
  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

app.use(helmet());

// Production rate limiting
const limiter = rateLimit({
  windowMs: process.env.NODE_ENV === 'production' ? 15 * 60 * 1000 : 60 * 60 * 1000, 
  max: process.env.NODE_ENV === 'production' ? 100 : 1000,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', limiter);

// Serve frontend
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.use('/api/register', require('./routes/register'));
app.use('/api/mpesa', require('./routes/mpesa'));
app.use('/api/contact', require('./routes/contact'));

// Production error handling
if (process.env.NODE_ENV === 'production') {
  app.use((err, req, res, next) => {
    console.error('Production Error:', err);
    
    // Don't leak error details in production
    res.status(err.status || 500).json({
      success: false,
      message: 'Internal server error',
      ...(process.env.DEBUG === 'true' && { error: err.message })
    });
  });
}

// 404 handler for API routes (must be after all other routes)
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'API endpoint not found'
  });
});

app.listen(PORT, () => {
  const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
  console.log('------------------------------------------------------');
  console.log(`🚀 Server running at ${baseUrl}`);
  console.log(`📁 Entry Point: ${__filename}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔌 Port: ${PORT}`);
  console.log('------------------------------------------------------');
});
