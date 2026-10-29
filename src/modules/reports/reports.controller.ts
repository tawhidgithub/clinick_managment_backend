import type { Request, Response } from 'express';
import { reportQuery } from './reports.schema';
import * as service from './reports.service';

export async function get(req: Request, res: Response) {
  const query = reportQuery.parse(req.query);
  res.json(await service.getReport(query));
}
