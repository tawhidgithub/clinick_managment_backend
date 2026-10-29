// Seeded reference data plus helpers that create fresh doctors and visits, so
// every test works on its own queue and never depends on another test file.
import { expect } from 'vitest';
import { client, login, phone, uid, type Client } from './helpers';

interface Department { id: string; code: string; name: string }
interface Service { id: string; name: string; price: number; departmentId: string }
interface Plan { id: string; name: string; price: number; discountPercent: number }
export interface Doctor { id: string; name: string; departmentId: string }

export interface Clinic {
  admin: Client;
  desk: Client;
  dept: Record<'PHY' | 'DEN' | 'DIE', Department>;
  service: (name: string) => Service;
  plan: (name: string) => Plan;
  newDoctor: (code: 'PHY' | 'DEN' | 'DIE', name?: string) => Promise<Doctor>;
  visit: (input: VisitInput) => Promise<VisitResult>;
}

export interface VisitInput {
  doctor: Doctor;
  services: Array<{ serviceId: string; quantity?: number }>;
  patientId?: string;
  newPatient?: { name: string; phone: string; gender?: string; ageYears?: number };
  as?: Client;
}
export interface VisitResult {
  patient: { id: string; patientCode: string; isNew: boolean };
  appointment: { id: string; serialNo: number; status: string; servicesTotal: number };
  queue: { waitingAhead: number; doctorBusy: boolean };
  warnings: string[];
}

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '08:00', endTime: '22:00' }));

let cached: Clinic | undefined;

export async function clinic(): Promise<Clinic> {
  if (cached) return cached;
  const admin = client(await login('admin'));
  const desk = client(await login('frontdesk'));

  const departments: Department[] = (await desk.get('/departments')).body;
  const byCode = (code: string) => departments.find((d) => d.code === code)!;
  const services: Service[] = (await desk.get('/services')).body;
  const plans: Plan[] = (await desk.get('/membership-plans')).body;

  const newDoctor: Clinic['newDoctor'] = async (code, name = 'Dr. Test') => {
    const res = await admin.post('/practitioners', { name: `${name} ${uid()}`, departmentId: byCode(code).id });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    await admin.put(`/practitioners/${res.body.id}/schedules`, { schedules: EVERY_DAY });
    return res.body;
  };

  const visit: Clinic['visit'] = async ({ doctor, services, patientId, newPatient, as = desk }) => {
    const res = await as.post('/visits', {
      ...(patientId ? { patientId } : { newPatient: newPatient ?? { name: `Patient ${uid()}`, phone: phone(), gender: 'FEMALE', ageYears: 30 } }),
      departmentId: doctor.departmentId,
      practitionerId: doctor.id,
      services,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  };

  cached = {
    admin,
    desk,
    dept: { PHY: byCode('PHY'), DEN: byCode('DEN'), DIE: byCode('DIE') },
    service: (name) => {
      const s = services.find((x) => x.name === name);
      if (!s) throw new Error(`No seeded service "${name}"`);
      return s;
    },
    plan: (name) => {
      const p = plans.find((x) => x.name === name);
      if (!p) throw new Error(`No seeded plan "${name}"`);
      return p;
    },
    newDoctor,
    visit,
  };
  return cached;
}

/** Calls patients in until the doctor's queue is empty (completes everyone). */
export async function drainQueue(desk: Client, doctor: Doctor) {
  for (let i = 0; i < 100; i++) {
    const board = (await desk.get(`/queue/${doctor.id}`)).body;
    const res = await desk.post(`/queue/${doctor.id}/next`, {
      expectedCurrentAppointmentId: board.current?.id ?? null,
      callNext: board.waitingCount > 0,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    if (!res.body.calledId) return;
  }
}

/** Visit, then call and finish it, so it is COMPLETED and ready to bill. */
export async function completedVisit(c: Clinic, input: VisitInput) {
  const v = await c.visit(input);
  await drainQueue(c.desk, input.doctor);
  return v;
}
