import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const VALID_ID = /^[\w.-]{8,64}$/;

/**
 * Gives every request an id (reusing a sane X-Request-Id from Nginx or the
 * frontend), sends it back in the X-Request-Id header and shows it in error
 * responses, so a staff member's error message can be matched to the log line.
 */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get('x-request-id');
  req.id = incoming && VALID_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
};
