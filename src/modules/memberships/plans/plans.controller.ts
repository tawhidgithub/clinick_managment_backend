import type { Request, Response } from 'express';
import { idParams } from '../../../shared/lib/validation';
import { createPlanBody, listPlansQuery, updatePlanBody } from './plans.schema';
import * as service from './plans.service';

export async function list(req: Request, res: Response) {
  const { includeInactive } = listPlansQuery.parse(req.query);
  res.json(await service.listPlans(includeInactive));
}

export async function get(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  res.json(await service.getPlan(id));
}

export async function create(req: Request, res: Response) {
  const body = createPlanBody.parse(req.body);
  res.status(201).json(await service.createPlan(body));
}

export async function update(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  const body = updatePlanBody.parse(req.body);
  res.json(await service.updatePlan(id, body));
}
