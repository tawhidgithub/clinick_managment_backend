import type { AuthUser } from '../middleware/authenticate';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      /** Set by the requestId middleware; echoed in X-Request-Id and error logs. */
      id: string;
    }
  }
}

export {};
