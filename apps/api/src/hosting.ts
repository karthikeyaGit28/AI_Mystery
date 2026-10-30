import express, { type Express } from 'express';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';

export function configureProxyTrust(app: Express, hops: number) {
  const trustedHops = z.number().int().min(0).max(5).parse(hops);
  // A bounded hop count ignores client-supplied entries farther left in X-Forwarded-For.
  // The host must prevent direct access that bypasses those trusted edge proxies.
  app.set('trust proxy', trustedHops === 0 ? false : trustedHops);
}

const publicExtensions = new Set([
  '.html',
  '.js',
  '.css',
  '.json',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.ico',
  '.avif',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.txt',
  '.webmanifest',
]);
function inside(root: string, target: string) {
  const path = relative(root, target);
  return !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`);
}

export function mountWebApp(app: Express, webDistPath: string) {
  const selected = resolve(webDistPath);
  if (!existsSync(selected))
    throw new Error('SERVE_WEB requires a built frontend directory. Run npm run build.');
  const root = realpathSync(selected);
  const index = resolve(root, 'index.html');
  if (
    !statSync(root).isDirectory() ||
    !existsSync(index) ||
    !statSync(index).isFile() ||
    !inside(root, realpathSync(index))
  )
    throw new Error(
      'SERVE_WEB requires a built frontend directory containing index.html. Run npm run build.',
    );
  const serveFiles = express.static(root, {
    index: false,
    redirect: false,
    dotfiles: 'deny',
    fallthrough: true,
    setHeaders(res, file) {
      const hashed =
        relative(root, file).split(sep)[0] === 'assets' && /-[A-Za-z0-9_-]{8,}\.[^.]+$/.test(file);
      res.setHeader(
        'Cache-Control',
        extname(file) === '.html'
          ? 'no-store'
          : hashed
            ? 'public, max-age=31536000, immutable'
            : 'public, max-age=3600',
      );
    },
  });
  app.use((req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) return next();
    let path: string;
    try {
      path = decodeURIComponent(req.path);
    } catch {
      return next();
    }
    if (
      path.includes('\\') ||
      path.includes('\0') ||
      path.includes('%') ||
      path.split('/').some((part) => part.startsWith('.'))
    )
      return next();
    const extension = extname(path).toLowerCase();
    const candidate = resolve(root, `.${path}`);
    if (!inside(root, candidate)) return next();
    if (extension && publicExtensions.has(extension) && existsSync(candidate)) {
      // Never follow a published symlink out of the selected build directory.
      if (!inside(root, realpathSync(candidate))) return next();
      return serveFiles(req, res, next);
    }
    const acceptsHtml = /\btext\/html\b/i.test(req.get('Accept') ?? '') && req.accepts('html');
    if (
      req.method !== 'GET' ||
      extension ||
      path === '/assets' ||
      path.startsWith('/assets/') ||
      !acceptsHtml
    )
      return next();
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(index, { cacheControl: false, lastModified: false }, (error) => {
      if (error) next(error);
    });
  });
}
