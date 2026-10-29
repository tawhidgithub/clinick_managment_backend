import { Router } from 'express';
import { authenticate, requireRole } from '../../shared/middleware/authenticate';
import * as controller from './patients.controller';

const staffDesk = requireRole('ADMIN', 'FRONT_DESK');

export const patientsRouter = Router();

patientsRouter.use(authenticate);

patientsRouter.get('/', controller.list);
patientsRouter.get('/lookup', controller.lookupByPhone); // before /:id
patientsRouter.post('/', staffDesk, controller.create);
patientsRouter.get('/:id', controller.get);
patientsRouter.patch('/:id', staffDesk, controller.update);
patientsRouter.delete('/:id', requireRole('ADMIN'), controller.remove);
patientsRouter.post('/:id/restore', requireRole('ADMIN'), controller.restore);
patientsRouter.get('/:id/history', controller.history);
patientsRouter.get('/:id/notes', controller.listNotes);
patientsRouter.post('/:id/notes', controller.createNote);
