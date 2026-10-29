import type { RequestHandler, Router } from 'express';

/** A recurring background task owned by a module (started by server.ts). */
export interface ModuleJob {
  name: string;
  intervalMs: number;
  runOnStart?: boolean;
  run: () => Promise<unknown>;
}

/**
 * A feature module. Each folder under src/modules exports one of these from
 * its index.ts, and app.ts mounts every route under /api.
 *
 * Module rules:
 *  - A module may import from src/shared and src/config.
 *  - A module may import another module ONLY through that module's index.ts
 *    (its public API). Never reach into another module's service or schema files.
 *  - A module writes only to its own tables. Reading related rows through
 *    Prisma relations (for profile and list views) is allowed.
 */
export interface AppModule {
  name: string;
  routes: Array<{ path: string; router: Router }>;
  /** Runs in front of every /api route of every module (e.g. the audit trail). */
  middleware?: RequestHandler[];
  jobs?: ModuleJob[];
}
