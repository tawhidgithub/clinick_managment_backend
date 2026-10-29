import type { Request, Response } from 'express';
import { idParams } from '../../shared/lib/validation';
import { createServiceBody, listServicesQuery, updateServiceBody } from './services.schema';
import * as service from './services.service';

export async function list(req: Request, res: Response) {
  const query = listServicesQuery.parse(req.query);
  res.json(await service.listServices(query));
}

export async function get(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  res.json(await service.getService(id));
}

export async function create(req: Request, res: Response) {
  const body = createServiceBody.parse(req.body);
  res.status(201).json(await service.createService(body));
}

export async function update(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  const body = updateServiceBody.parse(req.body);
  res.json(await service.updateService(id, body));
}
