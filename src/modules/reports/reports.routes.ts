import { Router } from 'express';
import { authenticate, requireRole } from '../../shared/middleware/authenticate';
import * as controller from './reports.controller';

export const reportsRouter = Router();

reportsRouter.use(authenticate, requireRole('ADMIN'));
reportsRouter.get('/', controller.get);
