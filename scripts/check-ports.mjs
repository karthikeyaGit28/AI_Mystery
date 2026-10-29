import net from 'node:net';
await Promise.all(
  [27017, 6379, 9000, 4000, 5173].map(
    (port) =>
      new Promise((resolve) => {
        const socket = net.connect(port, '127.0.0.1');
        socket.setTimeout(2000);
        socket.once('connect', () => {
          console.log(`${port}: open`);
          socket.destroy();
          resolve();
        });
        socket.once('error', (error) => {
          console.log(`${port}: ${error.code}`);
          resolve();
        });
        socket.once('timeout', () => {
          console.log(`${port}: timeout`);
          socket.destroy();
          resolve();
        });
      }),
  ),
);
for (const url of [
  'http://localhost:4000/api/v1/health',
  'http://127.0.0.1:4000/api/v1/health',
  'http://localhost:5173/',
]) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    console.log(`${url}: HTTP ${response.status}`);
  } catch (error) {
    console.log(`${url}: ${error.message}`);
  }
}
const privateSource = `http://localhost:5173/@fs/${process.cwd().replaceAll('\\', '/')}/apps/worker/src/prompts/blueprint.system.md`;
try {
  const denied = await fetch(privateSource, { signal: AbortSignal.timeout(5000) });
  console.log(`Private worker source: HTTP ${denied.status}`);
  if (denied.status !== 403 && denied.status !== 404) process.exitCode = 1;
} catch {
  console.log('Private source check skipped: frontend is offline.');
}
