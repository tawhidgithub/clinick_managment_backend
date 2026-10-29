import type { Request, Response } from 'express';
import { conflict } from '../../shared/errors/AppError';
import { idParams } from '../../shared/lib/validation';
import { sendPdf } from '../../shared/pdf/pdf';
import { getClinicSettings } from '../clinic-settings';
import { renderSerialSlip } from './appointments.slip';
import {
  cancelAppointmentBody,
  createTreatmentBody,
  listAppointmentsQuery,
  replaceServicesBody,
} from './appointments.schema';
import * as service from './appointments.service';

export async function list(req: Request, res: Response) {
  const query = listAppointmentsQuery.parse(req.query);
  res.json(await service.listAppointments(query));
}

export async function get(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  res.json(await service.getAppointment(id));
}

export async function cancel(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  const { reason } = cancelAppointmentBody.parse(req.body);
  res.json(await service.cancelAppointment(id, reason));
}

export async function replaceServices(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  const { services } = replaceServicesBody.parse(req.body);
  res.json(await service.replaceServices(id, services));
}

export async function slip(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  const [appt, clinic] = await Promise.all([service.getAppointment(id), getClinicSettings()]);
  if (appt.serialNo == null) throw conflict('This visit has no serial number yet');
  sendPdf(res, await renderSerialSlip(appt, clinic.name), `serial-${appt.serialNo}.pdf`);
}

export async function addTreatment(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  const body = createTreatmentBody.parse(req.body);
  res.status(201).json(await service.addTreatment(id, body));
}
