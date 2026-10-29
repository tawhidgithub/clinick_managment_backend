import type { AppModule } from '../../shared/module';
import { queueRouter } from './queue.routes';

export const queueModule: AppModule = {
  name: 'queue',
  routes: [{ path: '/queue', router: queueRouter }],
};

// Public API: the dashboard module (B5) reuses the board
export { getQueueBoard } from './queue.service';
