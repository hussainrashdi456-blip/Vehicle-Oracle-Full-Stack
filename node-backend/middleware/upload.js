const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const EXTENSION_BY_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

const uploadDir = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

function imageOnly(req, file, cb) {
  if (EXTENSION_BY_MIME[file.mimetype]) return cb(null, true);
  const error = new Error('Only JPEG, PNG or WebP images are allowed.');
  error.status = 415;
  cb(error);
}

const limits = { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 10 };

// Damage detection: the image only lives in memory long enough to be forwarded to FastAPI.
const memoryUpload = multer({ storage: multer.memoryStorage(), limits, fileFilter: imageOnly });

// Marketplace listings: files are stored under a random name with an extension we choose.
// Never reuse file.originalname here. An uploaded .html or .svg served from this origin
// would run scripts in your site's context.
const diskUpload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + EXTENSION_BY_MIME[file.mimetype]),
  }),
  limits,
  fileFilter: imageOnly,
});

module.exports = { memoryUpload, diskUpload, uploadDir };
