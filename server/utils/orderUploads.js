const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { createError } = require('../middleware/errorHandler');
const logger = require('./logger');

const DIR = path.join(__dirname, '..', '..', 'uploads', 'orders');
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

const uploader = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, DIR),
    filename: (req, file, cb) =>
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    ALLOWED.includes(file.mimetype) ? cb(null, true) : cb(new Error('Only JPG, PNG, WEBP or PDF files are allowed')),
}).single('file');

// multer errors become clean 400s instead of a generic 500
const uploadMiddleware = (req, res, next) => {
  uploader(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File exceeds 5 MB limit' : err.message;
      return res.status(400).json({ error: msg });
    }
    next();
  });
};

const storedPath = (name) => path.join(DIR, path.basename(name));

const removeStoredFile = (name) => {
  try { if (name) fs.unlinkSync(storedPath(name)); } catch (_) { /* already gone */ }
};

function sendStoredFile(res, { fileName, mimeType, originalName }) {
  const p = storedPath(fileName);
  if (!fs.existsSync(p)) throw createError('File missing from storage', 404);
  res.setHeader('Content-Type', mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(originalName || fileName)}"`);
  fs.createReadStream(p)
    .on('error', (e) => { logger.error(`Failed streaming stored file ${path.basename(p)}: ${e.message}`); res.destroy(e); })
    .pipe(res);
}

module.exports = { uploadMiddleware, removeStoredFile, sendStoredFile };
