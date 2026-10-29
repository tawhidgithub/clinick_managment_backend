import type { Request, Response } from 'express';
import { z } from 'zod';
import { currentUser } from '../../shared/middleware/authenticate';
import { idParams } from '../../shared/lib/validation';
import { sendPdf } from '../../shared/pdf/pdf';
import { getClinicSettings } from '../clinic-settings';
import { renderPrescriptionPdf } from './prescriptions.pdf';
import {
  createPrescriptionFields,
  imageParams,
  listPrescriptionsQuery,
  updatePrescriptionBody,
} from './prescriptions.schema';
import * as service from './prescriptions.service';

const uploadedFiles = (req: Request) => (Array.isArray(req.files) ? req.files : []);
const downloadQuery = z.object({ download: z.enum(['true', 'false']).optional().transform((v) => v === 'true') });

export async function list(req: Request, res: Response) {
  const query = listPrescriptionsQuery.parse(req.query);
  res.json(await service.listPrescriptions(query));
}

export async function create(req: Request, res: Response) {
  const fields = createPrescriptionFields.parse(req.body ?? {});
  res.status(201).json(await service.createPrescription(fields, uploadedFiles(req), currentUser(req)));
}

export async function get(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  res.json(await service.getPrescription(id));
}

export async function update(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  const body = updatePrescriptionBody.parse(req.body);
  res.json(await service.updatePrescription(id, body, currentUser(req)));
}

export async function addImages(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  res.status(201).json(await service.addImages(id, uploadedFiles(req), currentUser(req)));
}

export async function deleteImage(req: Request, res: Response) {
  const { id, imageId } = imageParams.parse(req.params);
  res.json(await service.deleteImage(id, imageId));
}

export async function pdf(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  const { download } = downloadQuery.parse(req.query);
  const [data, clinic] = await Promise.all([service.getPrescriptionForPrint(id), getClinicSettings()]);
  sendPdf(res, await renderPrescriptionPdf(data, clinic.name), `${data.prescription.rxNo}.pdf`, download);
}
