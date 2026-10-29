// Queue state machine. Every change to a doctor's queue first takes a row
// lock on that doctor (SELECT ... FOR UPDATE), so two desks clicking Next at
// the same moment, or a double-clicked Save, are applied one after another.
//
//   WAITING ──Next──▶ IN_ROOM ──Next──▶ COMPLETED
//      │  ▲              │
//      │  └─move to end──┤
//      ▼                 ▼
//   NO_SHOW ─requeue─▶ WAITING          CANCELLED (from BOOKED / WAITING)

import type { Appointment } from '@prisma/client';
import type { Tx } from '../../shared/db/prisma';
import { badRequest, conflict, notFound } from '../../shared/errors/AppError';
import { clinicToday, toDateString } from '../../shared/lib/dates';
import { nextQueuePosition, nextQueueSerial } from '../../shared/lib/numbering';

/** Serialises all queue changes for one doctor until the transaction ends. */
export async function lockPractitionerQueue(tx: Tx, practitionerId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Practitioner" WHERE id = ${practitionerId} FOR UPDATE`;
  if (rows.length === 0) throw notFound('Practitioner');
}

const isToday = (visitDate: Date) => visitDate.getTime() === clinicToday().getTime();

/** Loads an appointment, locks its doctor's queue, then re-reads it under the lock. */
async function loadLocked(tx: Tx, appointmentId: string): Promise<Appointment> {
  const first = await tx.appointment.findUnique({ where: { id: appointmentId } });
  if (!first) throw notFound('Appointment');
  await lockPractitionerQueue(tx, first.practitionerId);
  return (await tx.appointment.findUnique({ where: { id: appointmentId } }))!;
}

function assertTodaysQueue(appt: Appointment) {
  if (!isToday(appt.visitDate)) {
    throw badRequest(`This visit was on ${toDateString(appt.visitDate)}; only today's queue can be changed`);
  }
}

const label = (s: string) => s.replace('_', ' ').toLowerCase();

// ─── Create ─────────────────────────────────────────────────────────────────

export interface WalkInInput {
  patientId: string;
  departmentId: string;
  practitionerId: string;
  services: Array<{ serviceId: string; price: number; quantity: number }>;
  reason?: string;
  createdById: string;
}

/** Adds a walk-in to the end of today's queue with the next serial number. */
export async function createWalkInAppointment(tx: Tx, input: WalkInInput) {
  await lockPractitionerQueue(tx, input.practitionerId);
  const visitDate = clinicToday();
  const day = toDateString(visitDate);

  const existing = await tx.appointment.findFirst({
    where: {
      patientId: input.patientId,
      practitionerId: input.practitionerId,
      visitDate,
      status: { in: ['WAITING', 'IN_ROOM'] },
    },
  });
  if (existing) {
    throw conflict(`This patient is already in this doctor's queue (serial ${existing.serialNo})`, {
      appointmentId: existing.id,
      serialNo: existing.serialNo,
    });
  }

  const serialNo = await nextQueueSerial(tx, input.practitionerId, day);
  const queuePosition = await nextQueuePosition(tx, input.practitionerId, day);

  return tx.appointment.create({
    data: {
      patientId: input.patientId,
      departmentId: input.departmentId,
      practitionerId: input.practitionerId,
      status: 'WAITING',
      visitDate,
      serialNo,
      queuePosition,
      reason: input.reason,
      createdById: input.createdById,
      services: { create: input.services },
    },
    include: {
      services: { include: { service: { select: { id: true, name: true } } } },
      department: { select: { id: true, name: true, code: true, color: true } },
      practitioner: { select: { id: true, name: true, title: true } },
    },
  });
}

// ─── Transitions ────────────────────────────────────────────────────────────

/**
 * The patient in the room is done: mark them COMPLETED and call the next
 * waiting patient (lowest queue position) IN_ROOM.
 *
 * `expectedCurrentId` is the appointment the desk sees in the room (null if
 * the doctor looked free). If the queue changed since their screen refreshed,
 * the request is refused instead of skipping someone.
 * With `callNext = false` the current patient is completed and the doctor is left free.
 */
