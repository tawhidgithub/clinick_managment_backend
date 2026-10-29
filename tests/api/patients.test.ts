import { beforeAll, describe, expect, it } from 'vitest';
import { clinic, completedVisit, type Clinic } from '../fixtures';
import { client, login, phone, uid } from '../helpers';

let c: Clinic;

beforeAll(async () => {
  c = await clinic();
});

describe('patients', () => {
  it('creates, reads, updates and finds a patient by name, code and phone', async () => {
    const name = `Rahima ${uid()}`;
    const mobile = phone();
    const created = await c.desk.post('/patients', { name, phone: mobile, gender: 'FEMALE', ageYears: 41 });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ name, phone: mobile, age: 41 });
    const id = created.body.id as string;
    const code = created.body.patientCode as string;

    const detail = (await c.desk.get(`/patients/${id}`)).body;
    expect(detail).toMatchObject({ id, activeMembership: null, visitCount: 0, totalDue: 0 });

    const updated = await c.desk.patch(`/patients/${id}`, { bloodGroup: 'O+', address: 'Mirpur 10' });
    expect(updated.body).toMatchObject({ bloodGroup: 'O+', address: 'Mirpur 10' });

    for (const q of [name, code, mobile.slice(-6)]) {
      const list = (await c.desk.get(`/patients?q=${encodeURIComponent(q)}`)).body;
      expect(list.items.map((p: { id: string }) => p.id), q).toContain(id);
    }
    const search = (await c.desk.get(`/search?q=${encodeURIComponent(name)}`)).body;
    expect(search.patients[0]).toMatchObject({ id, patientCode: code });
  });

  it('looks up everyone sharing a phone number', async () => {
    const shared = phone();
    await c.desk.post('/patients', { name: `Parent ${uid()}`, phone: shared });
    await c.desk.post('/patients', { name: `Child ${uid()}`, phone: phone(), altPhone: shared });
    const res = await c.desk.get(`/patients/lookup?phone=${shared}`);
    expect(res.status).toBe(200);
    expect(res.body.patients).toHaveLength(2);
  });

  it('filters by department visited', async () => {
    const doctor = await c.newDoctor('DEN');
    const v = await c.visit({ doctor, services: [{ serviceId: c.service('Dental Consultation').id }] });

    const dental = (await c.desk.get(`/patients?departmentId=${c.dept.DEN.id}&q=${v.patient.patientCode}`)).body;
    expect(dental.items.map((p: { id: string }) => p.id)).toEqual([v.patient.id]);
    const physio = (await c.desk.get(`/patients?departmentId=${c.dept.PHY.id}&q=${v.patient.patientCode}`)).body;
    expect(physio.items).toEqual([]);
  });

  it('keeps notes, and only an admin can delete and restore', async () => {
    const id = (await c.desk.post('/patients', { name: `Note ${uid()}`, phone: phone() })).body.id as string;
    const note = await c.desk.post(`/patients/${id}/notes`, { body: 'Prefers morning slots' });
    expect(note.status).toBe(201);
    expect(note.body.author.name).toBeTruthy();
    expect((await c.desk.get(`/patients/${id}/notes`)).body).toHaveLength(1);

    expect((await c.desk.delete(`/patients/${id}`)).status).toBe(403);
    expect((await c.admin.delete(`/patients/${id}`)).status).toBe(204);
    expect((await c.desk.get(`/patients/${id}`)).status).toBe(404);
    expect((await c.admin.get(`/patients/${id}`)).body.deletedAt).toBeTruthy();
    expect((await c.admin.post(`/patients/${id}/restore`)).body.deletedAt).toBeNull();
  });

  it('hides billing from practitioners', async () => {
    const doctor = await c.newDoctor('PHY');
    const v = await completedVisit(c, { doctor, services: [{ serviceId: c.service('Physio Consultation').id }] });
    expect((await c.desk.post('/invoices', { appointmentId: v.appointment.id })).status).toBe(201);

    const desk = (await c.desk.get(`/patients/${v.patient.id}/history`)).body;
    expect(desk.events.map((e: { type: string }) => e.type).sort()).toEqual(['invoice', 'visit']);
    expect((await c.desk.get(`/patients/${v.patient.id}`)).body.totalDue).toBeGreaterThan(0);

    const username = `physio${uid()}`;
    await c.admin.post('/staff', { name: 'Physio', username, password: 'password123', role: 'PRACTITIONER', practitionerId: doctor.id });
    const doc = client(await login(username, 'password123'));
    const history = (await doc.get(`/patients/${v.patient.id}/history`)).body;
    expect(history.events.map((e: { type: string }) => e.type)).toEqual(['visit']);
    expect((await doc.get(`/patients/${v.patient.id}`)).body.totalDue).toBeNull();
  });
});
