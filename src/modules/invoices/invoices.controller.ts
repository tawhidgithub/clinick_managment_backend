import type { Request, Response } from 'express';
import { currentUser } from '../../shared/middleware/authenticate';
import { idParams } from '../../shared/lib/validation';
import { sendPdf } from '../../shared/pdf/pdf';
import { getClinicSettings } from '../clinic-settings';
import { renderInvoicePdf } from './invoices.pdf';
import {
  createInvoiceBody,
  listInvoicesQuery,
  paymentInput,
  pdfQuery,
  previewInvoiceBody,
  updateInvoiceBody,
  voidInvoiceBody,
} from './invoices.schema';
import * as service from './invoices.service';

export async function list(req: Request, res: Response) {
  const query = listInvoicesQuery.parse(req.query);
  res.json(await service.listInvoices(query));
}

export async function preview(req: Request, res: Response) {
  const body = previewInvoiceBody.parse(req.body);
  res.json(await service.previewInvoice(body));
}

export async function create(req: Request, res: Response) {
  const body = createInvoiceBody.parse(req.body);
  res.status(201).json(await service.createInvoiceAndLoad(body, currentUser(req).id));
}

export async function get(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  res.json(await service.getInvoice(id));
}

export async function update(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  const body = updateInvoiceBody.parse(req.body);
  res.json(await service.updateInvoice(id, body));
}

export async function addPayment(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  const body = paymentInput.parse(req.body);
  res.status(201).json(await service.addPayment(id, body, currentUser(req).id));
}

export async function voidInvoice(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  const { reason, refundMethod } = voidInvoiceBody.parse(req.body);
  res.json(await service.voidInvoice(id, reason, refundMethod, currentUser(req).id));
}

export async function pdf(req: Request, res: Response) {
  const { id } = idParams.parse(req.params);
  const { paper, download } = pdfQuery.parse(req.query);
  const [invoice, clinic] = await Promise.all([service.getInvoice(id), getClinicSettings()]);
  sendPdf(res, await renderInvoicePdf(invoice, clinic, paper), `${invoice.invoiceNo}.pdf`, download);
}
