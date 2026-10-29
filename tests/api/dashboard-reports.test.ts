import { beforeAll, describe, expect, it } from 'vitest';
import { clinic, completedVisit, drainQueue, type Clinic } from '../fixtures';
import { client, login, uid } from '../helpers';

let c: Clinic;
beforeAll(async () => {
  c = await clinic();
});

const sum = <T>(rows: T[], key: keyof T) => rows.reduce((s, r) => s + (r[key] as number), 0);

describe('dashboard', () => {
  it("reflects today's visits, collection, dues and unbilled visits", async () => {
    const before = (await c.desk.get('/dashboard')).body;
    const doctor = await c.newDoctor('PHY', 'Dr. Dash');
    const consult = c.service('Physio Consultation');

    const billed = await c.visit({ doctor, services: [{ serviceId: consult.id }] });
    await c.visit({ doctor, services: [{ serviceId: consult.id }] });
    await drainQueue(c.desk, doctor); // both COMPLETED
    const inv = (await c.desk.post('/invoices', { appointmentId: billed.appointment.id, payment: { amount: 10000, method: 'CASH' } })).body;

    const res = await c.desk.get('/dashboard');
    expect(res.status).toBe(200);
    const after = res.body;
    expect(after.stats.visitsToday - before.stats.visitsToday).toBe(2);
    expect(after.stats.completedToday - before.stats.completedToday).toBe(2);
    expect(after.money.collectedToday - before.money.collectedToday).toBe(10000);
    expect(after.money.billedToday - before.money.billedToday).toBe(inv.total);
    expect(after.money.totalDue - before.money.totalDue).toBe(inv.total - 10000);
    expect(after.pendingPayments.total - before.pendingPayments.total).toBe(1);
    expect(after.unbilledVisits.total - before.unbilledVisits.total).toBe(1);
    expect(sum(after.money.collectedByMethod, 'amount')).toBe(after.money.collectedToday);

    const mine = after.queue.doctors.find((d: { practitioner: { id: string } }) => d.practitioner.id === doctor.id);
    expect(mine).toMatchObject({ completedCount: 2, waitingCount: 0, status: 'FREE' });
    const billedRow = after.todayVisits.find((v: { id: string }) => v.id === billed.appointment.id);
    expect(billedRow.invoice).toMatchObject({ id: inv.id, due: inv.total - 10000 });
  });

  it('filters by department', async () => {
    const res = await c.desk.get(`/dashboard?departmentId=${c.dept.DEN.id}`);
    expect(res.body.queue.doctors.every((d: { department: { id: string } }) => d.department.id === c.dept.DEN.id)).toBe(true);
    expect(res.body.todayVisits.every((v: { department: { id: string } }) => v.department.id === c.dept.DEN.id)).toBe(true);
  });

  it('practitioners see the queue but no money', async () => {
    const doctor = await c.newDoctor('DIE', 'Dr. Dash Diet');
    const visit = await completedVisit(c, { doctor, services: [{ serviceId: c.service('Diet Consultation').id }] });
    expect((await c.desk.post('/invoices', { appointmentId: visit.appointment.id })).status).toBe(201);
    const username = `diet${uid()}`;
    await c.admin.post('/staff', { name: 'Dietitian', username, password: 'password123', role: 'PRACTITIONER', practitionerId: doctor.id });
    const res = await client(await login(username, 'password123')).get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.queue.doctors.length).toBeGreaterThan(0);
    expect(res.body).toMatchObject({ money: null, pendingPayments: null, unbilledVisits: null, expiringMemberships: null });
    const billed = res.body.todayVisits.find((v: { id: string }) => v.id === visit.appointment.id);
    expect(billed).toBeDefined();
    expect(billed.invoice).toBeNull();
  });
});

describe('reports', () => {
  it('adds up: departments, doctors, series and payment methods all match the summary', async () => {
    const today = (await c.desk.get('/dashboard')).body.date as string;
    const before = (await c.admin.get(`/reports?from=${today}&to=${today}`)).body;

    const doctor = await c.newDoctor('DEN', 'Dr. Report');
    const scaling = c.service('Scaling & Polishing');
    const v1 = await c.visit({ doctor, services: [{ serviceId: scaling.id }] });
    const v2 = await c.visit({ doctor, services: [{ serviceId: scaling.id }] });
    await drainQueue(c.desk, doctor);
    await c.desk.post('/invoices', { appointmentId: v1.appointment.id, payment: { amount: scaling.price, method: 'BKASH' } });
    const second = (await c.desk.post('/invoices', { appointmentId: v2.appointment.id, payment: { amount: 50000, method: 'CASH' } })).body;
    await c.admin.post(`/invoices/${second.id}/void`, { reason: 'Billed twice by mistake', refundMethod: 'CASH' });

    const res = await c.admin.get(`/reports?from=${today}&to=${today}`);
    expect(res.status).toBe(200);
    const r = res.body;
    expect(r.range).toMatchObject({ from: today, to: today, days: 1, groupBy: 'day' });

    // Deltas from this test's activity
    expect(r.summary.billed - before.summary.billed).toBe(scaling.price); // void invoice excluded
    expect(r.summary.received - before.summary.received).toBe(scaling.price + 50000);
    expect(r.summary.refunded - before.summary.refunded).toBe(50000);
    expect(r.summary.collected - before.summary.collected).toBe(scaling.price);
    expect(r.summary.voidedInvoices - before.summary.voidedInvoices).toBe(1);
    expect(r.summary.visits - before.summary.visits).toBe(2);
    const doc = r.practitioners.find((p: { practitioner: { id: string } }) => p.practitioner.id === doctor.id);
    expect(doc).toMatchObject({ visits: 2, completed: 2, billed: scaling.price, collected: scaling.price });

    // Internal consistency
    expect(sum(r.revenueByDepartment, 'billed')).toBe(r.summary.billed);
    expect(sum(r.revenueByDepartment, 'collected')).toBe(r.summary.collected);
    expect(sum(r.series, 'billed')).toBe(r.summary.billed);
    expect(sum(r.series, 'collected')).toBe(r.summary.collected);
    expect(sum(r.series, 'visits')).toBe(r.summary.visits);
    expect(sum(r.appointmentsByDepartment, 'total')).toBe(r.summary.visits);
    expect(sum(r.paymentMethods, 'net')).toBe(r.summary.collected);
    expect(sum(r.dues.aging, 'amount')).toBe(r.dues.total);
    expect(r.topServices.some((s: { service: { id: string } | null }) => s.service?.id === scaling.id)).toBe(true);

    // Same figures as the invoice list and the dashboard
    const list = (await c.admin.get(`/invoices?from=${today}&to=${today}&pageSize=1`)).body;
    expect(r.summary.billed).toBe(list.totals.total);
    const dash = (await c.admin.get('/dashboard')).body;
    expect(r.dues.total).toBe(dash.money.totalDue);
    expect(r.summary.collected).toBe(dash.money.collectedToday);
  });

  it('groups long ranges by month and validates the range', async () => {
    const year = await c.admin.get('/reports?from=2026-01-01&to=2026-12-31');
    expect(year.body.range.groupBy).toBe('month');
    expect(year.body.series.map((s: { bucket: string }) => s.bucket)).toEqual(
      Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`),
    );
    expect((await c.admin.get('/reports?from=2026-10-10&to=2026-10-01')).status).toBe(400);
    expect((await c.admin.get('/reports?from=2020-01-01&to=2026-01-01')).status).toBe(400);
    expect((await c.admin.get('/reports?from=2026-13-01')).status).toBe(400);
  });
});
