import { Router } from 'express';
import { authenticate, requireRole } from '../../shared/middleware/authenticate';
import * as controller from './practitioners.controller';

export const practitionersRouter = Router();

practitionersRouter.use(authenticate);
practitionersRouter.get('/', controller.list);
practitionersRouter.get('/:id', controller.get);
practitionersRouter.post('/', requireRole('ADMIN'), controller.create);
practitionersRouter.patch('/:id', requireRole('ADMIN'), controller.update);
practitionersRouter.put('/:id/schedules', requireRole('ADMIN'), controller.replaceSchedules);
