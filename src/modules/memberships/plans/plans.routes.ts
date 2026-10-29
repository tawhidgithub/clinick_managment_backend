import { Router } from 'express';
import { authenticate, requireRole } from '../../../shared/middleware/authenticate';
import * as controller from './plans.controller';

export const plansRouter = Router();

plansRouter.use(authenticate);
plansRouter.get('/', controller.list);
plansRouter.get('/:id', controller.get);
plansRouter.post('/', requireRole('ADMIN'), controller.create);
plansRouter.patch('/:id', requireRole('ADMIN'), controller.update);
