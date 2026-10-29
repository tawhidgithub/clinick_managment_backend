import { Router } from 'express';
import { authenticate, requireRole } from '../../shared/middleware/authenticate';
import * as controller from './services.controller';

export const servicesRouter = Router();

servicesRouter.use(authenticate);
servicesRouter.get('/', controller.list);
servicesRouter.get('/:id', controller.get);
servicesRouter.post('/', requireRole('ADMIN'), controller.create);
servicesRouter.patch('/:id', requireRole('ADMIN'), controller.update);
