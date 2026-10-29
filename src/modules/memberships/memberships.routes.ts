import { Router } from 'express';
import { authenticate, requireRole } from '../../shared/middleware/authenticate';
import * as controller from './memberships.controller';

const staffDesk = requireRole('ADMIN', 'FRONT_DESK');

export const membershipsRouter = Router();

membershipsRouter.use(authenticate);
membershipsRouter.get('/', staffDesk, controller.list);
membershipsRouter.get('/lookup', controller.lookup); // before /:id
membershipsRouter.post('/', staffDesk, controller.issue);
membershipsRouter.get('/:id', controller.get);
membershipsRouter.get('/:id/card', staffDesk, controller.card);
membershipsRouter.post('/:id/renew', staffDesk, controller.renew);
membershipsRouter.post('/:id/cancel', requireRole('ADMIN'), controller.cancel);
