import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { User } from '@prisma/client';
import { env } from '../../config/env';
import { prisma, type Db } from '../../shared/db/prisma';
import { badRequest, unauthorized } from '../../shared/errors/AppError';
import { signAccessToken } from '../../shared/middleware/authenticate';
import type { ChangePasswordBody, LoginBody } from './auth.schema';

const BCRYPT_ROUNDS = 12;
// A refresh token rotated less than this long ago is treated as a harmless
// race (two tabs refreshing together), not as token theft.
const ROTATION_GRACE_MS = 60_000;
// Compared against when the username does not exist, so a wrong username
// takes as long as a wrong password.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_ROUNDS);

export interface ClientMeta {
  userAgent?: string;
  ip?: string;
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function toPublicUser(user: User & { practitioner?: { id: string } | null }) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    practitionerId: user.practitioner?.id ?? null,
  };
}

async function createSession(db: Db, user: User, meta: ClientMeta): Promise<SessionTokens> {
  const refreshToken = randomBytes(48).toString('base64url');
  const refreshExpiresAt = new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);

  await db.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      userAgent: meta.userAgent?.slice(0, 255),
      ip: meta.ip,
      expiresAt: refreshExpiresAt,
    },
  });

  return { accessToken: signAccessToken(user), refreshToken, refreshExpiresAt };
}

export async function login({ username, password }: LoginBody, meta: ClientMeta) {
  const user = await prisma.user.findUnique({
    where: { username },
    include: { practitioner: { select: { id: true } } },
  });

  const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !passwordOk) throw unauthorized('Wrong username or password');
  if (!user.isActive) throw unauthorized('This account has been deactivated');

  const tokens = await createSession(prisma, user, meta);
  return { user: toPublicUser(user), ...tokens };
}

/** Exchanges a refresh token for a new access token and a new refresh token. */
export async function refresh(refreshToken: string | undefined, meta: ClientMeta) {
  if (!refreshToken) throw unauthorized('Not signed in');

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(refreshToken) },
    include: { user: { include: { practitioner: { select: { id: true } } } } },
  });
  if (!session) throw unauthorized('Not signed in');

  if (session.revokedAt) {
    // An old token came back long after it was rotated: it may have been
    // stolen, so sign this user out everywhere.
    if (Date.now() - session.revokedAt.getTime() > ROTATION_GRACE_MS) {
      await revokeAllSessions(session.userId);
    }
    throw unauthorized('Session ended, please sign in again');
  }
  if (session.expiresAt < new Date() || !session.user.isActive) {
    throw unauthorized('Session ended, please sign in again');
  }

  const tokens = await prisma.$transaction(async (tx) => {
    // Conditional update: only one concurrent refresh can rotate this session.
    const rotated = await tx.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date(), lastUsedAt: new Date() },
    });
    if (rotated.count === 0) throw unauthorized('Session ended, please sign in again');
    return createSession(tx, session.user, meta);
  });

  return { user: toPublicUser(session.user), ...tokens };
}

export async function logout(refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) return;
  await prisma.session.updateMany({
    where: { tokenHash: hashToken(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Signs a user out of every device (used when staff are deactivated). */
export async function revokeAllSessions(userId: string, db: Db = prisma): Promise<void> {
  await db.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { practitioner: { select: { id: true } } },
  });
  if (!user || !user.isActive) throw unauthorized('Not signed in');
  return toPublicUser(user);
}

export async function changePassword(userId: string, body: ChangePasswordBody): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw unauthorized('Not signed in');

  const ok = await bcrypt.compare(body.currentPassword, user.passwordHash);
  if (!ok) throw badRequest('Current password is wrong');

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(body.newPassword) },
  });
}
