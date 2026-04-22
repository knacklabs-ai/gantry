import fs from 'fs';
import path from 'path';

import { DATA_DIR } from '../core/config.js';

export function writeContinuationInput(
  groupFolder: string,
  text: string,
  sequence: number,
  threadId?: string | null,
): void {
  const inputDir = path.join(DATA_DIR, 'ipc', groupFolder, 'input');
  fs.mkdirSync(inputDir, { recursive: true });
  const filename = `${Date.now()}-${String(sequence).padStart(12, '0')}.json`;
  const filepath = path.join(inputDir, filename);
  const tempPath = `${filepath}.tmp`;
  fs.writeFileSync(
    tempPath,
    JSON.stringify({
      type: 'message',
      text,
      ...(threadId ? { threadId } : {}),
    }),
  );
  fs.renameSync(tempPath, filepath);
}

export function writeCloseSignal(groupFolder: string): void {
  const inputDir = path.join(DATA_DIR, 'ipc', groupFolder, 'input');
  fs.mkdirSync(inputDir, { recursive: true });
  fs.writeFileSync(path.join(inputDir, '_close'), '');
}
