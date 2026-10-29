import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { env } from '../../config/env';
import { forbidden, unauthorized } from '../errors/AppError';

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: Role;
}

interface AccessTokenPayload {
  sub: string;
  username: string;
  name: string;
  role: Role;
}

export function signAccessToken(user: AuthUser): string {
  const payload: AccessTokenPayload = {
    sub: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
  };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'],
    algorithm: 'HS256',
  });
}

/** Requires a valid `Authorization: Bearer <access token>` header. */
export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw unauthorized();
  }

  try {
    const payload = jwt.verify(header.slice(7), env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
    }) as AccessTokenPayload;
    req.user = {
      id: payload.sub,
      username: payload.username,
      name: payload.name,
      role: payload.role,
    };
  } catch {
    throw unauthorized('Session expired, please sign in again');
  }
  next();
};

/** Must run after `authenticate`. */
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) throw forbidden();
    next();
  };

/** Narrows `req.user` for controllers that sit behind `authenticate`. */
export function currentUser(req: { user?: AuthUser }): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
