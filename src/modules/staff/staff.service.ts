import { prisma } from '../../shared/db/prisma';
import { badRequest, conflict, notFound } from '../../shared/errors/AppError';
import { hashPassword, revokeAllSessions } from '../auth';
import { clearUserPractitionerLink, setPractitionerUser } from '../practitioners';
import type { CreateStaffBody, UpdateStaffBody } from './staff.schema';

// Never return passwordHash.
const staffSelect = {
  id: true,
  name: true,
  username: true,
  role: true,
  isActive: true,
  createdAt: true,
  practitioner: { select: { id: true, name: true, department: { select: { name: true } } } },
} as const;

export function listStaff() {
  return prisma.user.findMany({ select: staffSelect, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
}

export async function getStaff(id: string) {
  const user = await prisma.user.findUnique({ where: { id }, select: staffSelect });
  if (!user) throw notFound('Staff member');
  return user;
}

export async function createStaff({ password, practitionerId, ...data }: CreateStaffBody) {
  const passwordHash = await hashPassword(password);
  const id = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { ...data, passwordHash } });
    if (practitionerId) await setPractitionerUser(tx, practitionerId, user.id);
    return user.id;
  });
  return getStaff(id);
}

export async function updateStaff(id: string, actorId: string, { practitionerId, ...data }: UpdateStaffBody) {
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) throw notFound('Staff member');

  const losesAdmin =
    existing.role === 'ADMIN' &&
    existing.isActive &&
    ((data.role !== undefined && data.role !== 'ADMIN') || data.isActive === false);

  if (losesAdmin && id === actorId) {
    throw badRequest('You cannot remove your own admin access or deactivate yourself');
  }
  if (losesAdmin) {
    const otherAdmins = await prisma.user.count({
      where: { role: 'ADMIN', isActive: true, id: { not: id } },
    });
    if (otherAdmins === 0) throw conflict('At least one active admin is required');
  }

  const roleChanged = data.role !== undefined && data.role !== existing.role;
  const deactivated = data.isActive === false && existing.isActive;

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data });
    if (practitionerId === null) await clearUserPractitionerLink(tx, id);
    else if (practitionerId) await setPractitionerUser(tx, practitionerId, id);
    // Force a fresh sign-in so the new role / status takes effect everywhere.
    if (roleChanged || deactivated) await revokeAllSessions(id, tx);
  });

  return getStaff(id);
}

export async function resetPassword(id: string, newPassword: string) {
  await getStaff(id);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { passwordHash: await hashPassword(newPassword) } });
    await revokeAllSessions(id, tx);
  });
}
