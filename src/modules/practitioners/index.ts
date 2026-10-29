import type { AppModule } from '../../shared/module';
import { practitionersRouter } from './practitioners.routes';

export const practitionersModule: AppModule = {
  name: 'practitioners',
  routes: [{ path: '/practitioners', router: practitionersRouter }],
};

// Public API for other modules
export {
  assertActivePractitioner,
  clearUserPractitionerLink,
  setPractitionerUser,
} from './practitioners.service';
