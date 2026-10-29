import { Router } from 'express';
import { authenticate } from '../../shared/middleware/authenticate';
import * as controller from './dashboard.controller';

export const dashboardRouter = Router();

// Every role; money sections are left out for practitioners in the service.
dashboardRouter.use(authenticate);
dashboardRouter.get('/', controller.get);
