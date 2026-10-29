import type { Patient, Prisma } from '@prisma/client';
import { prisma, type Db } from '../../shared/db/prisma';
import { notFound } from '../../shared/errors/AppError';
import { ageFromDateOfBirth, clinicToday, dateOnly } from '../../shared/lib/dates';
import { nextPatientCode } from '../../shared/lib/numbering';
import { paginated, toSkipTake } from '../../shared/lib/pagination';
import { phoneSearchDigits } from '../../shared/lib/validation';
import type { CreatePatientBody, ListPatientsQuery, UpdatePatientBody } from './patients.schema';

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

/** Age from date of birth, or the age given at registration plus time since. */
export function patientAge(p: Pick<Patient, 'dateOfBirth' | 'ageYears' | 'createdAt'>): number | null {
  if (p.dateOfBirth) return ageFromDateOfBirth(p.dateOfBirth);
  if (p.ageYears != null) {
    // createdAt comes from the database clock, which can be a moment ahead of ours.
    const yearsSince = Math.max(0, Math.floor((Date.now() - p.createdAt.getTime()) / YEAR_MS));
    return p.ageYears + yearsSince;
  }
  return null;
}

function activeMembershipWhere(today = clinicToday()): Prisma.MembershipWhereInput {
  return { status: 'ACTIVE', startDate: { lte: today }, endDate: { gte: today } };
}

const activeMembershipInclude = () => ({
  where: activeMembershipWhere(),
  orderBy: { endDate: 'desc' as const },
  take: 1,
  select: {
    id: true,
    cardNo: true,
    endDate: true,
    plan: { select: { id: true, name: true, discountPercent: true, departmentId: true } },
  },
});

function searchConditions(q: string): Prisma.PatientWhereInput[] {
  const conditions: Prisma.PatientWhereInput[] = [
    { name: { contains: q, mode: 'insensitive' } },
    { patientCode: { contains: q, mode: 'insensitive' } },
  ];
  const digits = phoneSearchDigits(q);
  if (digits.length >= 3) {
    conditions.push({ phone: { contains: digits } }, { altPhone: { contains: digits } });
  }
  return conditions;
}

function toPatientData<T extends { dateOfBirth?: string | null }>(body: T) {
  const { dateOfBirth, ...rest } = body;
  return {
    ...rest,
    ...(dateOfBirth !== undefined ? { dateOfBirth: dateOfBirth ? dateOnly(dateOfBirth) : null } : {}),
  };
}

function withAge<T extends Pick<Patient, 'dateOfBirth' | 'ageYears' | 'createdAt'>>(p: T) {
  return { ...p, age: patientAge(p) };
}

// ─── List & detail ──────────────────────────────────────────────────────────

export async function listPatients(query: ListPatientsQuery) {
  const where: Prisma.PatientWhereInput = {
    ...(query.includeDeleted ? {} : { deletedAt: null }),
    ...(query.q ? { OR: searchConditions(query.q) } : {}),
    ...(query.membership === 'active' ? { memberships: { some: activeMembershipWhere() } } : {}),
    ...(query.membership === 'none' ? { memberships: { none: activeMembershipWhere() } } : {}),
    ...(query.departmentId
      ? { appointments: { some: { departmentId: query.departmentId, status: { notIn: ['CANCELLED'] } } } }
      : {}),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.patient.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...toSkipTake(query),
      include: {
        memberships: activeMembershipInclude(),
        appointments: { orderBy: { visitDate: 'desc' }, take: 1, select: { visitDate: true } },
      },
    }),
    prisma.patient.count({ where }),
  ]);

  const items = rows.map(({ memberships, appointments, ...p }) => ({
    ...withAge(p),
    activeMembership: memberships[0] ?? null,
    lastVisitDate: appointments[0]?.visitDate ?? null,
  }));
  return paginated(items, total, query);
}

export async function getPatient(id: string, { allowDeleted = false } = {}) {
  const patient = await prisma.patient.findUnique({
    where: { id },
    include: { memberships: activeMembershipInclude(), _count: { select: { appointments: true } } },
  });
  if (!patient || (patient.deletedAt && !allowDeleted)) throw notFound('Patient');

  const dues = await prisma.invoice.aggregate({
    where: { patientId: id, status: { in: ['DUE', 'PARTIAL'] } },
    _sum: { total: true, paidAmount: true },
  });

  const { memberships, _count, ...rest } = patient;
  return {
    ...withAge(rest),
    activeMembership: memberships[0] ?? null,
    visitCount: _count.appointments,
    totalDue: (dues._sum.total ?? 0) - (dues._sum.paidAmount ?? 0),
  };
}

