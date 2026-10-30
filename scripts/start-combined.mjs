import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// One free web container hosts two independently supervised application processes.
// MongoDB, Redis, and media remain external so a sleeping/restarting host loses no canon.
export function startCombined({ spawnImpl = spawn, runtime = process, timeoutMs = 28000 } = {}) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const children = new Set();
  let stopping = false;
  let exitCode = 0;
  let deadline;
  const finish = () => {
    if (children.size) return;
    clearTimeout(deadline);
    runtime.removeListener('SIGINT', onSignal);
    runtime.removeListener('SIGTERM', onSignal);
    runtime.exit(exitCode);
  };
  const stop = (code = 0) => {
    if (stopping) return;
    stopping = true;
    exitCode = code;
    deadline = setTimeout(() => {
      for (const child of children) child.kill('SIGKILL');
      runtime.exit(exitCode || 1);
    }, timeoutMs);
    deadline.unref();
    for (const child of children) child.kill('SIGTERM');
    finish();
  };
  const onSignal = () => stop(0);
  runtime.once('SIGINT', onSignal);
  runtime.once('SIGTERM', onSignal);
  for (const service of [
    { name: 'api', entry: 'apps/api/src/server.ts', heap: 96, serveWeb: 'true' },
    { name: 'worker', entry: 'apps/worker/src/worker.ts', heap: 160, serveWeb: 'false' },
  ]) {
    if (stopping) break;
    let child;
    try {
      child = spawnImpl(
        runtime.execPath,
        [`--max-old-space-size=${service.heap}`, '--import', 'tsx', service.entry],
        {
          cwd: root,
          env: { ...runtime.env, SERVE_WEB: service.serveWeb },
          stdio: 'inherit',
          windowsHide: true,
        },
      );
    } catch {
      console.error(`The ${service.name} process could not start.`);
      stop(1);
      break;
    }
    children.add(child);
    child.once('error', () => {
      console.error(`The ${service.name} process could not start.`);
      children.delete(child);
      stop(1);
      finish();
    });
    child.once('exit', (code) => {
      children.delete(child);
      if (!stopping) {
        console.error(`The ${service.name} process stopped; restarting the container is required.`);
        stop(code || 1);
      }
      finish();
    });
  }
  return { stop };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startCombined();
}
