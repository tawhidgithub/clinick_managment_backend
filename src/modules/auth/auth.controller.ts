import type { CookieOptions, Request, Response } from 'express';
import { env } from '../../config/env';
import { currentUser } from '../../shared/middleware/authenticate';
import { changePasswordBody, loginBody } from './auth.schema';
import * as authService from './auth.service';

export const REFRESH_COOKIE = 'chowa_rt';

const cookieBase: CookieOptions = {
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: env.COOKIE_SAMESITE,
  path: '/api/auth',
};

function clientMeta(req: Request): authService.ClientMeta {
  return { userAgent: req.get('user-agent'), ip: req.ip };
}

function sendSession(
  res: Response,
  result: { user: unknown; accessToken: string; refreshToken: string; refreshExpiresAt: Date },
) {
  res.cookie(REFRESH_COOKIE, result.refreshToken, { ...cookieBase, expires: result.refreshExpiresAt });
  res.json({ user: result.user, accessToken: result.accessToken });
}

export async function login(req: Request, res: Response) {
  const body = loginBody.parse(req.body);
  sendSession(res, await authService.login(body, clientMeta(req)));
}

export async function refresh(req: Request, res: Response) {
  try {
    sendSession(res, await authService.refresh(req.cookies?.[REFRESH_COOKIE], clientMeta(req)));
  } catch (err) {
    res.clearCookie(REFRESH_COOKIE, cookieBase);
    throw err;
  }
}

export async function logout(req: Request, res: Response) {
  await authService.logout(req.cookies?.[REFRESH_COOKIE]);
  res.clearCookie(REFRESH_COOKIE, cookieBase);
  res.status(204).end();
}

export async function me(req: Request, res: Response) {
  res.json({ user: await authService.getMe(currentUser(req).id) });
}

export async function changePassword(req: Request, res: Response) {
  const body = changePasswordBody.parse(req.body);
  await authService.changePassword(currentUser(req).id, body);
  res.status(204).end();
}
