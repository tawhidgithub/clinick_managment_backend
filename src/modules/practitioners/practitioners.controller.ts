import type { Request, Response } from 'express';
import { idParams } from '../../shared/lib/validation';
import {
  createPractitionerBody,
  listPractitionersQuery,
  replaceSchedulesBody,
  updatePractitionerBody,
} from './practitioners.schema';
import * as service from './practitioners.service';

export async function list(req: Request, res: Response) {
  const query = listPractitionersQuery.parse(req.query);
  res.json(await service.listPractitioners(query));
}

export async function get(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  res.json(await service.getPractitioner(id));
}

export async function create(req: Request, res: Response) {
  const body = createPractitionerBody.parse(req.body);
  res.status(201).json(await service.createPractitioner(body));
}

export async function update(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  const body = updatePractitionerBody.parse(req.body);
  res.json(await service.updatePractitioner(id, body));
}

export async function replaceSchedules(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  const body = replaceSchedulesBody.parse(req.body);
  res.json(await service.replaceSchedules(id, body));
}
