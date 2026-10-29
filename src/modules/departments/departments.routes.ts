import { Router } from 'express';
import { authenticate, requireRole } from '../../shared/middleware/authenticate';
import * as controller from './departments.controller';

export const departmentsRouter = Router();

departmentsRouter.use(authenticate);
departmentsRouter.get('/', controller.list);
departmentsRouter.get('/:id', controller.get);
departmentsRouter.post('/', requireRole('ADMIN'), controller.create);
departmentsRouter.patch('/:id', requireRole('ADMIN'), controller.update);
