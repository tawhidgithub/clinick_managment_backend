import { prisma, type Db } from '../../shared/db/prisma';
import { badRequest, conflict, notFound } from '../../shared/errors/AppError';
import { assertActiveDepartment } from '../departments';
import type {
  CreatePractitionerBody,
  ListPractitionersQuery,
  ReplaceSchedulesBody,
  UpdatePractitionerBody,
} from './practitioners.schema';

const departmentSummary = { select: { id: true, name: true, code: true, color: true } } as const;
const scheduleOrder = [{ dayOfWeek: 'asc' as const }, { startTime: 'asc' as const }];

export function listPractitioners({ departmentId, includeInactive }: ListPractitionersQuery) {
  return prisma.practitioner.findMany({
    where: {
      departmentId,
      ...(includeInactive ? {} : { isActive: true }),
    },
    orderBy: [{ department: { name: 'asc' } }, { name: 'asc' }],
    include: {
      department: departmentSummary,
      user: { select: { id: true, username: true, isActive: true } },
    },
  });
}

export async function getPractitioner(id: string) {
  const practitioner = await prisma.practitioner.findUnique({
    where: { id },
    include: {
      department: departmentSummary,
      schedules: { orderBy: scheduleOrder },
      user: { select: { id: true, username: true, isActive: true } },
    },
  });
  if (!practitioner) throw notFound('Practitioner');
  return practitioner;
}

export async function createPractitioner(data: CreatePractitionerBody) {
  await assertActiveDepartment(prisma, data.departmentId);
  return prisma.practitioner.create({ data, include: { department: departmentSummary } });
}

export async function updatePractitioner(id: string, data: UpdatePractitionerBody) {
  await getPractitioner(id);
  if (data.departmentId) await assertActiveDepartment(prisma, data.departmentId);
  return prisma.practitioner.update({ where: { id }, data, include: { department: departmentSummary } });
}

export async function replaceSchedules(id: string, { schedules }: ReplaceSchedulesBody) {
  await getPractitioner(id);
  return prisma.$transaction(async (tx) => {
    await tx.practitionerSchedule.deleteMany({ where: { practitionerId: id } });
    await tx.practitionerSchedule.createMany({
      data: schedules.map((s) => ({ ...s, practitionerId: id })),
    });
    return tx.practitionerSchedule.findMany({ where: { practitionerId: id }, orderBy: scheduleOrder });
  });
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** Throws unless the practitioner exists and is active. */
export async function assertActivePractitioner(db: Db, id: string) {
  const practitioner = await db.practitioner.findUnique({ where: { id } });
  if (!practitioner) throw notFound('Practitioner');
  if (!practitioner.isActive) throw badRequest(`${practitioner.name} is not active`);
  return practitioner;
}

/**
 * Links a staff login to a practitioner record, or unlinks it (userId = null).
 * Called by the staff module when an admin creates or edits a login.
 */
export async function setPractitionerUser(db: Db, practitionerId: string, userId: string | null) {
  const practitioner = await db.practitioner.findUnique({ where: { id: practitionerId } });
  if (!practitioner) throw notFound('Practitioner');
  if (userId && practitioner.userId && practitioner.userId !== userId) {
    throw conflict(`${practitioner.name} already has a login`);
  }
  // Unlink any practitioner this user was previously attached to.
  if (userId) {
    await db.practitioner.updateMany({
      where: { userId, id: { not: practitionerId } },
      data: { userId: null },
    });
  }
  return db.practitioner.update({ where: { id: practitionerId }, data: { userId } });
}

/** Removes the practitioner link from a user, if any. */
export async function clearUserPractitionerLink(db: Db, userId: string) {
  await db.practitioner.updateMany({ where: { userId }, data: { userId: null } });
}
