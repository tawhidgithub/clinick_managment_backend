import type { Request, Response } from 'express';
import { currentUser } from '../../shared/middleware/authenticate';
import { dashboardQuery } from './dashboard.schema';
import * as service from './dashboard.service';

export async function get(req: Request, res: Response) {
  const query = dashboardQuery.parse(req.query);
  res.json(await service.getDashboard(query, currentUser(req).role));
}
