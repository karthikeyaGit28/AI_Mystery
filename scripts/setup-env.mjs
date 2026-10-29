import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
try {
  const example = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
  await writeFile(
    new URL('../.env', import.meta.url),
    example.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${randomBytes(48).toString('hex')}`),
    { flag: 'wx' },
  );
  console.log('Created .env with a unique local session secret.');
} catch (error) {
  if (error.code === 'EEXIST') console.log('Existing .env preserved.');
  else throw error;
}
