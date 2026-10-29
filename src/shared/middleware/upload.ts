import multer from 'multer';
import { badRequest } from '../errors/AppError';

export const MAX_UPLOAD_MB = 15;
export const MAX_IMAGES_PER_UPLOAD = 10;

/**
 * Accepts up to 10 images in the "images" field, kept in memory so they can
 * be compressed before storage. Non-image files are rejected.
 */
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: MAX_IMAGES_PER_UPLOAD, fields: 20 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(badRequest(`"${file.originalname}" is not an image`));
  },
}).array('images', MAX_IMAGES_PER_UPLOAD);
