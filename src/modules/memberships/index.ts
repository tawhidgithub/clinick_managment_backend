import type { AppModule } from '../../shared/module';
import { membershipsRouter } from './memberships.routes';
import { expireMemberships } from './memberships.service';
import { plansRouter } from './plans/plans.routes';

export const membershipsModule: AppModule = {
  name: 'memberships',
  routes: [
    { path: '/membership-plans', router: plansRouter },
    { path: '/memberships', router: membershipsRouter },
  ],
  jobs: [{ name: 'expire-memberships', intervalMs: 60 * 60 * 1000, runOnStart: true, run: expireMemberships }],
};

// Public API: the dashboard (B5) shows memberships expiring soon
export { EXPIRING_WITHIN_DAYS, listMemberships } from './memberships.service';
