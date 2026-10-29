import type { AppModule } from '../../shared/module';
import { visitsRouter } from './visits.routes';

export const visitsModule: AppModule = {
  name: 'visits',
  routes: [{ path: '/visits', router: visitsRouter }],
};
