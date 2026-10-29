import type { Request, Response } from 'express';
import { updateClinicSettingsBody } from './clinic-settings.schema';
import * as service from './clinic-settings.service';

export async function get(_req: Request, res: Response) {
  res.json(await service.getClinicSettings());
}

export async function update(req: Request, res: Response) {
  const body = updateClinicSettingsBody.parse(req.body);
  res.json(await service.updateClinicSettings(body));
}
