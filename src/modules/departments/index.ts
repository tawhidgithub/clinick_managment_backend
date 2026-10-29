import type { AppModule } from '../../shared/module';
import { departmentsRouter } from './departments.routes';

export const departmentsModule: AppModule = {
  name: 'departments',
  routes: [{ path: '/departments', router: departmentsRouter }],
};

// Public API for other modules
export { assertActiveDepartment } from './departments.service';
