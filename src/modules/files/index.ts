import path from 'node:path';
import { Router } from 'express';
import type { AppModule } from '../../shared/module';
import { isLocalStorage, storage, verifyFileToken } from '../../shared/storage';

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};

const router = Router();

// Serves a locally stored file to anyone holding a valid, unexpired signed
// link (so <img src> works without an Authorization header). Links are
// created by the module that owns the file, after its own permission checks.
router.get('/:token', async (req, res) => {
  const key = isLocalStorage ? verifyFileToken(req.params.token) : null;
  if (!key) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File link is invalid or has expired' } });
    return;
  }

  let data: Buffer;
  try {
    data = await storage.get(key);
  } catch {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found' } });
    return;
  }

  res.setHeader('Content-Type', CONTENT_TYPES[path.extname(key).toLowerCase()] ?? 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); // allow the frontend origin to show it
  res.end(data);
});

export const filesModule: AppModule = {
  name: 'files',
  routes: [{ path: '/files', router }],
};
