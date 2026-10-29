import { Router } from 'express';
import { prisma } from '../../shared/db/prisma';
import type { AppModule } from '../../shared/module';

const router = Router();

router.get('/', async (_req, res) => {
  let db: 'ok' | 'down' = 'ok';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    db = 'down';
  }
  res.status(db === 'ok' ? 200 : 503).json({
    status: db === 'ok' ? 'ok' : 'degraded',
    db,
    time: new Date(),
    uptimeSeconds: Math.round(process.uptime()),
  });
});

export const healthModule: AppModule = {
  name: 'health',
  routes: [{ path: '/health', router }],
};
