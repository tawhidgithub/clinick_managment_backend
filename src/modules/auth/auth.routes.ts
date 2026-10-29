import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { isAllowedOrigin } from '../../config/env';
import { forbidden } from '../../shared/errors/AppError';
import { authenticate } from '../../shared/middleware/authenticate';
import * as controller from './auth.controller';

// Cookie-based endpoints reject requests from origins that are not ours.
// Requests without an Origin header (Postman, curl) are allowed.
const allowedOriginOnly: RequestHandler = (req, _res, next) => {
  const origin = req.get('origin');
  if (origin && !isAllowedOrigin(origin)) throw forbidden('Origin not allowed');
  next();
};

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (_req, res) => {
    res.status(429).json({
      error: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many failed sign-in attempts. Try again in 15 minutes.' },
    });
  },
});

export const authRouter = Router();

authRouter.post('/login', allowedOriginOnly, loginLimiter, controller.login);
authRouter.post('/refresh', allowedOriginOnly, controller.refresh);
authRouter.post('/logout', allowedOriginOnly, controller.logout);
authRouter.get('/me', authenticate, controller.me);
authRouter.post('/change-password', authenticate, controller.changePassword);
