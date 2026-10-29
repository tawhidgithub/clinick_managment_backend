import { Router } from 'express';
import { authenticate, requireRole } from '../../shared/middleware/authenticate';
import { imageUpload } from '../../shared/middleware/upload';
import * as controller from './prescriptions.controller';

// Practitioners may write only for their own visits (checked in the service).
const canWrite = requireRole('ADMIN', 'FRONT_DESK', 'PRACTITIONER');

export const prescriptionsRouter = Router();

prescriptionsRouter.use(authenticate);
prescriptionsRouter.get('/', controller.list);
prescriptionsRouter.post('/', canWrite, imageUpload, controller.create);
prescriptionsRouter.get('/:id', controller.get);
prescriptionsRouter.patch('/:id', canWrite, controller.update);
prescriptionsRouter.get('/:id/pdf', controller.pdf);
prescriptionsRouter.post('/:id/images', canWrite, imageUpload, controller.addImages);
prescriptionsRouter.delete('/:id/images/:imageId', requireRole('ADMIN', 'FRONT_DESK'), controller.deleteImage);
