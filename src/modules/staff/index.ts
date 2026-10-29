import type { AppModule } from '../../shared/module';
import { staffRouter } from './staff.routes';

export const staffModule: AppModule = {
  name: 'staff',
  routes: [{ path: '/staff', router: staffRouter }],
};
