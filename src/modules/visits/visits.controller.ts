import type { Request, Response } from 'express';
import { currentUser } from '../../shared/middleware/authenticate';
import { createVisitBody } from './visits.schema';
import * as service from './visits.service';

export async function create(req: Request, res: Response) {
  const body = createVisitBody.parse(req.body);
  res.status(201).json(await service.createVisit(body, currentUser(req).id));
}
