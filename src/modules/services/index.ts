import type { AppModule } from '../../shared/module';
import { servicesRouter } from './services.routes';

export const servicesModule: AppModule = {
  name: 'services',
  routes: [{ path: '/services', router: servicesRouter }],
};

// Public API for other modules
export { getActiveServices, getActiveServicesForDepartment } from './services.service';
