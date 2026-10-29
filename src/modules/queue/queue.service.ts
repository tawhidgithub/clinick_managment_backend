import type { Prisma } from '@prisma/client';
import { LOCKING_TX_OPTIONS, prisma } from '../../shared/db/prisma';
import { notFound } from '../../shared/errors/AppError';
import { clinicToday, dateOnly, toDateString } from '../../shared/lib/dates';
import { peekSequences, queueSerialKey } from '../../shared/lib/numbering';
import { callNext, markNoShow, moveToEnd, requeue } from '../appointments';
import type { BoardQuery } from './queue.schema';

const queueItemSelect = {
  id: true,
  practitionerId: true,
  serialNo: true,
  queuePosition: true,
  status: true,
  calledAt: true,
  completedAt: true,
  createdAt: true,
  patient: { select: { id: true, patientCode: true, name: true, phone: true } },
  services: { select: { quantity: true, service: { select: { name: true } } } },
} satisfies Prisma.AppointmentSelect;

type QueueRow = Prisma.AppointmentGetPayload<{ select: typeof queueItemSelect }>;

function toItem(row: QueueRow) {
  const { practitionerId: _p, services, ...rest } = row;
  return { ...rest, services: services.map((s) => (s.quantity > 1 ? `${s.service.name} x${s.quantity}` : s.service.name)) };
}

/**
 * Every doctor's queue for one day: who is in the room, who is waiting (in
 * order), and counts. The dashboard "Now serving" strip polls this.
 */
export async function getQueueBoard({ date, departmentId }: BoardQuery, onlyPractitionerId?: string) {
  const visitDate = date ? dateOnly(date) : clinicToday();
  const day = toDateString(visitDate);
  const weekday = visitDate.getUTCDay(); // visitDate is the clinic day at UTC midnight

  const rows = await prisma.appointment.findMany({
    where: {
      visitDate,
      departmentId,
      practitionerId: onlyPractitionerId,
      status: { in: ['WAITING', 'IN_ROOM', 'COMPLETED', 'NO_SHOW'] },
    },
    select: queueItemSelect,
    orderBy: { queuePosition: 'asc' },
  });

  const idsWithVisits = [...new Set(rows.map((r) => r.practitionerId))];
  const practitioners = await prisma.practitioner.findMany({
    where: {
      departmentId,
      ...(onlyPractitionerId ? { id: onlyPractitionerId } : { OR: [{ isActive: true }, { id: { in: idsWithVisits } }] }),
    },
    include: {
      department: { select: { id: true, name: true, code: true, color: true } },
      schedules: { where: { dayOfWeek: weekday }, orderBy: { startTime: 'asc' }, select: { startTime: true, endTime: true } },
    },
    orderBy: [{ department: { name: 'asc' } }, { name: 'asc' }],
  });
  if (onlyPractitionerId && practitioners.length === 0) throw notFound('Practitioner');

  const serials = await peekSequences(prisma, practitioners.map((p) => queueSerialKey(p.id, day)));

  const doctors = practitioners.map((p) => {
    const mine = rows.filter((r) => r.practitionerId === p.id);
    const current = mine.find((r) => r.status === 'IN_ROOM');
    const waiting = mine.filter((r) => r.status === 'WAITING');
    const noShows = mine.filter((r) => r.status === 'NO_SHOW');
    return {
      practitioner: { id: p.id, name: p.name, title: p.title, isActive: p.isActive },
      department: p.department,
      schedule: p.schedules,
      scheduledToday: p.schedules.length > 0,
      status: current ? ('IN_ROOM' as const) : ('FREE' as const),
      current: current ? toItem(current) : null,
      waiting: waiting.map(toItem),
      noShows: noShows.map(toItem),
      waitingCount: waiting.length,
      completedCount: mine.filter((r) => r.status === 'COMPLETED').length,
      noShowCount: noShows.length,
      // Shown on the New Visit preview; the real number is assigned on save.
      nextSerial: (serials.get(queueSerialKey(p.id, day)) ?? 0) + 1,
    };
  });

  return {
    date: day,
    isToday: day === toDateString(clinicToday()),
    totals: {
      waiting: rows.filter((r) => r.status === 'WAITING').length,
      inRoom: rows.filter((r) => r.status === 'IN_ROOM').length,
      completed: rows.filter((r) => r.status === 'COMPLETED').length,
      noShow: rows.filter((r) => r.status === 'NO_SHOW').length,
    },
    doctors,
  };
}

async function doctorBoard(practitionerId: string) {
  const board = await getQueueBoard({}, practitionerId);
  return board.doctors[0]!;
}

export async function next(
  practitionerId: string,
  options: { expectedCurrentId?: string | null; callNext: boolean },
) {
  const result = await prisma.$transaction((tx) => callNext(tx, practitionerId, options), LOCKING_TX_OPTIONS);
  return { ...result, queue: await doctorBoard(practitionerId) };
}

export async function skip(appointmentId: string, action: 'NO_SHOW' | 'MOVE_TO_END') {
  const appt = await prisma.$transaction(
    (tx) => (action === 'NO_SHOW' ? markNoShow(tx, appointmentId) : moveToEnd(tx, appointmentId)),
    LOCKING_TX_OPTIONS,
  );
  return { appointmentId, status: appt.status, queue: await doctorBoard(appt.practitionerId) };
}

export async function putBack(appointmentId: string) {
  const appt = await prisma.$transaction((tx) => requeue(tx, appointmentId), LOCKING_TX_OPTIONS);
  return { appointmentId, status: appt.status, queue: await doctorBoard(appt.practitionerId) };
}
