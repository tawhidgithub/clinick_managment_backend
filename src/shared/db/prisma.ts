import { Prisma, PrismaClient } from '@prisma/client';
import { isProduction } from '../../config/env';

// Query errors are not logged here: expected ones (duplicates, missing rows)
// become 4xx responses, and unexpected ones are logged by the error handler.
export const prisma = new PrismaClient({
  log: isProduction ? [] : ['warn'],
});

/** A Prisma client or an interactive-transaction client. */
export type Db = PrismaClient | Prisma.TransactionClient;

/** An interactive-transaction client (needed for row locks). */
export type Tx = Prisma.TransactionClient;

/** Interactive-transaction options for operations that may wait on a row lock. */
export const LOCKING_TX_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;