// ─── Create, update, delete ─────────────────────────────────────────────────

/** Creates a patient with a new CPD-xxxxxx code. Pass a transaction client to compose. */
export async function createPatient(db: Db, body: CreatePatientBody) {
  const patientCode = await nextPatientCode(db);
  const patient = await db.patient.create({ data: { ...toPatientData(body), patientCode } });
  return withAge(patient);
}

export async function updatePatient(id: string, body: UpdatePatientBody) {
  await getPatient(id);
  const patient = await prisma.patient.update({ where: { id }, data: toPatientData(body) });
  return withAge(patient);
}

/** Soft delete: the patient disappears from lists, history and invoices stay intact. */
export async function deletePatient(id: string) {
  await getPatient(id);
  await prisma.patient.update({ where: { id }, data: { deletedAt: new Date() } });
}

export async function restorePatient(id: string) {
  const patient = await prisma.patient.findUnique({ where: { id } });
  if (!patient) throw notFound('Patient');
  return withAge(await prisma.patient.update({ where: { id }, data: { deletedAt: null } }));
}

// ─── Lookup & search (public API) ───────────────────────────────────────────

/** Every patient sharing this phone number (families share phones). */
export async function findPatientsByPhone(phone: string) {
  const rows = await prisma.patient.findMany({
    where: { deletedAt: null, OR: [{ phone }, { altPhone: phone }] },
    orderBy: { createdAt: 'asc' },
    include: { memberships: activeMembershipInclude() },
  });
  return rows.map(({ memberships, ...p }) => ({ ...withAge(p), activeMembership: memberships[0] ?? null }));
}

/** Quick search for the global Ctrl+K box. */
export async function searchPatients(q: string, limit = 10) {
  const rows = await prisma.patient.findMany({
    where: { deletedAt: null, OR: searchConditions(q) },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      patientCode: true,
      name: true,
      phone: true,
      gender: true,
      dateOfBirth: true,
      ageYears: true,
      createdAt: true,
    },
  });
  return rows.map(withAge);
}

/** Throws unless the patient exists and is not deleted. */
export async function assertPatientExists(db: Db, id: string) {
  const patient = await db.patient.findUnique({ where: { id } });
  if (!patient || patient.deletedAt) throw notFound('Patient');
  return patient;
}

// ─── History timeline ───────────────────────────────────────────────────────

const HISTORY_LIMIT = 200;

export async function getPatientHistory(id: string, { includeInvoices = true } = {}) {
  await getPatient(id, { allowDeleted: true });

  const [appointments, invoices, prescriptions, notes] = await Promise.all([
    prisma.appointment.findMany({
      where: { patientId: id },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
      include: {
        department: { select: { id: true, name: true, color: true } },
        practitioner: { select: { id: true, name: true } },
        services: { include: { service: { select: { id: true, name: true } } } },
        treatments: true,
      },
    }),
    // Practitioners don't see billing, so their timeline has no invoices.
    includeInvoices
      ? prisma.invoice.findMany({
          where: { patientId: id },
          orderBy: { createdAt: 'desc' },
          take: HISTORY_LIMIT,
          include: { items: true, payments: { orderBy: { paidAt: 'asc' } } },
        })
      : Promise.resolve([]),
    prisma.prescription.findMany({
      where: { patientId: id },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
      include: {
        practitioner: { select: { id: true, name: true } },
        _count: { select: { images: true } },
      },
    }),
    prisma.note.findMany({
      where: { patientId: id },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
      include: { author: { select: { id: true, name: true } } },
    }),
  ]);

  const events = [
    ...appointments.map((data) => ({ type: 'visit' as const, at: data.createdAt, data })),
    ...invoices.map((data) => ({ type: 'invoice' as const, at: data.createdAt, data })),
    ...prescriptions.map((data) => ({ type: 'prescription' as const, at: data.createdAt, data })),
    ...notes.map((data) => ({ type: 'note' as const, at: data.createdAt, data })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return { events };
}

// ─── Notes ──────────────────────────────────────────────────────────────────

export async function listNotes(patientId: string) {
  await getPatient(patientId, { allowDeleted: true });
  return prisma.note.findMany({
    where: { patientId },
    orderBy: { createdAt: 'desc' },
    include: { author: { select: { id: true, name: true } } },
  });
}

export async function createNote(patientId: string, authorId: string, body: string) {
  await getPatient(patientId);
  return prisma.note.create({
    data: { patientId, authorId, body },
    include: { author: { select: { id: true, name: true } } },
  });
}
