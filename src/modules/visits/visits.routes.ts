import { Router } from 'express';
import { authenticate, requireRole } from '../../shared/middleware/authenticate';
import * as controller from './visits.controller';

export const visitsRouter = Router();

visitsRouter.post('/', authenticate, requireRole('ADMIN', 'FRONT_DESK'), controller.create);
