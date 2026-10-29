import { Router } from 'express';
import { authenticate, requireRole } from '../../shared/middleware/authenticate';
import * as controller from './queue.controller';

const staffDesk = requireRole('ADMIN', 'FRONT_DESK');

export const queueRouter = Router();

queueRouter.use(authenticate);
queueRouter.get('/', controller.board);
queueRouter.get('/:practitionerId', controller.doctor);
queueRouter.post('/:practitionerId/next', staffDesk, controller.next);
queueRouter.post('/:appointmentId/skip', staffDesk, controller.skip);
queueRouter.post('/:appointmentId/requeue', staffDesk, controller.requeue);
