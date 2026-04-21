import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { writeFileAtomic } from '../core/fs-paths.js';
import { logger } from '../core/logger.js';
import { MemoryService } from '../memory/memory-service.js';

const DEFAULT_MEMORY_BRIEF_ITEMS = 24;

export type MemoryContextSource = 'message' | 'command' | 'scheduler';

export interface BuildMemoryContextInput {
  groupFolder: string;
  chatJid: string;
  source: MemoryContextSource;
  userId?: string;
  threadId?: string;
  maxItems?: number;
}

export interface PreparedMemoryContext {
  filePath: string;
  cleanup: () => void;
}

interface ConversationMode {
  channel: 'slack' | 'telegram' | 'unknown';
  audience: 'direct' | 'group';
}

function normalizeId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function inferConversationMode(chatJid: string): ConversationMode {
  if (chatJid.startsWith('sl:')) {
    const slackId = chatJid.slice(3).trim().toUpperCase();
    const audience = slackId.startsWith('D') ? 'direct' : 'group';
    return { channel: 'slack', audience };
  }
  if (chatJid.startsWith('tg:')) {
    const raw = chatJid.slice(3).trim();
    const numeric = Number(raw);
    const audience =
      Number.isFinite(numeric) && numeric > 0 ? 'direct' : 'group';
    return { channel: 'telegram', audience };
  }
  return { channel: 'unknown', audience: 'group' };
}

function scopeGuidance(mode: ConversationMode, hasTopic: boolean): string[] {
  const baseline = [
    '`user` scope is for personal preferences/corrections tied to one person.',
    '`group` scope is the default working memory for this active chat.',
    '`global` scope is cross-chat memory and should be used only when the user explicitly asks to share broadly.',
  ];

  const channelSpecific =
    mode.channel === 'slack'
      ? [
          mode.audience === 'direct'
            ? 'Slack DM: prefer `user` for personal preferences and `group` for current thread/task context.'
            : 'Slack channel: prefer `group` for channel memory; move to `global` only for explicit org-wide facts.',
        ]
      : mode.channel === 'telegram'
        ? [
            mode.audience === 'direct'
              ? 'Telegram personal chat: prefer `user` + `group`; avoid `global` unless explicitly requested.'
              : 'Telegram group: keep shared chat memory in `group`; reserve `global` for intentionally universal rules.',
          ]
        : [
            'Default to `group` scope unless explicit user intent says otherwise.',
          ];

  const topicRule = hasTopic
    ? [
        'A `thread_id` is present: treat it as a topic boundary and include a topic marker in keys (for example `topic:<thread_id>:...`) to avoid cross-topic bleed.',
      ]
    : [];

  return [...baseline, ...channelSpecific, ...topicRule];
}

function sanitizePathSegment(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'group';
}

function buildInjectedBlock(
  brief: string,
  input: BuildMemoryContextInput,
): string {
  const userId = normalizeId(input.userId);
  const threadId = normalizeId(input.threadId);
  const mode = inferConversationMode(input.chatJid);
  const lines: string[] = [
    '## Runtime Continuity Envelope',
    `- source: ${input.source}`,
    `- group_folder: ${input.groupFolder}`,
    `- chat_jid: ${input.chatJid}`,
    ...(threadId ? [`- thread_id: ${threadId}`] : []),
    ...(userId ? [`- user_id: ${userId}`] : []),
    '',
    '### Scope Guidance',
    ...scopeGuidance(mode, Boolean(threadId)).map((line) => `- ${line}`),
    '',
    brief.trim() || '## Memory Brief\n\nNo durable memory available yet.',
  ];
  return lines.join('\n');
}

function removeFileQuietly(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true });
  } catch (err) {
    logger.debug(
      { err, filePath },
      'Failed to clean up injected memory context file',
    );
  }
}

export async function createInjectedMemoryContextFile(
  input: BuildMemoryContextInput,
): Promise<PreparedMemoryContext | null> {
  try {
    const userId = normalizeId(input.userId);
    const brief = await MemoryService.getInstance().buildBrief({
      groupFolder: input.groupFolder,
      maxItems: input.maxItems ?? DEFAULT_MEMORY_BRIEF_ITEMS,
      userId,
    });
    const block = buildInjectedBlock(brief, input);
    const dir = path.join(
      os.tmpdir(),
      'myclaw-memory-context',
      sanitizePathSegment(input.groupFolder),
    );
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(
      dir,
      `memory-context.${Date.now()}.${randomUUID()}.json`,
    );
    writeFileAtomic(filePath, JSON.stringify({ block }, null, 2));
    return {
      filePath,
      cleanup: () => removeFileQuietly(filePath),
    };
  } catch (err) {
    logger.warn(
      {
        err,
        groupFolder: input.groupFolder,
        chatJid: input.chatJid,
      },
      'Failed to prepare injected memory context; continuing without it',
    );
    return null;
  }
}