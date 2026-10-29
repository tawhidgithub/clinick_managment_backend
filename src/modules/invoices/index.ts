import type { AppModule } from '../../shared/module';
import { invoicesRouter } from './invoices.routes';

export const invoicesModule: AppModule = {
  name: 'invoices',
  routes: [{ path: '/invoices', router: invoicesRouter }],
};

// Public API: memberships bill a plan purchase through createInvoice and
// show discounts through getMemberDiscountRules.
export { createInvoice } from './invoices.service';
export { getMemberDiscountRules, type DiscountRule } from './invoices.totals';
export { paymentInput, type PaymentInput } from './invoices.schema';
