import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';

const UI_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../ui',
);

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

export async function handleUiStaticRequest(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;

  if (pathname === '/ui') {
    res.statusCode = 308;
    res.setHeader('location', '/ui/');
    res.end();
    return true;
  }

  if (!pathname.startsWith('/ui/')) return false;

  const requestPath = decodeUiPath(pathname.slice('/ui/'.length));
  if (requestPath === null) {
    sendNotFound(res);
    return true;
  }

  const assetPath = resolveWithinUiRoot(requestPath);
  if (!assetPath) {
    sendNotFound(res);
    return true;
  }
  const requestedAsset = await readUiAsset(assetPath);
  if (requestedAsset) {
    sendAsset(
      req,
      res,
      assetPath,
      requestedAsset,
      requestPath.startsWith('assets/'),
    );
    return true;
  }

  if (path.extname(requestPath)) {
    sendNotFound(res);
    return true;
  }

  const indexPath = path.join(UI_ROOT, 'index.html');
  const index = await readUiAsset(indexPath);
  if (!index) {
    sendNotFound(res);
    return true;
  }
  sendAsset(req, res, indexPath, index, false);
  return true;
}

function decodeUiPath(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    return decoded.includes('\0') ? null : decoded;
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
}

function resolveWithinUiRoot(requestPath: string): string | null {
  const resolved = path.resolve(UI_ROOT, requestPath || 'index.html');
  return resolved === UI_ROOT || resolved.startsWith(`${UI_ROOT}${path.sep}`)
    ? resolved
    : null;
}

async function readUiAsset(filePath: string | null): Promise<Buffer | null> {
  if (!filePath) return null;
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return null;
    return await fs.readFile(filePath);
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  return error.code === 'ENOENT' || error.code === 'ENOTDIR';
}

function sendAsset(
  req: IncomingMessage,
  res: ServerResponse,
  filePath: string,
  asset: Buffer,
  immutable: boolean,
): void {
  const extension = path.extname(filePath);
  res.statusCode = 200;
  res.setHeader(
    'content-type',
    MIME_TYPES[extension] || 'application/octet-stream',
  );
  res.setHeader(
    'cache-control',
    immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  );
  res.setHeader('content-security-policy', UI_CONTENT_SECURITY_POLICY);
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('x-content-type-options', 'nosniff');
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(asset);
}

function sendNotFound(res: ServerResponse): void {
  res.statusCode = 404;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end('Not found');
}

const UI_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "connect-src 'self'",
  "font-src 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
].join('; ');
