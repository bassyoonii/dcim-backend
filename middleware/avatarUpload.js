const path = require('path');
const fs = require('fs');
const multer = require('multer');

const AVATAR_DIR = path.join(__dirname, '..', 'uploads', 'avatars');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(AVATAR_DIR, { recursive: true });
    cb(null, AVATAR_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowedExts = new Set(['.jpg', '.jpeg', '.png', '.webp']);
    const safeExt = allowedExts.has(ext) ? ext : '.jpg';

    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`;
    cb(null, unique);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedMimes = new Set(['image/jpeg', 'image/png', 'image/webp']);
  if (allowedMimes.has(file.mimetype)) return cb(null, true);
  return cb(new Error('Invalid avatar type. Allowed: JPG, PNG, WEBP.'));
};

module.exports = multer({
  storage,
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB
});
