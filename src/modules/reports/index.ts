import type { AppModule } from '../../shared/module';
import { reportsRouter } from './reports.routes';

export const reportsModule: AppModule = {
  name: 'reports',
  routes: [{ path: '/reports', router: reportsRouter }],
};
