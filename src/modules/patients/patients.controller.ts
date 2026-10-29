import type { Request, Response } from 'express';
import { prisma } from '../../shared/db/prisma';
import { currentUser } from '../../shared/middleware/authenticate';
import { idParams } from '../../shared/lib/validation';
import {
  createNoteBody,
  createPatientBody,
  listPatientsQuery,
  lookupByPhoneQuery,
  updatePatientBody,
} from './patients.schema';
import * as service from './patients.service';

export async function list(req: Request, res: Response) {
  const query = listPatientsQuery.parse(req.query);
  if (currentUser(req).role !== 'ADMIN') query.includeDeleted = false;
  res.json(await service.listPatients(query));
}

/** Used by New Visit step 1 and the duplicate-phone warning on Add patient. */
export async function lookupByPhone(req: Request, res: Response) {
  const { phone } = lookupByPhoneQuery.parse(req.query);
  res.json({ phone, patients: await service.findPatientsByPhone(phone) });
}

export async function get(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  const { role } = currentUser(req);
  const patient = await service.getPatient(id, { allowDeleted: role === 'ADMIN' });
  // Practitioners don't see billing.
  res.json(role === 'PRACTITIONER' ? { ...patient, totalDue: null } : patient);
}

export async function create(req: Request, res: Response) {
  const body = createPatientBody.parse(req.body);
  const patient = await prisma.$transaction((tx) => service.createPatient(tx, body));
  res.status(201).json(patient);
}

export async function update(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  const body = updatePatientBody.parse(req.body);
  res.json(await service.updatePatient(id, body));
}

export async function remove(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  await service.deletePatient(id);
  res.status(204).end();
}

export async function restore(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  res.json(await service.restorePatient(id));
}

export async function history(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  res.json(await service.getPatientHistory(id, { includeInvoices: currentUser(req).role !== 'PRACTITIONER' }));
}

export async function listNotes(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  res.json(await service.listNotes(id));
}

export async function createNote(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  const { body } = createNoteBody.parse(req.body);
  res.status(201).json(await service.createNote(id, currentUser(req).id, body));
}
