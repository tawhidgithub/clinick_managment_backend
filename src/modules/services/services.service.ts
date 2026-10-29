import { prisma, type Db } from '../../shared/db/prisma';
import { badRequest, notFound } from '../../shared/errors/AppError';
import { assertActiveDepartment } from '../departments';
import type { CreateServiceBody, ListServicesQuery, UpdateServiceBody } from './services.schema';

const departmentSummary = { select: { id: true, name: true, code: true, color: true } } as const;

export function listServices({ departmentId, q, includeInactive }: ListServicesQuery) {
  return prisma.service.findMany({
    where: {
      departmentId,
      ...(includeInactive ? {} : { isActive: true }),
      ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
    },
    orderBy: [{ department: { name: 'asc' } }, { name: 'asc' }],
    include: { department: departmentSummary },
  });
}

export async function getService(id: string) {
  const service = await prisma.service.findUnique({ where: { id }, include: { department: departmentSummary } });
  if (!service) throw notFound('Service');
  return service;
}

export async function createService(data: CreateServiceBody) {
  await assertActiveDepartment(prisma, data.departmentId);
  return prisma.service.create({ data, include: { department: departmentSummary } });
}

export async function updateService(id: string, data: UpdateServiceBody) {
  await getService(id);
  return prisma.service.update({ where: { id }, data, include: { department: departmentSummary } });
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** Loads active services by id from any department (custom invoices). */
export async function getActiveServices(db: Db, serviceIds: string[]) {
  const unique = [...new Set(serviceIds)];
  const services = await db.service.findMany({ where: { id: { in: unique } } });
  if (services.length !== unique.length) throw badRequest('One or more services were not found');
  const inactive = services.find((s) => !s.isActive);
  if (inactive) throw badRequest(`${inactive.name} is no longer offered`);
  return services;
}

/**
 * Loads active services by id and checks they all belong to one department.
 * Used when booking a visit and when building an invoice.
 */
export async function getActiveServicesForDepartment(db: Db, serviceIds: string[], departmentId: string) {
  const unique = [...new Set(serviceIds)];
  const services = await db.service.findMany({ where: { id: { in: unique } } });

  if (services.length !== unique.length) throw badRequest('One or more services were not found');
  const inactive = services.find((s) => !s.isActive);
  if (inactive) throw badRequest(`${inactive.name} is no longer offered`);
  const wrongDept = services.find((s) => s.departmentId !== departmentId);
  if (wrongDept) throw badRequest(`${wrongDept.name} does not belong to the selected department`);

  return services;
}
