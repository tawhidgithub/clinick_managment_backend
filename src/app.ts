import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import morgan from 'morgan';
import { allowAnyOrigin, env, isProduction } from './config/env';
import { modules } from './modules';
import { errorHandler, notFoundHandler } from './shared/middleware/errorHandler';
import { requestId } from './shared/middleware/requestId';

morgan.token('id', (req) => (req as express.Request).id);

export function createApp() {
  const app = express();

  // Behind Nginx: trust that many proxies for req.ip (rate limits, audit log).
  app.set('trust proxy', env.TRUST_PROXY);

  app.disable('x-powered-by');
  app.use(requestId);
  app.use(helmet());
  app.use(cors({ origin: allowAnyOrigin || env.CORS_ORIGIN, credentials: true, exposedHeaders: ['X-Request-Id', 'Content-Disposition'] }));
  if (env.NODE_ENV !== 'test') {
    app.use(morgan(isProduction ? ':remote-addr [:date[iso]] ":method :url" :status :res[content-length] :response-time ms id=:id' : 'dev'));
  }
  if (env.RATE_LIMIT_PER_MINUTE > 0 && env.NODE_ENV !== 'test') {
    app.use(
      '/api',
      rateLimit({
        windowMs: 60 * 1000,
        limit: env.RATE_LIMIT_PER_MINUTE,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        handler: (_req, res) => {
          res.status(429).json({ error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests. Wait a minute and try again.' } });
        },
      }),
    );
  }
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // Patient and billing data must not sit in browser or proxy caches.
  // Routes that serve files set their own Cache-Control.
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  const api = Router();
  for (const mod of modules) {
    for (const handler of mod.middleware ?? []) api.use(handler);
  }
  for (const mod of modules) {
    for (const route of mod.routes) {
      api.use(route.path, route.router);
    }
  }
  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

// Vercel runs this file as a serverless function and needs the app as the
// default export. server.ts (PM2/Nginx) and the tests use createApp().
export default createApp();
