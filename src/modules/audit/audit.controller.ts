import type { Request, Response } from 'express';
import { listAuditQuery } from './audit.schema';
import * as service from './audit.service';

export async function list(req: Request, res: Response) {
  const query = listAuditQuery.parse(req.query);
  res.json(await service.listAuditLog(query));
}
