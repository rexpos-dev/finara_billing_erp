require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 5000;

// Trust the first proxy hop (Railway/other PaaS edge) so X-Forwarded-For
// is honored for correct client IPs and express-rate-limit.
app.set('trust proxy', 1);

// ─── API Docs (Swagger UI) ────────────────────────────────────
// Mounted before helmet so the Swagger UI assets aren't blocked by CSP.
try {
  const swaggerUi = require('swagger-ui-express');
  const openapiSpec = require('./docs/openapi');
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec, { customSiteTitle: 'Finara ERP API Docs' }));
  app.get('/api/docs.json', (req, res) => res.json(openapiSpec));
} catch (e) {
  logger.error(`[docs] Swagger UI unavailable: ${e.message}`);
}

// ─── Security Middleware ──────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
    },
  },
}));

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-business-id'],
  credentials: true,
}));

// ─── Global Rate Limiter ──────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // stricter for auth endpoints
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
});

app.use(globalLimiter);
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ─── HTTP Logging ──────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: { write: (msg) => logger.info(msg.trim()) },
  }));
}

// ─── Health Check ──────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), env: process.env.NODE_ENV });
});

// ─── DB Diagnostic (temporary) ─────────────────────────────
// Tests the database connection with a short timeout so it can never hang.
// Reports whether the DB is reachable and whether the admin user exists.
app.get('/api/diag/db', async (req, res) => {
  const prisma = require('./config/database');
  const withTimeout = (p, ms, label) =>
    Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms)),
    ]);
  const dbUrl = process.env.DATABASE_URL || '';
  const dbHost = (dbUrl.match(/@([^/:]+)/) || [])[1] || 'NOT SET';
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, 8000, 'DB connect');
    let userCount = null;
    let adminExists = null;
    try { userCount = await withTimeout(prisma.user.count(), 8000, 'user.count'); } catch (e) { userCount = `err: ${e.message}`; }
    try {
      adminExists = !!(await withTimeout(
        prisma.user.findUnique({ where: { email: 'admin@ph-erp.com' } }), 8000, 'find admin'));
    } catch (e) { adminExists = `err: ${e.message}`; }
    res.json({ db: 'ok', dbHost, hasDatabaseUrl: !!dbUrl, userCount, adminExists });
  } catch (err) {
    res.status(500).json({
      db: 'error', dbHost, hasDatabaseUrl: !!dbUrl,
      name: err.name, code: err.code, message: String(err.message).slice(0, 400),
    });
  }
});

// ─── API Routes ────────────────────────────────────────────
app.use('/api/auth',       authLimiter, routes.auth);
app.use('/api/businesses', routes.businesses);
app.use('/api/accounts',   routes.accounts);
app.use('/api/journal', routes.journal);
app.use('/api/payable', routes.payable);
app.use('/api/receivable', routes.receivable);
app.use('/api/quotations', routes.quotations);
app.use('/api/permissions', routes.permissions);
app.use('/api/payroll', routes.payroll);
app.use('/api/bir', routes.bir);
app.use('/api/dashboard', routes.dashboard);
app.use('/api/settings',       routes.settings);
app.use('/api/custom-reports', routes.customReports);
app.use('/api/inventory',      routes.inventory);
app.use('/api/remittance',     routes.remittance);
app.use('/api/expenses',       routes.expense);
app.use('/api/audit',          routes.audit);
app.use('/api/attachments',    routes.attachments);
app.use('/api/purchase-orders',routes.purchaseOrders);
app.use('/api/assets',         routes.assets);
app.use('/api/bank',           routes.bank);
app.use('/api/budget',         routes.budget);
app.use('/api/recurring',      routes.recurring);
app.use('/api/notifications',  routes.notifications);
app.use('/api/search',         routes.search);
app.use('/api/backup',         routes.backup);
app.use('/api/admin-override', routes.adminOverride);
app.use('/api/po-scanner',    routes.poScanner);
app.use('/api/po-form',       routes.poForm);
app.use('/api/leads',         routes.leads);
app.use('/api/cash-requests', routes.cashRequests);
app.use('/api/cash-sales',     routes.cashSales);
app.use('/api/opening-balances', routes.openingBalances);
app.use('/api/reports',          routes.cashPosition);
app.use('/api/school',           routes.school);
app.use('/api/orders',           routes.orders);

// ─── 404 ───────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ─── Error Handler ─────────────────────────────────────────
app.use(errorHandler);

// ─── Start ─────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`PH-ERP API running on port ${PORT} [${process.env.NODE_ENV}]`);
});

module.exports = app;
