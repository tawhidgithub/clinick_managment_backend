import type { Prisma } from '@prisma/client';
import { LOCKING_TX_OPTIONS, prisma, type Tx } from '../../shared/db/prisma';
import { badRequest, conflict, notFound } from '../../shared/errors/AppError';
import { clinicToday, dateOnly } from '../../shared/lib/dates';
import { paginated, toSkipTake } from '../../shared/lib/pagination';
import { getActiveServicesForDepartment } from '../services';
import { cancelAppointment as cancelInQueue } from './appointments.queue';
import type { CreateTreatmentBody, ListAppointmentsQuery, ServiceLine } from './appointments.schema';

const departmentSummary = { select: { id: true, name: true, code: true, color: true } } as const;

const listInclude = {
  patient: { select: { id: true, patientCode: true, name: true, phone: true } },
  department: departmentSummary,
  practitioner: { select: { id: true, name: true, title: true } },
  services: { include: { service: { select: { id: true, name: true } } } },
  invoices: {
    where: { status: { not: 'VOID' as const } },
    select: { id: true, invoiceNo: true, status: true, total: true, paidAmount: true },
  },
} satisfies Prisma.AppointmentInclude;

const detailInclude = {
  ...listInclude,
  patient: {
    select: { id: true, patientCode: true, name: true, phone: true, gender: true, dateOfBirth: true, ageYears: true },
  },
  invoices: {
    orderBy: { createdAt: 'desc' as const },
    select: { id: true, invoiceNo: true, status: true, total: true, paidAmount: true, createdAt: true },
  },
  treatments: { orderBy: { createdAt: 'asc' as const }, include: { service: { select: { id: true, name: true } } } },
  prescription: { select: { id: true, rxNo: true, createdAt: true, _count: { select: { images: true } } } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.AppointmentInclude;

/** Sum of the service lines chosen for a visit, in poisha. */
export function servicesTotal(services: Array<{ price: number; quantity: number }>): number {
  return services.reduce((sum, s) => sum + s.price * s.quantity, 0);
}

function withTotal<T extends { services: Array<{ price: number; quantity: number }> }>(appt: T) {
  return { ...appt, servicesTotal: servicesTotal(appt.services) };
}

export async function listAppointments(query: ListAppointmentsQuery) {
  if (query.date && (query.from || query.to)) throw badRequest('Use either date or from/to, not both');

  const visitDate: Prisma.DateTimeFilter | Date | undefined = query.date
    ? dateOnly(query.date)
    : query.from || query.to
      ? { ...(query.from ? { gte: dateOnly(query.from) } : {}), ...(query.to ? { lte: dateOnly(query.to) } : {}) }
      : undefined;

  const where: Prisma.AppointmentWhereInput = {
    visitDate,
    departmentId: query.departmentId,
    practitionerId: query.practitionerId,
    patientId: query.patientId,
    ...(query.status ? { status: { in: query.status } } : {}),
    ...(query.unbilled ? { status: 'COMPLETED', invoices: { none: { status: { not: 'VOID' } } } } : {}),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.appointment.findMany({
      where,
      include: listInclude,
      orderBy: [{ visitDate: 'desc' }, { practitionerId: 'asc' }, { serialNo: 'asc' }],
      ...toSkipTake(query),
    }),
    prisma.appointment.count({ where }),
  ]);

  return paginated(rows.map(withTotal), total, query);
}

export async function getAppointment(id: string) {
  const appt = await prisma.appointment.findUnique({ where: { id }, include: detailInclude });
  if (!appt) throw notFound('Appointment');
  return withTotal(appt);
}

export async function cancelAppointment(id: string, reason: string) {
  await prisma.$transaction((tx) => cancelInQueue(tx, id, reason), LOCKING_TX_OPTIONS);
  return getAppointment(id);
}

/**
 * Replaces the services on a visit (e.g. the doctor added an X-ray). Allowed
 * until the visit is invoiced. Services already on the visit keep the price
 * they were booked at; newly added ones use today's price.
 */
export async function replaceServices(id: string, lines: ServiceLine[]) {
  await prisma.$transaction(async (tx) => {
    const appt = await lockAppointmentForBilling(tx, id);
    if (appt.status === 'CANCELLED' || appt.status === 'NO_SHOW') {
      throw conflict('Services cannot be changed on a cancelled or no-show visit');
    }
    if (appt.invoices.length > 0) {
      throw conflict('This visit already has an invoice. Void the invoice first to change services.');
    }

    const services = await getActiveServicesForDepartment(
      tx,
      lines.map((l) => l.serviceId),
      appt.departmentId,
    );
    const bookedPrice = new Map(appt.services.map((s) => [s.serviceId, s.price]));
    const currentPrice = new Map(services.map((s) => [s.id, s.price]));

    await tx.appointmentService.deleteMany({ where: { appointmentId: id } });
    await tx.appointmentService.createMany({
      data: lines.map((l) => ({
        appointmentId: id,
        serviceId: l.serviceId,
        quantity: l.quantity,
        price: bookedPrice.get(l.serviceId) ?? currentPrice.get(l.serviceId)!,
      })),
    });
  });
  return getAppointment(id);
}

/**
 * Locks one visit (SELECT ... FOR UPDATE) and returns it with its services and
 * any non-void invoice. Billing uses this so a visit can never get two live
 * invoices, and services cannot change while an invoice is being created.
 */
export async function lockAppointmentForBilling(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Appointment" WHERE id = ${id} FOR UPDATE`;
  if (rows.length === 0) throw notFound('Appointment');
  return tx.appointment.findUniqueOrThrow({
    where: { id },
    include: {
      services: { include: { service: { select: { id: true, name: true, departmentId: true } } } },
      invoices: { where: { status: { not: 'VOID' } }, select: { id: true, invoiceNo: true } },
      department: { select: { id: true, name: true } },
      practitioner: { select: { id: true, name: true } },
    },
  });
}

export async function addTreatment(id: string, body: CreateTreatmentBody) {
  const appt = await prisma.appointment.findUnique({ where: { id } });
  if (!appt) throw notFound('Appointment');
  if (appt.status === 'CANCELLED') throw conflict('Cannot add treatment to a cancelled visit');
  if (body.serviceId) await getActiveServicesForDepartment(prisma, [body.serviceId], appt.departmentId);

  return prisma.treatmentRecord.create({
    data: { appointmentId: id, ...body },
    include: { service: { select: { id: true, name: true } } },
  });
}

/**
 * Closes queues left open on earlier days: a patient still IN_ROOM was seen
 * (COMPLETED); a patient still WAITING left without being seen (NO_SHOW).
 */
export async function closePastQueues() {
  const today = clinicToday();
  const [completed, noShow] = await prisma.$transaction([
    prisma.appointment.updateMany({
      where: { visitDate: { lt: today }, status: 'IN_ROOM' },
      data: { status: 'COMPLETED' },
    }),
    prisma.appointment.updateMany({
      where: { visitDate: { lt: today }, status: 'WAITING' },
      data: { status: 'NO_SHOW' },
    }),
  ]);
  if (completed.count === 0 && noShow.count === 0) return undefined;
  return { closedAsCompleted: completed.count, closedAsNoShow: noShow.count };
}