export async function callNext(
  tx: Tx,
  practitionerId: string,
  { expectedCurrentId, callNext = true }: { expectedCurrentId?: string | null; callNext?: boolean } = {},
) {
  await lockPractitionerQueue(tx, practitionerId);
  const visitDate = clinicToday();
  const now = new Date();

  const current = await tx.appointment.findFirst({
    where: { practitionerId, visitDate, status: 'IN_ROOM' },
  });

  if (expectedCurrentId !== undefined && (current?.id ?? null) !== expectedCurrentId) {
    throw conflict('The queue has changed since your screen last refreshed. Check it and try again.', {
      currentAppointmentId: current?.id ?? null,
    });
  }

  if (current) {
    await tx.appointment.update({
      where: { id: current.id },
      data: { status: 'COMPLETED', completedAt: now },
    });
  }

  let called: Appointment | null = null;
  if (callNext) {
    const next = await tx.appointment.findFirst({
      where: { practitionerId, visitDate, status: 'WAITING' },
      orderBy: { queuePosition: 'asc' },
    });
    if (next) {
      called = await tx.appointment.update({
        where: { id: next.id },
        data: { status: 'IN_ROOM', calledAt: now },
      });
    }
  }

  return { completedId: current?.id ?? null, calledId: called?.id ?? null, calledSerial: called?.serialNo ?? null };
}

/** Patient did not answer when called / left: NO_SHOW (from WAITING or IN_ROOM). */
export async function markNoShow(tx: Tx, appointmentId: string) {
  const appt = await loadLocked(tx, appointmentId);
  assertTodaysQueue(appt);
  if (appt.status !== 'WAITING' && appt.status !== 'IN_ROOM') {
    throw conflict(`Patient is already ${label(appt.status)}`);
  }
  return tx.appointment.update({ where: { id: appt.id }, data: { status: 'NO_SHOW' } });
}

/** Sends a patient to the back of the queue; their printed serial does not change. */
export async function moveToEnd(tx: Tx, appointmentId: string) {
  const appt = await loadLocked(tx, appointmentId);
  assertTodaysQueue(appt);
  if (appt.status !== 'WAITING' && appt.status !== 'IN_ROOM') {
    throw conflict(`Patient is already ${label(appt.status)}`);
  }
  const queuePosition = await nextQueuePosition(tx, appt.practitionerId, toDateString(appt.visitDate));
  return tx.appointment.update({
    where: { id: appt.id },
    data: { status: 'WAITING', queuePosition, calledAt: null },
  });
}

/** A no-show patient came back: put them at the end of today's queue. */
export async function requeue(tx: Tx, appointmentId: string) {
  const appt = await loadLocked(tx, appointmentId);
  assertTodaysQueue(appt);
  if (appt.status !== 'NO_SHOW') throw conflict('Only no-show patients can be put back in the queue');

  const active = await tx.appointment.findFirst({
    where: {
      patientId: appt.patientId,
      practitionerId: appt.practitionerId,
      visitDate: appt.visitDate,
      status: { in: ['WAITING', 'IN_ROOM'] },
    },
  });
  if (active) throw conflict(`This patient is already in the queue (serial ${active.serialNo})`);

  const queuePosition = await nextQueuePosition(tx, appt.practitionerId, toDateString(appt.visitDate));
  return tx.appointment.update({
    where: { id: appt.id },
    data: { status: 'WAITING', queuePosition, calledAt: null },
  });
}

/** Cancels a visit that has not started (BOOKED or WAITING). */
export async function cancelAppointment(tx: Tx, appointmentId: string, reason: string) {
  const appt = await loadLocked(tx, appointmentId);
  if (appt.status !== 'BOOKED' && appt.status !== 'WAITING') {
    throw conflict(`A visit that is ${label(appt.status)} cannot be cancelled`);
  }
  return tx.appointment.update({
    where: { id: appt.id },
    data: { status: 'CANCELLED', cancelReason: reason },
  });
}
