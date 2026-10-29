import { Router } from 'express';
import { authenticate, requireRole } from '../../shared/middleware/authenticate';
import * as controller from './audit.controller';

export const auditRouter = Router();

auditRouter.use(authenticate, requireRole('ADMIN'));
auditRouter.get('/', controller.list);
