import type { Request, Response } from 'express';
import { currentUser } from '../../shared/middleware/authenticate';
import { idParams } from '../../shared/lib/validation';
import { createStaffBody, resetPasswordBody, updateStaffBody } from './staff.schema';
import * as service from './staff.service';

export async function list(_req: Request, res: Response) {
  res.json(await service.listStaff());
}

export async function get(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  res.json(await service.getStaff(id));
}

export async function create(req: Request, res: Response) {
  const body = createStaffBody.parse(req.body);
  res.status(201).json(await service.createStaff(body));
}

export async function update(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  const body = updateStaffBody.parse(req.body);
  res.json(await service.updateStaff(id, currentUser(req).id, body));
}

export async function resetPassword(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  const { newPassword } = resetPasswordBody.parse(req.body);
  await service.resetPassword(id, newPassword);
  res.status(204).end();
}
