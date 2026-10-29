import { Router } from 'express';
import { authenticate, requireRole } from '../../shared/middleware/authenticate';
import * as controller from './invoices.controller';

export const invoicesRouter = Router();

invoicesRouter.use(authenticate, requireRole('ADMIN', 'FRONT_DESK'));
invoicesRouter.get('/', controller.list);
invoicesRouter.post('/preview', controller.preview);
invoicesRouter.post('/', controller.create);
invoicesRouter.get('/:id', controller.get);
invoicesRouter.patch('/:id', controller.update);
invoicesRouter.get('/:id/pdf', controller.pdf);
invoicesRouter.post('/:id/payments', controller.addPayment);
invoicesRouter.post('/:id/void', requireRole('ADMIN'), controller.voidInvoice);
