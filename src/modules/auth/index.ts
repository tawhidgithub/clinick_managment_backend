import type { AppModule } from '../../shared/module';
import { authRouter } from './auth.routes';

export const authModule: AppModule = {
  name: 'auth',
  routes: [{ path: '/auth', router: authRouter }],
};

// Public API for other modules
export { hashPassword, revokeAllSessions } from './auth.service';
export { passwordRule } from './auth.schema';
