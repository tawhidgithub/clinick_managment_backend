import type { ErrorRequestHandler, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { MulterError } from 'multer';
import { ZodError } from 'zod';
import { AppError } from '../errors/AppError';
import { MAX_IMAGES_PER_UPLOAD, MAX_UPLOAD_MB } from './upload';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` },
  });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Some fields are invalid',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = (err.meta?.target as string[] | string | undefined) ?? 'field';
      res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: `A record with this ${Array.isArray(target) ? target.join(', ') : target} already exists`,
        },
      });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Record not found' } });
      return;
    }
    if (err.code === 'P2003') {
      res.status(400).json({
        error: { code: 'BAD_REFERENCE', message: 'A linked record does not exist' },
      });
      return;
    }
    // Lock wait / transaction timeout or a write conflict: someone else was changing the same record.
    if (err.code === 'P2028' || err.code === 'P2034') {
      res.status(503).json({ error: { code: 'BUSY', message: 'The system is busy with the same record. Please try again.' } });
      return;
    }
  }

  if (err instanceof Prisma.PrismaClientInitializationError || (err instanceof Prisma.PrismaClientKnownRequestError && err.code.startsWith('P1'))) {
    console.error(`[${req.id}] database unavailable:`, err.message);
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'The database is not reachable. Please try again shortly.', requestId: req.id } });
    return;
  }

  if (err instanceof MulterError) {
    const messages: Partial<Record<MulterError['code'], string>> = {
      LIMIT_FILE_SIZE: `Each image must be ${MAX_UPLOAD_MB} MB or smaller`,
      LIMIT_FILE_COUNT: `Upload at most ${MAX_IMAGES_PER_UPLOAD} images at a time`,
      LIMIT_UNEXPECTED_FILE: 'Images must be sent in the "images" field',
    };
    res.status(400).json({ error: { code: 'UPLOAD_ERROR', message: messages[err.code] ?? err.message } });
    return;
  }

  // Malformed JSON body from express.json()
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'BAD_JSON', message: 'Request body is not valid JSON' } });
    return;
  }
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'TOO_LARGE', message: 'Request body is too large' } });
    return;
  }

  console.error(`[${req.id}] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong', requestId: req.id } });
};
