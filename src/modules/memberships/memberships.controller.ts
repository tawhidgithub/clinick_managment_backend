import type { Request, Response } from 'express';
import { conflict } from '../../shared/errors/AppError';
import { currentUser } from '../../shared/middleware/authenticate';
import { idParams } from '../../shared/lib/validation';
import { sendPdf } from '../../shared/pdf/pdf';
import { getClinicSettings } from '../clinic-settings';
import { renderMembershipCard } from './memberships.card';
import {
  cancelMembershipBody,
  issueMembershipBody,
  listMembershipsQuery,
  lookupQuery,
  renewMembershipBody,
} from './memberships.schema';
import * as service from './memberships.service';

export async function list(req: Request, res: Response) {
  const query = listMembershipsQuery.parse(req.query);
  res.json(await service.listMemberships(query));
}

export async function lookup(req: Request, res: Response) {
  const { patientId } = lookupQuery.parse(req.query);
  res.json(await service.lookupForPatient(patientId));
}

export async function issue(req: Request, res: Response) {
  const body = issueMembershipBody.parse(req.body);
  res.status(201).json(await service.issueMembership(body, currentUser(req).id));
}

export async function get(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  res.json(await service.getMembership(id));
}

export async function renew(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  const { payment } = renewMembershipBody.parse(req.body ?? {});
  res.status(201).json(await service.renewMembership(id, payment, currentUser(req).id));
}

export async function cancel(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  const { reason } = cancelMembershipBody.parse(req.body);
  res.json(await service.cancelMembership(id, reason));
}

export async function card(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  const membership = await service.getMembership(id);
  if (membership.displayStatus === 'CANCELLED' || membership.displayStatus === 'EXPIRED') {
    throw conflict(`Cannot print a card for a ${membership.displayStatus.toLowerCase()} membership`);
  }
  const clinic = await getClinicSettings();
  sendPdf(res, await renderMembershipCard(membership, clinic.name), `${membership.cardNo}.pdf`);
}
