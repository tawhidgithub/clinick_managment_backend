import { prisma } from '../../../shared/db/prisma';
import { notFound } from '../../../shared/errors/AppError';
import { assertActiveDepartment } from '../../departments';
import type { CreatePlanBody, UpdatePlanBody } from './plans.schema';

const departmentSummary = { select: { id: true, name: true, code: true, color: true } } as const;

export function listPlans(includeInactive = false) {
  return prisma.membershipPlan.findMany({
    where: includeInactive ? undefined : { isActive: true },
    orderBy: { price: 'asc' },
    include: {
      department: departmentSummary,
      _count: { select: { memberships: { where: { status: 'ACTIVE' } } } },
    },
  });
}

export async function getPlan(id: string) {
  const plan = await prisma.membershipPlan.findUnique({ where: { id }, include: { department: departmentSummary } });
  if (!plan) throw notFound('Membership plan');
  return plan;
}

export async function createPlan(data: CreatePlanBody) {
  if (data.departmentId) await assertActiveDepartment(prisma, data.departmentId);
  return prisma.membershipPlan.create({ data, include: { department: departmentSummary } });
}

/**
 * Price, duration and discount changes apply to memberships issued from now
 * on; existing memberships keep the end date they were issued with.
 */
export async function updatePlan(id: string, data: UpdatePlanBody) {
  await getPlan(id);
  if (data.departmentId) await assertActiveDepartment(prisma, data.departmentId);
  return prisma.membershipPlan.update({ where: { id }, data, include: { department: departmentSummary } });
}
