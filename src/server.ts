import { createApp } from './app';
import { env } from './config/env';
import { modules } from './modules';
import { prisma } from './shared/db/prisma';
import { startJobs } from './shared/jobs';

const app = createApp();

const server = app.listen(env.PORT, (err?: Error) => {
  if (err) {
    console.error(`Could not start on port ${env.PORT}: ${err.message}`);
    process.exit(1);
  }
  console.log(`Chowa API listening on http://localhost:${env.PORT}/api (${env.NODE_ENV})`);
});
// Longer than Nginx's 60 s upstream keep-alive, so Nginx never reuses a socket Node just closed.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

const stopJobs = env.RUN_JOBS ? startJobs(modules.flatMap((m) => m.jobs ?? [])) : () => {};

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  stopJobs();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  // Force exit if connections do not close in time
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

// A promise nobody awaited failed: log it and keep serving.
process.on('unhandledRejection', (reason) => console.error('Unhandled promise rejection:', reason));
// Anything else is a bug that left the process in an unknown state: log it and
// exit so PM2 starts a clean process.
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception, restarting:', err);
  process.exit(1);
});
