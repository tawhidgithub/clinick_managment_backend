import { z } from 'zod';
import { cuid } from '../../shared/lib/validation';

export const dashboardQuery = z.object({
  departmentId: cuid.optional(), // limits the queue, visit counts and visit lists
});

export type DashboardQuery = z.infer<typeof dashboardQuery>;
