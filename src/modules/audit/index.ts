import type { AppModule } from '../../shared/module';
import { auditTrail } from './audit.middleware';
import { auditRouter } from './audit.routes';

export const auditModule: AppModule = {
  name: 'audit',
  middleware: [auditTrail],
  routes: [{ path: '/audit-log', router: auditRouter }],
};
