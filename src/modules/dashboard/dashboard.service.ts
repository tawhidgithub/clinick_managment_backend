import type { Prisma, Role } from '@prisma/client';
import { prisma } from '../../shared/db/prisma';
import { clinicDayRange, clinicToday, toDateString } from '../../shared/lib/dates';
import { EXPIRING_WITHIN_DAYS, listMemberships } from '../memberships';
import { getQueueBoard } from '../queue';
import type { DashboardQuery } from './dashboard.schema';

const LIST_LIMIT = 10;

const visitSelect = {
  id: true,
  serialNo: true,
  status: true,
  createdAt: true,
  calledAt: true,
  completedAt: true,
  patient: { select: { id: true, patientCode: true, name: true, phone: true } },
  practitioner: { select: { id: true, name: true } },
  department: { select: { id: true, name: true, code: true, color: true } },
  invoices: {
    where: { status: { not: 'VOID' } },
    select: { id: true, invoiceNo: true, status: true, total: true, paidAmount: true },
  },
} satisfies Prisma.AppointmentSelect;

type VisitRow = Prisma.AppointmentGetPayload<{ select: typeof visitSelect }>;

function presentVisit({ invoices, ...visit }: VisitRow) {
  const invoice = invoices[0] ?? null;
  return { ...visit, invoice: invoice && { ...invoice, due: invoice.total - invoice.paidAmount } };
}

/**
 * Everything the dashboard shows in one call: the "Now serving" queue, today's
 * counts, today's visits, and (for Admin / Front Desk) money due and
 * memberships running out. Practitioners get the same page without money.
 *
 * The queue strip should refresh from GET /api/queue every few seconds; this
 * endpoint is heavier and is meant for a slower refresh (30-60 s).
 */
export async function getDashboard({ departmentId }: DashboardQuery, role: Role) {
  const today = clinicToday();
  const day = toDateString(today);
  const todayRange = clinicDayRange(day, day)!;
  const showMoney = role !== 'PRACTITIONER';

  const visitWhere: Prisma.AppointmentWhereInput = { visitDate: today, departmentId };
  // With a department filter, money figures cover that department's visit invoices only.
  const invoiceScope: Prisma.InvoiceWhereInput = departmentId ? { appointment: { departmentId } } : {};

  const [queue, visits] = await Promise.all([
    getQueueBoard({ departmentId }),
    prisma.appointment.findMany({ where: visitWhere, select: visitSelect, orderBy: { createdAt: 'asc' } }),
  ]);

  const presented = visits.map(presentVisit);
  const counts = (status: VisitRow['status']) => visits.filter((v) => v.status === status).length;
  const unbilled = presented.filter((v) => v.status === 'COMPLETED' && !v.invoice);

  const stats = {
    visitsToday: visits.filter((v) => v.status !== 'CANCELLED').length,
    waitingNow: counts('WAITING'),
    inRoomNow: counts('IN_ROOM'),
    completedToday: counts('COMPLETED'),
    noShowToday: counts('NO_SHOW'),
    cancelledToday: counts('CANCELLED'),
  };

  const base = {
    date: day,
    generatedAt: new Date(),
    queue,
    stats,
    todayVisits: presented,
  };

  if (!showMoney) {
    return {
      ...base,
      todayVisits: presented.map((v) => ({ ...v, invoice: null })), // no billing for practitioners
      money: null,
      pendingPayments: null,
      unbilledVisits: null,
      expiringMemberships: null,
    };
  }

  const openInvoices: Prisma.InvoiceWhereInput = { ...invoiceScope, status: { in: ['DUE', 'PARTIAL'] } };

  const [collected, collectedByMethod, billedToday, outstanding, pendingRows, expiring] = await Promise.all([
    prisma.payment.aggregate({ where: { paidAt: todayRange, invoice: invoiceScope }, _sum: { amount: true } }),
    prisma.payment.groupBy({
      by: ['method'],
      where: { paidAt: todayRange, invoice: invoiceScope },
      _sum: { amount: true },
      orderBy: { method: 'asc' },
    }),
    prisma.invoice.aggregate({
      where: { ...invoiceScope, status: { not: 'VOID' }, createdAt: todayRange },
      _sum: { total: true },
      _count: true,
    }),
    prisma.invoice.aggregate({ where: openInvoices, _sum: { total: true, paidAmount: true }, _count: true }),
    prisma.invoice.findMany({
      where: openInvoices,
      orderBy: { createdAt: 'desc' },
      take: LIST_LIMIT,
      select: {
        id: true,
        invoiceNo: true,
        status: true,
        total: true,
        paidAmount: true,
        createdAt: true,
        patient: { select: { id: true, patientCode: true, name: true, phone: true } },
        appointment: { select: { id: true, department: { select: { id: true, name: true, color: true } } } },
        membership: { select: { id: true, cardNo: true } },
      },
    }),
    listMemberships({ tab: 'expiring', page: 1, pageSize: LIST_LIMIT }),
  ]);

  const totalDue = (outstanding._sum.total ?? 0) - (outstanding._sum.paidAmount ?? 0);

  return {
    ...base,
    money: {
      collectedToday: collected._sum.amount ?? 0, // net of refunds
      collectedByMethod: collectedByMethod.map((m) => ({ method: m.method, amount: m._sum.amount ?? 0 })),
      billedToday: billedToday._sum.total ?? 0,
      invoicesToday: billedToday._count,
      totalDue,
      openInvoices: outstanding._count,
    },
    pendingPayments: {
      total: outstanding._count,
      items: pendingRows.map((r) => ({ ...r, due: r.total - r.paidAmount })),
    },
    unbilledVisits: { total: unbilled.length, items: unbilled.slice(0, LIST_LIMIT) },
    expiringMemberships: { withinDays: EXPIRING_WITHIN_DAYS, total: expiring.total, items: expiring.items },
  };
}
