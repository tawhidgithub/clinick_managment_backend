import { beforeAll, describe, expect, it } from 'vitest';
import { clinic, type Clinic, type Doctor } from '../fixtures';
import { client, phone, uid } from '../helpers';

let c: Clinic;
let consult: { id: string; price: number };
let session: { id: string; price: number };

beforeAll(async () => {
  c = await clinic();
  consult = c.service('Physio Consultation');
  session = c.service('Physiotherapy Session');
});

const board = async (doctor: Doctor) => (await c.desk.get(`/queue/${doctor.id}`)).body;
const order = (b: { waiting: Array<{ serialNo: number }> }) => b.waiting.map((w) => w.serialNo).join(',');

describe('new visit (register + book in one go)', () => {
  it('registers a new patient, gives serial 1 and prices the services', async () => {
    const doctor = await c.newDoctor('PHY');
    expect(await board(doctor)).toMatchObject({ status: 'FREE', waitingCount: 0, nextSerial: 1 });

    const v = await c.visit({ doctor, services: [{ serviceId: consult.id }, { serviceId: session.id, quantity: 2 }] });
    expect(v.patient.patientCode).toMatch(/^CPD-\d{6}$/);
    expect(v.patient.isNew).toBe(true);
    expect(v.appointment).toMatchObject({ serialNo: 1, status: 'WAITING', servicesTotal: consult.price + 2 * session.price });
    expect(v.queue).toMatchObject({ waitingAhead: 0, doctorBusy: false });
    expect(v.warnings).toEqual([]);

    const second = await c.visit({ doctor, services: [{ serviceId: consult.id }] });
    expect(second.appointment.serialNo).toBe(2);
    expect(second.queue.waitingAhead).toBe(1);
    expect(second.patient.patientCode).not.toBe(v.patient.patientCode);
  });

  it('refuses a patient already waiting for the same doctor', async () => {
    const doctor = await c.newDoctor('PHY');
    const v = await c.visit({ doctor, services: [{ serviceId: consult.id }] });
    const again = await c.desk.post('/visits', { patientId: v.patient.id, departmentId: doctor.departmentId, practitionerId: doctor.id, services: [{ serviceId: consult.id }] });
    expect(again.status).toBe(409);
  });

  it('validates department, doctor and services', async () => {
    const doctor = await c.newDoctor('PHY');
    const dental = c.service('Scaling & Polishing');
    const base = { departmentId: doctor.departmentId, practitionerId: doctor.id };
    const np = () => ({ name: `V ${uid()}`, phone: phone() });

    expect((await c.desk.post('/visits', { ...base, newPatient: np(), services: [{ serviceId: dental.id }] })).status).toBe(400);
    expect((await c.desk.post('/visits', { ...base, departmentId: c.dept.DEN.id, newPatient: np(), services: [{ serviceId: dental.id }] })).status).toBe(400);
    expect((await c.desk.post('/visits', { ...base, newPatient: np(), services: [] })).status).toBe(400);
    expect((await c.desk.post('/visits', { ...base, newPatient: np(), services: [{ serviceId: consult.id }, { serviceId: consult.id }] })).status).toBe(400);
    const badPhone = await c.desk.post('/visits', { ...base, newPatient: { name: 'X', phone: '123' }, services: [{ serviceId: consult.id }] });
    expect(badPhone.status).toBe(400);
    expect(badPhone.body.error.details[0].path).toBe('newPatient.phone');
    expect((await board(doctor)).waitingCount).toBe(0);
  });

  it('saves a visit for an unscheduled doctor with a warning', async () => {
    const res = await c.admin.post('/practitioners', { name: `Dr. Off ${uid()}`, departmentId: c.dept.PHY.id });
    const v = await c.visit({ doctor: res.body, services: [{ serviceId: consult.id }] });
    expect(v.warnings).toHaveLength(1);
  });
});

