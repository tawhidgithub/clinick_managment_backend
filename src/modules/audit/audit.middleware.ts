import type { Prisma } from '@prisma/client';
import type { Request, RequestHandler, Response } from 'express';
import { prisma } from '../../shared/db/prisma';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Requests that change nothing worth auditing (sessions are kept in the Session table).
const NOT_AUDITED = new Set(['POST /auth/login', 'POST /auth/refresh', 'POST /auth/logout', 'POST /invoices/preview']);
const SECRET_KEY = /password|token|secret/i;
const MAX_DATA_CHARS = 8000;

/** Copies a request body without passwords or tokens. */
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? '[removed]' : redact(v)]),
    );
  }
  return value;
}

function auditData(req: Request): Prisma.InputJsonValue | undefined {
  const files = Array.isArray(req.files) ? req.files.length : undefined;
  const body = req.body && typeof req.body === 'object' && Object.keys(req.body).length ? redact(req.body) : undefined;
  if (body === undefined && files === undefined) return undefined;
  const data = { ...(body as object | undefined), ...(files !== undefined ? { uploadedFiles: files } : {}) };
  const text = JSON.stringify(data);
  return text.length > MAX_DATA_CHARS ? { truncated: true, preview: text.slice(0, MAX_DATA_CHARS) } : data;
}

/** The id a create endpoint returned, for requests whose URL has no id. */
function idFromResponse(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as { id?: unknown; appointment?: { id?: unknown }; appointmentId?: unknown };
  const id = b.id ?? b.appointment?.id ?? b.appointmentId;
  return typeof id === 'string' ? id : undefined;
}

/**
 * Records every successful write request (who, what, when, on which record)
 * in AuditLog. The route is read while the handler responds, because Express
 * has the matched route only then. Writing the log never fails the request.
 */
export const auditTrail: RequestHandler = (req, res, next) => {
  if (!WRITE_METHODS.has(req.method)) return next();

  let route: { action: string; entityType: string; entityId?: string } | undefined;
  let responseId: string | undefined;

  const capture = () => {
    if (route || !req.route) return;
    // "/api/visits" + "/" -> "/visits"
    const path = `${req.baseUrl}${req.route.path as string}`.replace(/^\/api/, '').replace(/(.)\/$/, '$1');
    const p = req.params as Record<string, string | undefined>;
    route = {
      action: `${req.method} ${path}`,
      entityType: path.split('/')[1] ?? path,
      entityId: p.id ?? p.appointmentId ?? p.practitionerId,
    };
  };

  const json = res.json.bind(res);
  res.json = (body: unknown) => {
    responseId = idFromResponse(body);
    capture();
    return json(body);
  };
  const end = res.end.bind(res) as (...args: unknown[]) => Response;
  res.end = ((...args: unknown[]) => {
    capture();
    return end(...args);
  }) as Response['end'];

  res.on('finish', () => {
    if (!route || res.statusCode >= 400 || NOT_AUDITED.has(route.action)) return;
    prisma.auditLog
      .create({
        data: {
          action: route.action,
          entityType: route.entityType,
          entityId: route.entityId ?? responseId ?? null,
          actorId: req.user?.id ?? null,
          status: res.statusCode,
          data: auditData(req),
          ip: req.ip ?? null,
        },
      })
      .catch((err: unknown) => console.error(`[audit] could not record ${route!.action}`, err));
  });

  next();
};
