import type { Db } from '../db/prisma';
import { clinicDateString, clinicYear } from './dates';

/**
 * Atomically increments and returns the next value of a named sequence.
 * Prisma runs this as a native INSERT ... ON CONFLICT DO UPDATE, so two
 * staff saving at the same moment never receive the same number.
 * Call it inside the same transaction that uses the number.
 */
export async function nextSequence(db: Db, key: string): Promise<number> {
  const counter = await db.counter.upsert({
    where: { key },
    create: { key, value: 1 },
    update: { value: { increment: 1 } },
  });
  return counter.value;
}

const pad = (n: number, width: number) => String(n).padStart(width, '0');

/** CPD-000123 */
export async function nextPatientCode(db: Db): Promise<string> {
  return `CPD-${pad(await nextSequence(db, 'patient'), 6)}`;
}

/** INV-2026-000123 (restarts each year) */
export async function nextInvoiceNo(db: Db): Promise<string> {
  const year = clinicYear();
  return `INV-${year}-${pad(await nextSequence(db, `invoice:${year}`), 6)}`;
}

/** RX-2026-000123 (restarts each year) */
export async function nextPrescriptionNo(db: Db): Promise<string> {
  const year = clinicYear();
  return `RX-${year}-${pad(await nextSequence(db, `rx:${year}`), 6)}`;
}

/** CPD-M-00045 */
export async function nextMembershipCardNo(db: Db): Promise<string> {
  return `CPD-M-${pad(await nextSequence(db, 'card'), 5)}`;
}

export const queueSerialKey = (practitionerId: string, day: string) => `serial:${practitionerId}:${day}`;
const queuePositionKey = (practitionerId: string, day: string) => `queuepos:${practitionerId}:${day}`;

/** Daily queue serial for one doctor; restarts at 1 every clinic day. Printed on the slip. */
export async function nextQueueSerial(
  db: Db,
  practitionerId: string,
  day: string = clinicDateString(),
): Promise<number> {
  return nextSequence(db, queueSerialKey(practitionerId, day));
}

/**
 * Sort order in a doctor's daily queue. New walk-ins and "move to end" both
 * take the next value, so a moved patient really goes behind everyone.
 */
export async function nextQueuePosition(
  db: Db,
  practitionerId: string,
  day: string = clinicDateString(),
): Promise<number> {
  return nextSequence(db, queuePositionKey(practitionerId, day));
}

/** Current values of several sequences without incrementing them (missing = 0). */
export async function peekSequences(db: Db, keys: string[]): Promise<Map<string, number>> {
  const rows = await db.counter.findMany({ where: { key: { in: keys } } });
  const values = new Map(keys.map((k) => [k, 0]));
  for (const row of rows) values.set(row.key, row.value);
  return values;
}
