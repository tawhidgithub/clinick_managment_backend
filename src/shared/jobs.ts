import type { ModuleJob } from './module';

/** Starts each job on its interval. A run never overlaps the previous one. */
export function startJobs(jobs: ModuleJob[]): () => void {
  const timers: NodeJS.Timeout[] = [];

  for (const job of jobs) {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        const result = await job.run();
        if (result !== undefined) console.log(`[job:${job.name}]`, result);
      } catch (err) {
        console.error(`[job:${job.name}] failed`, err);
      } finally {
        running = false;
      }
    };
    if (job.runOnStart) void tick();
    timers.push(setInterval(tick, job.intervalMs));
  }

  return () => timers.forEach(clearInterval);
}
