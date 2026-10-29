import type { AppModule } from '../../shared/module';
import { appointmentsRouter } from './appointments.routes';
import { closePastQueues } from './appointments.service';

export const appointmentsModule: AppModule = {
  name: 'appointments',
  routes: [{ path: '/appointments', router: appointmentsRouter }],
  jobs: [{ name: 'close-past-queues', intervalMs: 30 * 60 * 1000, runOnStart: true, run: closePastQueues }],
};

// Public API: the only way other modules change appointments
export {
  callNext,
  createWalkInAppointment,
  lockPractitionerQueue,
  markNoShow,
  moveToEnd,
  requeue,
  type WalkInInput,
} from './appointments.queue';
export { lockAppointmentForBilling, servicesTotal } from './appointments.service';
export { serviceLines, type ServiceLine } from './appointments.schema';
