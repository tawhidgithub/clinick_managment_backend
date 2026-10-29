import { beforeAll, describe, expect, it } from 'vitest';
import { clinic, type Clinic } from '../fixtures';
import { uid } from '../helpers';

let c: Clinic;
beforeAll(async () => {
  c = await clinic();
});

interface AuditRow { action: string; entityId: string | null; status: number; data: Record<string, unknown> | null; actor: { username: string } | null }

/** The log is written just after the response is sent, so poll briefly. */
async function auditFor(query: string, match: (row: AuditRow) => boolean): Promise<AuditRow | undefined> {
  for (let i = 0; i < 40; i++) {
    const rows: AuditRow[] = (await c.admin.get(`/audit-log?${query}&pageSize=100`)).body.items;
    const row = rows.find(match);
    if (row) return row;
    await new Promise((r) => setTimeout(r, 50));
  }
  return undefined;
}

describe('audit log', () => {
  it('records who voided an invoice, with the reason', async () => {
    const doctor = await c.newDoctor('PHY', 'Dr. Audit');
    const v = await c.visit({ doctor, services: [{ serviceId: c.service('Physio Consultation').id }] });

    const visitRow = await auditFor(`entityType=visits&entityId=${v.appointment.id}`, (r) => r.action === 'POST /visits');
    expect(visitRow?.actor?.username).toBe('frontdesk');

    const inv = (await c.desk.post('/invoices', { appointmentId: v.appointment.id })).body;
    expect((await c.admin.post(`/invoices/${inv.id}/void`, {})).status).toBe(400); // no reason: not logged
    await c.admin.post(`/invoices/${inv.id}/void`, { reason: 'Duplicate bill' });

    const voidRow = await auditFor(`entityType=invoices&entityId=${inv.id}`, (r) => r.action === 'POST /invoices/:id/void');
    expect(voidRow).toMatchObject({ status: 200, actor: { username: 'admin' }, data: { reason: 'Duplicate bill' } });
    const rows: AuditRow[] = (await c.admin.get(`/audit-log?entityId=${inv.id}`)).body.items;
    expect(rows.every((r) => r.status < 400)).toBe(true);
    expect(rows.filter((r) => r.action === 'POST /invoices/:id/void')).toHaveLength(1);
  });

  it('never stores passwords', async () => {
    const username = `audit${uid()}`;
    const staff = (await c.admin.post('/staff', { name: 'Audit Clerk', username, password: 'first-password', role: 'FRONT_DESK' })).body;
    await c.admin.post(`/staff/${staff.id}/reset-password`, { newPassword: 'second-password' });

    const created = await auditFor(`entityType=staff&entityId=${staff.id}`, (r) => r.action === 'POST /staff');
    expect(created?.data).toMatchObject({ username, password: '[removed]' });
    const reset = await auditFor(`entityType=staff&entityId=${staff.id}`, (r) => r.action === 'POST /staff/:id/reset-password');
    expect(reset?.data).toEqual({ newPassword: '[removed]' });
    expect(JSON.stringify(reset)).not.toContain('second-password');
  });

  it('skips reads, previews and sign-ins', async () => {
    const recent: AuditRow[] = (await c.admin.get('/audit-log?pageSize=100')).body.items;
    expect(recent.some((r) => r.action.startsWith('GET '))).toBe(false);
    expect(recent.some((r) => r.action === 'POST /invoices/preview' || r.action === 'POST /auth/login')).toBe(false);
  });
});
