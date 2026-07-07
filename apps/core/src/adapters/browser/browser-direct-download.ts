import fs from 'node:fs';
import path from 'node:path';

import type { Page } from 'playwright-core';

import { resolveBrowserOutputPath } from './browser-artifact-policy.js';
import { resolveTargetLocator } from './browser-direct-page-actions.js';
import { actionOperationTimeout } from './browser-direct-timeout.js';
import { browserFileReferenceResult } from './browser-result-hygiene.js';
import { nowMs } from '../../shared/time/datetime.js';

export async function downloadWithBrowser(
  page: Page,
  args: Record<string, unknown>,
  outputDir: string,
  deadline: number,
): Promise<unknown> {
  const target = stringValue(args.target);
  const url = stringValue(args.url);
  if (!target && !url) {
    throw new Error('download requires target or url.');
  }
  const timeout = actionOperationTimeout(deadline);
  const downloadPromise = page.waitForEvent('download', { timeout });
  const triggerPromise = target
    ? (await resolveTargetLocator(page, target)).click({ timeout })
    : page.goto(url ?? '', { waitUntil: 'commit', timeout }).catch((err) => {
        if (!/download/i.test(errorMessage(err))) throw err;
      });
  const [download] = await Promise.all([downloadPromise, triggerPromise]);
  const filename = uniqueBrowserDownloadPath(
    outputDir,
    stringValue(args.filename),
    download.suggestedFilename(),
  );
  await download.saveAs(filename);
  return browserFileReferenceResult(
    filename,
    fs.statSync(filename),
    browserDownloadMimeType(filename),
  );
}

function uniqueBrowserDownloadPath(
  outputDir: string,
  requestedFilename: string | undefined,
  suggestedFilename: string,
): string {
  const safeName = safeDownloadFilename(suggestedFilename);
  const requested = requestedFilename || path.join('downloads', safeName);
  const first = resolveBrowserOutputPath(requested, outputDir);
  if (!fs.existsSync(first)) return first;
  const parsed = path.parse(first);
  for (let index = 1; index < 1000; index += 1) {
    const candidate = path.join(
      parsed.dir,
      `${parsed.name}-${index}${parsed.ext}`,
    );
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error('download output filename could not be made unique.');
}

function safeDownloadFilename(value: string): string {
  const basename = path.basename(value.trim()) || `download-${nowMs()}`;
  const cleaned = basename.replace(/[^A-Za-z0-9._-]+/g, '_');
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    return `download-${nowMs()}`;
  }
  return cleaned.slice(0, 180);
}

function browserDownloadMimeType(filename: string): string | undefined {
  switch (path.extname(filename).toLowerCase()) {
    case '.csv':
      return 'text/csv';
    case '.html':
    case '.htm':
      return 'text/html';
    case '.json':
      return 'application/json';
    case '.pdf':
      return 'application/pdf';
    case '.txt':
      return 'text/plain';
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.zip':
      return 'application/zip';
    default:
      return undefined;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
