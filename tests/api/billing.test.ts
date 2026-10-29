import { beforeAll, describe, expect, it } from 'vitest';
import { clinic, completedVisit, type Clinic, type Doctor } from '../fixtures';
import { asBinary, expectPdf } from '../helpers';

let c: Clinic;
let doctor: Doctor;
let consult: { id: string; price: number };
let session: { id: string; price: number };

beforeAll(async () => {
  c = await clinic();
  doctor = await c.newDoctor('PHY', 'Dr. Billing');
  consult = c.service('Physio Consultation');
  session = c.service('Physiotherapy Session');
});

describe('invoices', () => {
  it('bills a visit: preview, partial payment, pay the rest, never overpay', async () => {
    const v = await completedVisit(c, { doctor, services: [{ serviceId: consult.id }, { serviceId: session.id, quantity: 2 }] });
    const subtotal = consult.price + 2 * session.price;

    const preview = await c.desk.post('/invoices/preview', { appointmentId: v.appointment.id });
    expect(preview.body).toMatchObject({ subtotal, memberDiscount: 0, total: subtotal });
    expect(preview.body.items).toHaveLength(2);

    expect((await c.desk.post('/invoices', { appointmentId: v.appointment.id, manualDiscount: subtotal + 1 })).status).toBe(400);

    const created = await c.desk.post('/invoices', { appointmentId: v.appointment.id, payment: { amount: 30000, method: 'CASH' } });
    expect(created.status).toBe(201);
    const inv = created.body;
    expect(inv).toMatchObject({ status: 'PARTIAL', paidAmount: 30000, due: subtotal - 30000 });
    expect(inv.invoiceNo).toMatch(/^INV-\d{4}-\d{6}$/);

    const dup = await c.desk.post('/invoices', { appointmentId: v.appointment.id });
    expect(dup.status).toBe(409);
    expect(dup.body.error.details.invoiceId).toBe(inv.id);
    expect((await c.desk.put(`/appointments/${v.appointment.id}/services`, { services: [{ serviceId: consult.id }] })).status).toBe(409);
    expect((await c.desk.patch(`/invoices/${inv.id}`, { manualDiscount: 100 })).status).toBe(409); // partly paid: void instead

    const over = await c.desk.post(`/invoices/${inv.id}/payments`, { amount: inv.due + 1 });
    expect(over.status).toBe(400);
    expect(over.body.error.details.due).toBe(inv.due);
    expect((await c.desk.post(`/invoices/${inv.id}/payments`, { amount: 0 })).status).toBe(400);

    const rest = await c.desk.post(`/invoices/${inv.id}/payments`, { amount: inv.due, method: 'BKASH', reference: 'TRX1' });
    expect(rest.status).toBe(201);
    expect(rest.body).toMatchObject({ status: 'PAID', due: 0 });
    expect(rest.body.payments).toHaveLength(2);
    expect((await c.desk.post(`/invoices/${inv.id}/payments`, { amount: 100 })).status).toBe(409);

    expectPdf(await asBinary(c.desk.get(`/invoices/${inv.id}/pdf`)));
    expectPdf(await asBinary(c.desk.get(`/invoices/${inv.id}/pdf?paper=a4&download=true`)));
  });

  it('void: Admin only, refunds what was paid, then the visit can be billed again', async () => {
    const v = await completedVisit(c, { doctor, services: [{ serviceId: consult.id }] });
    const inv = (await c.desk.post('/invoices', { appointmentId: v.appointment.id, payment: { amount: consult.price } })).body;

    expect((await c.desk.post(`/invoices/${inv.id}/void`, { reason: 'Wrong service' })).status).toBe(403);
    const voided = await c.admin.post(`/invoices/${inv.id}/void`, { reason: 'Wrong service billed', refundMethod: 'CASH' });
    expect(voided.body).toMatchObject({ status: 'VOID', paidAmount: 0, voidReason: 'Wrong service billed' });
    expect(voided.body.payments.find((p: { amount: number }) => p.amount < 0).amount).toBe(-consult.price);
    expect((await c.admin.post(`/invoices/${inv.id}/void`, { reason: 'again' })).status).toBe(409);

    const rebill = await c.desk.post('/invoices', { appointmentId: v.appointment.id });
    expect(rebill.status).toBe(201);
    expect(rebill.body.status).toBe('DUE');

    const edited = await c.desk.patch(`/invoices/${rebill.body.id}`, {
      manualDiscount: 5000,
      items: [{ serviceId: consult.id }, { description: 'Kinesio tape', unitPrice: 30000 }],
    });
    expect(edited.body).toMatchObject({ subtotal: consult.price + 30000, manualDiscount: 5000, total: consult.price + 25000 });
  });

  it('5 simultaneous payments that each fit alone: only one is accepted', async () => {
    const v = await completedVisit(c, { doctor, services: [{ serviceId: session.id }] });
    const inv = (await c.desk.post('/invoices', { appointmentId: v.appointment.id })).body;
    const part = Math.ceil(inv.total * 0.6);
    const results = await Promise.all(Array.from({ length: 5 }, () => c.desk.post(`/invoices/${inv.id}/payments`, { amount: part })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const after = (await c.desk.get(`/invoices/${inv.id}`)).body;
    expect(after).toMatchObject({ paidAmount: part, status: 'PARTIAL' });
  });

  it('4 simultaneous invoices for one visit: exactly one is created', async () => {
    const v = await completedVisit(c, { doctor, services: [{ serviceId: consult.id }] });
    const results = await Promise.all(Array.from({ length: 4 }, () => c.desk.post('/invoices', { appointmentId: v.appointment.id })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
  });

  it('a fully discounted invoice is PAID; custom invoices need items with prices', async () => {
    const v = await completedVisit(c, { doctor, services: [{ serviceId: consult.id }] });
    const free = await c.desk.post('/invoices', { appointmentId: v.appointment.id, manualDiscount: consult.price });
    expect(free.body).toMatchObject({ total: 0, status: 'PAID' });

    const custom = await c.desk.post('/invoices', { patientId: v.patient.id, items: [{ description: 'Report copy', unitPrice: 10000, quantity: 2 }] });
    expect(custom.status).toBe(201);
    expect(custom.body).toMatchObject({ appointmentId: null, subtotal: 20000 });
    expect((await c.desk.post('/invoices', { patientId: v.patient.id })).status).toBe(400);
    expect((await c.desk.post('/invoices', { patientId: v.patient.id, items: [{ description: 'No price' }] })).status).toBe(400);
  });

  it('cannot bill a cancelled visit', async () => {
    const v = await c.visit({ doctor, services: [{ serviceId: consult.id }] });
    await c.desk.post(`/appointments/${v.appointment.id}/cancel`, { reason: 'left' });
    expect((await c.desk.post('/invoices', { appointmentId: v.appointment.id })).status).toBe(409);
  });

  it('list totals ignore void invoices', async () => {
    const res = await c.desk.get(`/invoices?pageSize=100`);
    const live = res.body.items.filter((i: { status: string }) => i.status !== 'VOID');
    expect(res.body.items.some((i: { status: string }) => i.status === 'VOID')).toBe(true);
    if (res.body.total <= 100) expect(res.body.totals.total).toBe(live.reduce((s: number, i: { total: number }) => s + i.total, 0));
  });
});
