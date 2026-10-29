import type { Prisma } from '@prisma/client';
import { prisma } from '../../shared/db/prisma';
import { clinicDayRange } from '../../shared/lib/dates';
import { paginated, toSkipTake } from '../../shared/lib/pagination';
import type { ListAuditQuery } from './audit.schema';

export async function listAuditLog(query: ListAuditQuery) {
  const where: Prisma.AuditLogWhereInput = {
    entityType: query.entityType,
    entityId: query.entityId,
    actorId: query.actorId,
    ...(query.action ? { action: { contains: query.action, mode: 'insensitive' } } : {}),
    ...(query.from || query.to ? { createdAt: clinicDayRange(query.from, query.to) } : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...toSkipTake(query),
      include: { actor: { select: { id: true, name: true, username: true, role: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);
  return paginated(rows, total, query);
}
