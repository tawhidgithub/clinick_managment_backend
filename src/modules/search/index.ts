import { Router } from 'express';
import { z } from 'zod';
import type { AppModule } from '../../shared/module';
import { authenticate } from '../../shared/middleware/authenticate';
import { searchPatients } from '../patients';

const searchQuery = z.object({
  q: z.string().trim().min(2, 'Type at least 2 characters').max(100),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});

const router = Router();

// Global Ctrl+K search: patients by name, phone or patient ID.
router.get('/', authenticate, async (req, res) => {
  const { q, limit } = searchQuery.parse(req.query);
  res.json({ q, patients: await searchPatients(q, limit) });
});

export const searchModule: AppModule = {
  name: 'search',
  routes: [{ path: '/search', router }],
};
