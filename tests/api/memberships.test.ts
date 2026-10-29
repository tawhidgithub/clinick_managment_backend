import { beforeAll, describe, expect, it } from 'vitest';
import { clinic, drainQueue, type Clinic, type Doctor } from '../fixtures';
import { asBinary, expectPdf, uid } from '../helpers';

let c: Clinic;
let physio: Doctor;
let dentist: Doctor;

beforeAll(async () => {
  c = await clinic();
  physio = await c.newDoctor('PHY', 'Dr. Member Physio');
  dentist = await c.newDoctor('DEN', 'Dr. Member Dental');
});

const addDays = (iso: string, days: number) => new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();

describe('memberships', () => {
  it('issue, discount on the next invoice, renew, cancel, card', async () => {
    const gold = c.plan('Gold');
    const consult = c.service('Physio Consultation');
    const session = c.service('Physiotherapy Session');
    const first = await c.visit({ doctor: physio, services: [{ serviceId: consult.id }] });
    const patientId = first.patient.id;
    await drainQueue(c.desk, physio);

    const issued = await c.desk.post('/memberships', { patientId, planId: gold.id, payment: { amount: gold.price } });
    expect(issued.status).toBe(201);
    const m = issued.body;
    expect(m.cardNo).toMatch(/^CPD-M-\d{5}$/);
    expect(m.displayStatus).toBe('ACTIVE');
    expect(m.invoices[0]).toMatchObject({ status: 'PAID', total: gold.price });
    const start = new Date(m.startDate);
    expect(m.endDate).toBe(new Date(Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), start.getUTCDate() - 1)).toISOString());

    expect((await c.desk.post('/memberships', { patientId, planId: gold.id })).status).toBe(409);
    expect((await c.desk.post('/memberships', { patientId, planId: gold.id, startDate: '2020-01-01' })).status).toBe(400);

    const lookup = await c.desk.get(`/memberships/lookup?patientId=${patientId}`);
    expect(lookup.body.best).toMatchObject({ planName: 'Gold', discountPercent: 20 });

    const v = await c.visit({ doctor: physio, patientId, services: [{ serviceId: consult.id }, { serviceId: session.id }] });
    const inv = await c.desk.post('/invoices', { appointmentId: v.appointment.id });
    const subtotal = consult.price + session.price;
    expect(inv.body.memberDiscount).toBe(Math.floor(subtotal * 0.2));
    expect(inv.body.memberDiscountNote).toContain(m.cardNo);
    const off = await c.desk.patch(`/invoices/${inv.body.id}`, { applyMemberDiscount: false });
    expect(off.body).toMatchObject({ memberDiscount: 0, total: subtotal });

    const renewed = await c.desk.post(`/memberships/${m.id}/renew`, { payment: { amount: gold.price, method: 'NAGAD' } });
    expect(renewed.status).toBe(201);
    expect(renewed.body).toMatchObject({ startDate: addDays(m.endDate, 1), displayStatus: 'UPCOMING' });
    expect(renewed.body.renewedFrom.id).toBe(m.id);
    expect((await c.desk.post(`/memberships/${m.id}/renew`, {})).status).toBe(409);

    expect((await c.desk.post(`/memberships/${renewed.body.id}/cancel`, { reason: 'Changed mind' })).status).toBe(403);
    const cancelled = await c.admin.post(`/memberships/${renewed.body.id}/cancel`, { reason: 'Changed mind' });
    expect(cancelled.body).toMatchObject({ status: 'CANCELLED', cancelReason: 'Changed mind' });
    expect((await c.desk.get(`/memberships/${renewed.body.id}/card`)).status).toBe(409);

    expectPdf(await asBinary(c.desk.get(`/memberships/${m.id}/card`)));
  });

  it('a department plan only discounts that department', async () => {
    const physioCare = c.plan('Physio Care');
    const consult = c.service('Physio Consultation');
    const scaling = c.service('Scaling & Polishing');
    const first = await c.visit({ doctor: physio, services: [{ serviceId: consult.id }] });
    const patientId = first.patient.id;
    await c.desk.post('/memberships', { patientId, planId: physioCare.id });

    const physioInv = await c.desk.post('/invoices', { appointmentId: first.appointment.id });
    expect(physioInv.body.memberDiscount).toBe(Math.floor(consult.price * 0.15));

    const dental = await c.visit({ doctor: dentist, patientId, services: [{ serviceId: scaling.id }] });
    expect((await c.desk.post('/invoices', { appointmentId: dental.appointment.id })).body.memberDiscount).toBe(0);

    const mixed = await c.desk.post('/invoices/preview', { patientId, items: [{ serviceId: consult.id }, { serviceId: scaling.id }] });
    expect(mixed.body.memberDiscount).toBe(Math.floor(consult.price * 0.15));

    const unpaid = (await c.desk.get(`/memberships?tab=active&patientId=${patientId}`)).body.items[0];
    expect(unpaid.invoices[0].status).toBe('DUE');
  });

  it('short plans show in the expiring tab; inactive plans cannot be issued', async () => {
    const consult = c.service('Physio Consultation');
    const v = await c.visit({ doctor: physio, services: [{ serviceId: consult.id }] });
    const trial = (await c.admin.post('/membership-plans', { name: `Trial ${uid()}`, price: 20000, durationMonths: 1, discountPercent: 5 })).body;
    await c.desk.post('/memberships', { patientId: v.patient.id, planId: trial.id });
    const expiring = await c.desk.get(`/memberships?tab=expiring&patientId=${v.patient.id}`);
    expect(expiring.body.items.some((m: { plan: { id: string }; expiringSoon: boolean }) => m.plan.id === trial.id && m.expiringSoon)).toBe(true);

    await c.admin.patch(`/membership-plans/${trial.id}`, { isActive: false });
    const other = await c.visit({ doctor: dentist, services: [{ serviceId: c.service('Dental Consultation').id }] });
    expect((await c.desk.post('/memberships', { patientId: other.patient.id, planId: trial.id })).status).toBe(400);
  });
});
