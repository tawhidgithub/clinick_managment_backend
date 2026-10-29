import { prisma, type Db } from '../../shared/db/prisma';
import { badRequest, notFound } from '../../shared/errors/AppError';
import type { CreateDepartmentBody, UpdateDepartmentBody } from './departments.schema';

export async function listDepartments(includeInactive = false) {
  return prisma.department.findMany({
    where: includeInactive ? undefined : { isActive: true },
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { practitioners: { where: { isActive: true } }, services: { where: { isActive: true } } } },
    },
  });
}

export async function getDepartment(id: string) {
  const department = await prisma.department.findUnique({ where: { id } });
  if (!department) throw notFound('Department');
  return department;
}

export function createDepartment(data: CreateDepartmentBody) {
  return prisma.department.create({ data });
}

export async function updateDepartment(id: string, data: UpdateDepartmentBody) {
  await getDepartment(id);
  return prisma.department.update({ where: { id }, data });
}

/** Throws unless the department exists and is active. */
export async function assertActiveDepartment(db: Db, id: string) {
  const department = await db.department.findUnique({ where: { id } });
  if (!department) throw notFound('Department');
  if (!department.isActive) throw badRequest(`${department.name} department is inactive`);
  return department;
}
