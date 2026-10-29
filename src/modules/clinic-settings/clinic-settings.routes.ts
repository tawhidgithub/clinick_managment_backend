import { Router } from 'express';
import { authenticate, requireRole } from '../../shared/middleware/authenticate';
import * as controller from './clinic-settings.controller';

export const clinicSettingsRouter = Router();

clinicSettingsRouter.use(authenticate);
clinicSettingsRouter.get('/', controller.get);
clinicSettingsRouter.put('/', requireRole('ADMIN'), controller.update);
