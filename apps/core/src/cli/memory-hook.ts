import { logger } from '../core/logger.js';
import {
  resolveRuntimeAndGroup,
  resolveSessionId,
  resolveTranscriptPath,
  resolveUserId,
  type HookPayload,
} from './memory-hook-context.js';

type ExtractTrigger = 'precompact' | 'session-end';

async function readStdinPayload(): Promise<HookPayload> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }

  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf-8').trim();
  if (!text) return {};

  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as HookPayload;
  } catch {
    logger.warn('Ignoring malformed hook stdin payload for memory-hook');
    return {};
  }
}

function parseTrigger(argv: string[]): ExtractTrigger | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const raw =
      arg === '--trigger'
        ? argv[index + 1]
        : arg.startsWith('--trigger=')
          ? arg.slice('--trigger='.length)
          : undefined;
    if (!raw) continue;
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'precompact') return 'precompact';
    if (normalized === 'session-end') return 'session-end';
    return undefined;
  }
  return undefined;
}

function writeSessionStartHookOutput(additionalContext: string): void {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext,
      },
    }),
  );
}

function usage(): string {
  return [
    'Usage:',
    '  myclaw memory-hook load',
    '  myclaw memory-hook extract --trigger=<precompact|session-end>',
  ].join('\n');
}

type MemoryServiceInstance = {
  ingestGroupSources(groupFolder: string): Promise<void>;
  ingestGlobalKnowledge(dirOverride?: string): Promise<void>;
  buildBrief(input: {
    groupFolder: string;
    maxItems: number;
    userId?: string;
  }): Promise<string>;
  extractFromTranscript(input: {
    transcriptPath: string;
    sessionId?: string;
    trigger: ExtractTrigger;
    groupFolder: string;
    userId?: string;
  }): Promise<void>;
};

async function getMemoryService(): Promise<MemoryServiceInstance> {
  const module = await import('../memory/memory-service.js');
  return module.MemoryService.getInstance();
}

export async function runMemoryHookCommand(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  readPayload: () => Promise<HookPayload> = readStdinPayload,
  loadMemoryService: () => Promise<MemoryServiceInstance> = getMemoryService,
): Promise<number> {
  const [subcommand, ...rest] = argv;
  if (subcommand !== 'load' && subcommand !== 'extract') {
    logger.warn({ argv }, usage());
    return 0;
  }

  const previousLogStderr = process.env.MYCLAW_LOG_STDERR;
  process.env.MYCLAW_LOG_STDERR = '1';
  env.MYCLAW_LOG_STDERR = '1';

  try {
    const payload = await readPayload();
    const { runtimeHome, groupFolder } = resolveRuntimeAndGroup(payload, env);

    if (runtimeHome) {
      env.MYCLAW_HOME = runtimeHome;
      process.env.MYCLAW_HOME = runtimeHome;
    }

    if (subcommand === 'load') {
      if (!groupFolder) {
        writeSessionStartHookOutput('');
        return 0;
      }

      try {
        const service = await loadMemoryService();
        await service.ingestGroupSources(groupFolder);
        await service.ingestGlobalKnowledge();
        const brief = await service.buildBrief({
          groupFolder,
          maxItems: 20,
          userId: resolveUserId(payload, env),
        });
        writeSessionStartHookOutput(brief);
      } catch (err) {
        logger.warn({ err, groupFolder }, 'memory-hook load failed');
        writeSessionStartHookOutput('');
      }

      return 0;
    }

    const trigger = parseTrigger(rest);
    if (!trigger || !groupFolder) {
      return 0;
    }

    const sessionId = resolveSessionId(payload, env);
    const transcriptPath = resolveTranscriptPath(
      payload,
      runtimeHome,
      groupFolder,
      sessionId,
    );
    if (!transcriptPath) {
      logger.warn(
        { trigger, groupFolder, sessionId: sessionId || null },
        'memory-hook extract skipped: transcript not found',
      );
      return 0;
    }

    try {
      const service = await loadMemoryService();
      await service.extractFromTranscript({
        transcriptPath,
        sessionId,
        trigger,
        groupFolder,
        userId: resolveUserId(payload, env),
      });
    } catch (err) {
      logger.warn({ err, trigger, groupFolder }, 'memory-hook extract failed');
    }

    return 0;
  } finally {
    if (previousLogStderr === undefined) {
      delete process.env.MYCLAW_LOG_STDERR;
    } else {
      process.env.MYCLAW_LOG_STDERR = previousLogStderr;
    }
    if (previousLogStderr === undefined) {
      delete env.MYCLAW_LOG_STDERR;
    } else {
      env.MYCLAW_LOG_STDERR = previousLogStderr;
    }
  }
}