describe('queue: Next, Skip, Requeue', () => {
  it('follows the queue rules', async () => {
    const doctor = await c.newDoctor('PHY');
    const [v1, v2, v3] = [
      await c.visit({ doctor, services: [{ serviceId: consult.id }] }),
      await c.visit({ doctor, services: [{ serviceId: consult.id }] }),
      await c.visit({ doctor, services: [{ serviceId: consult.id }] }),
    ];
    const next = (expected: string | null, callNext = true) =>
      c.desk.post(`/queue/${doctor.id}/next`, { expectedCurrentAppointmentId: expected, callNext });

    // A screen showing the wrong patient in the room must not skip anyone.
    expect((await next(v2!.appointment.id)).status).toBe(409);

    const n1 = await next(null);
    expect(n1.body).toMatchObject({ calledSerial: 1, completedId: null });
    expect(order(n1.body.queue)).toBe('2,3');
    expect((await next(null)).status).toBe(409); // same click replayed

    const n2 = await next(v1!.appointment.id);
    expect(n2.body).toMatchObject({ completedId: v1!.appointment.id, calledSerial: 2 });
    expect(n2.body.queue.completedCount).toBe(1);

    const v4 = await c.visit({ doctor, services: [{ serviceId: consult.id }] });
    expect(v4.queue.doctorBusy).toBe(true);

    const moved = await c.desk.post(`/queue/${v3!.appointment.id}/skip`, { action: 'MOVE_TO_END' });
    expect(order(moved.body.queue)).toBe('4,3');
    const noShow = await c.desk.post(`/queue/${v4.appointment.id}/skip`, { action: 'NO_SHOW' });
    expect(order(noShow.body.queue)).toBe('3');
    expect(noShow.body.queue.noShows[0].serialNo).toBe(4);
    expect((await c.desk.post(`/queue/${v4.appointment.id}/skip`, { action: 'NO_SHOW' })).status).toBe(409);

    const back = await c.desk.post(`/queue/${v4.appointment.id}/requeue`);
    expect(order(back.body.queue)).toBe('3,4');
    expect(back.body.queue.waiting.find((w: { serialNo: number }) => w.serialNo === 4)).toBeTruthy(); // printed serial never changes

    const brk = await next(v2!.appointment.id, false);
    expect(brk.body).toMatchObject({ calledId: null });
    expect(brk.body.queue).toMatchObject({ status: 'FREE', waitingCount: 2 });
  });

  it('6 simultaneous Next clicks advance the queue exactly once', async () => {
    const doctor = await c.newDoctor('PHY');
    for (let i = 0; i < 4; i++) await c.visit({ doctor, services: [{ serviceId: consult.id }] });
    const first = await c.desk.post(`/queue/${doctor.id}/next`, { expectedCurrentAppointmentId: null });
    const clicks = await Promise.all(
      Array.from({ length: 6 }, () => c.desk.post(`/queue/${doctor.id}/next`, { expectedCurrentAppointmentId: first.body.calledId })),
    );
    expect(clicks.filter((r) => r.status === 200)).toHaveLength(1);
    expect(clicks.filter((r) => r.status === 409)).toHaveLength(5);
    expect(await board(doctor)).toMatchObject({ completedCount: 1, waitingCount: 2 });
  });

  it('12 desks booking at once get unique, consecutive serials', async () => {
    const doctor = await c.newDoctor('PHY');
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        c.desk.post('/visits', {
          newPatient: { name: `Rush ${uid()}`, phone: phone() },
          departmentId: doctor.departmentId,
          practitionerId: doctor.id,
          services: [{ serviceId: consult.id }],
        }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(Array(12).fill(201));
    const serials = results.map((r) => r.body.appointment.serialNo as number).sort((a, b) => a - b);
    expect(serials).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it('Save clicked 3 times at once creates one visit and one patient', async () => {
    const doctor = await c.newDoctor('PHY');
    const np = { name: `Double ${uid()}`, phone: phone() };
    const tries = await Promise.all(
      Array.from({ length: 3 }, () =>
        c.desk.post('/visits', { newPatient: np, departmentId: doctor.departmentId, practitionerId: doctor.id, services: [{ serviceId: consult.id }] }),
      ),
    );
    expect(tries.filter((r) => r.status === 201)).toHaveLength(1);
    expect(tries.filter((r) => r.status === 409)).toHaveLength(2);
    expect((await c.desk.get(`/patients/lookup?phone=${np.phone}`)).body.patients).toHaveLength(1);
  });

  it('only Admin and Front Desk can run the queue', async () => {
    const doctor = await c.newDoctor('PHY');
    expect((await client().post(`/queue/${doctor.id}/next`, {})).status).toBe(401);
  });
});

describe('appointments', () => {
  it('cancel needs a reason and only works on open visits', async () => {
    const doctor = await c.newDoctor('PHY');
    const v = await c.visit({ doctor, services: [{ serviceId: consult.id }] });
    expect((await c.desk.post(`/appointments/${v.appointment.id}/cancel`, {})).status).toBe(400);
    const ok = await c.desk.post(`/appointments/${v.appointment.id}/cancel`, { reason: 'Patient left' });
    expect(ok.body).toMatchObject({ status: 'CANCELLED', cancelReason: 'Patient left' });
    expect((await c.desk.post(`/appointments/${v.appointment.id}/cancel`, { reason: 'again' })).status).toBe(409);
  });

  it('services can change before billing; booked prices are kept', async () => {
    const doctor = await c.newDoctor('PHY');
    const v = await c.visit({ doctor, services: [{ serviceId: consult.id }] });
    const manual = c.service('Manual Therapy');
    const res = await c.desk.put(`/appointments/${v.appointment.id}/services`, { services: [{ serviceId: consult.id }, { serviceId: manual.id }] });
    expect(res.status).toBe(200);
    expect(res.body.servicesTotal).toBe(consult.price + manual.price);
  });
});
