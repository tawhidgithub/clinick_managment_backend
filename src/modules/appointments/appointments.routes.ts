import { Router } from 'express';
import { authenticate, requireRole } from '../../shared/middleware/authenticate';
import * as controller from './appointments.controller';

const staffDesk = requireRole('ADMIN', 'FRONT_DESK');

export const appointmentsRouter = Router();

appointmentsRouter.use(authenticate);
appointmentsRouter.get('/', controller.list);
appointmentsRouter.get('/:id', controller.get);
appointmentsRouter.get('/:id/slip', staffDesk, controller.slip);
appointmentsRouter.post('/:id/cancel', staffDesk, controller.cancel);
appointmentsRouter.put('/:id/services', staffDesk, controller.replaceServices);
appointmentsRouter.post('/:id/treatments', controller.addTreatment);
