import { Router } from 'express';
import { authenticate, requireRole } from '../../shared/middleware/authenticate';
import * as controller from './staff.controller';

export const staffRouter = Router();

staffRouter.use(authenticate, requireRole('ADMIN'));
staffRouter.get('/', controller.list);
staffRouter.get('/:id', controller.get);
staffRouter.post('/', controller.create);
staffRouter.patch('/:id', controller.update);
staffRouter.post('/:id/reset-password', controller.resetPassword);
