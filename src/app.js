const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const healthRoutes = require('./routes/health.routes');
const usageRoutes = require('./routes/usage.routes');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(healthRoutes);
app.use(usageRoutes);

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(error.statusCode || 500).json({
    status: 'error',
    message: error.statusCode ? error.message : 'Internal server error'
  });
});

module.exports = app;
