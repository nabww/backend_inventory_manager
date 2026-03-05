require('dotenv').config();
const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const logger     = require('./config/logger');
const routes     = require('./routes');
const { errorHandler } = require('./middleware');
const { R } = require('./utils');

const app  = express();
const PORT = process.env.PORT || 5000;

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:3000', credentials: true }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200,
  handler: (req, res) => R.err(res, 'Too many requests', 429) }));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, _res, next) => {
  logger.debug(`${req.method} ${req.originalUrl}`);
  next();
});

app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));
app.use('/api', routes);
app.use((req, res) => R.err(res, `${req.method} ${req.originalUrl} not found`, 404));
app.use(errorHandler);

app.listen(PORT, () => logger.info(`🚀 Server on port ${PORT} [${process.env.NODE_ENV}]`));
module.exports = app;
