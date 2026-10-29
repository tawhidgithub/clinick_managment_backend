import type { AppModule } from '../../shared/module';
import { prescriptionsRouter } from './prescriptions.routes';

export const prescriptionsModule: AppModule = {
  name: 'prescriptions',
  routes: [{ path: '/prescriptions', router: prescriptionsRouter }],
};
