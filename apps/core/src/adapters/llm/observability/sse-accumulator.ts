import { StringDecoder } from 'node:string_decoder';

export type SseStreamKind = 'anthropic' | 'openai';

const MAX_COMPLETION_CHARS = 256 * 1024;

export interface SseAccumulatorResult {
  model?: string;
  usage?: Record<string, unknown>;
  completionText?: string;
  finishReason?: string;
}

export interface SseFrameSplitter {
  push: (chunk: Buffer) => string[];
  flush: () => string[];
}

// SSE frames are separated by a blank line; tolerate CRLF. StringDecoder
// holds partial multibyte UTF-8 sequences split across chunk boundaries —
// plain chunk.toString('utf8') would corrupt them.
export function createSseFrameSplitter(): SseFrameSplitter {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  return {
    push: (chunk) => {
      pending += decoder.write(chunk);
      const frames: string[] = [];
      let boundary: number;
      while ((boundary = pending.search(/\r?\n\r?\n/)) >= 0) {
        const match = /\r?\n\r?\n/.exec(pending.slice(boundary));
        frames.push(pending.slice(0, boundary));
        pending = pending.slice(boundary + (match?.[0].length ?? 2));
      }
      return frames;
    },
    flush: () => {
      const rest = pending + decoder.end();
      pending = '';
      return rest.trim() ? [rest] : [];
    },
  };
}

export function sseFrameData(frame: string): string | undefined {
  const dataLines = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim());
  if (dataLines.length === 0) return undefined;
  return dataLines.join('\n');
}

// An OpenAI stream_options.include_usage terminal chunk: usage present and
// no choices content. Used to strip the frame when the gateway injected the
// flag on behalf of a caller that did not ask for it.
export function isOpenAiUsageOnlyFrame(frame: string): boolean {
  const data = sseFrameData(frame);
  if (!data || data === '[DONE]') return false;
  try {
    const parsed = JSON.parse(data) as {
      usage?: unknown;
      choices?: unknown[];
    };
    return (
      parsed.usage !== undefined &&
      parsed.usage !== null &&
      (!Array.isArray(parsed.choices) || parsed.choices.length === 0)
    );
  } catch {
    return false;
  }
}

export interface SseAccumulator {
  push: (chunk: Buffer) => void;
  pushFrame: (frame: string) => void;
  result: () => SseAccumulatorResult;
}

export function createSseAccumulator(
  kind: SseStreamKind,
  captureContent: boolean,
): SseAccumulator {
  const splitter = createSseFrameSplitter();
  let dead = false;
  let done = false;
  let model: string | undefined;
  let completionText = '';
  let completionCapped = false;
  let finishReason: string | undefined;
  const usage: Record<string, unknown> = {};
  let sawUsage = false;

  const appendText = (text: string) => {
    if (!captureContent || completionCapped) return;
    completionText += text;
    if (completionText.length > MAX_COMPLETION_CHARS) {
      completionText = completionText.slice(0, MAX_COMPLETION_CHARS);
      completionCapped = true;
    }
  };

  const mergeUsage = (value: unknown) => {
    if (value === null || typeof value !== 'object') return;
    for (const [key, entry] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (entry !== undefined && entry !== null) {
        usage[key] = entry;
        sawUsage = true;
      }
    }
  };

  const handleAnthropicEvent = (event: Record<string, unknown>) => {
    if (event.type === 'message_start') {
      const message = event.message as
        | { model?: string; usage?: unknown }
        | undefined;
      if (typeof message?.model === 'string') model = message.model;
      mergeUsage(message?.usage);
      return;
    }
    if (event.type === 'content_block_delta') {
      const delta = event.delta as { type?: string; text?: string } | undefined;
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        appendText(delta.text);
      }
      return;
    }
    if (event.type === 'message_delta') {
      mergeUsage(event.usage);
      const delta = event.delta as { stop_reason?: string } | undefined;
      if (typeof delta?.stop_reason === 'string') {
        finishReason = delta.stop_reason;
      }
    }
  };

  const handleOpenAiEvent = (event: Record<string, unknown>) => {
    if (typeof event.model === 'string') model = event.model;
    mergeUsage(event.usage);
    const choice = (
      event.choices as Record<string, unknown>[] | undefined
    )?.[0];
    if (!choice) return;
    const delta = choice.delta as { content?: unknown } | undefined;
    if (typeof delta?.content === 'string') appendText(delta.content);
    if (typeof choice.finish_reason === 'string') {
      finishReason = choice.finish_reason;
    }
  };

  const pushFrame = (frame: string) => {
    if (dead || done) return;
    try {
      const data = sseFrameData(frame);
      if (!data) return;
      if (data === '[DONE]') {
        done = true;
        return;
      }
      const event = JSON.parse(data) as Record<string, unknown>;
      if (kind === 'anthropic') handleAnthropicEvent(event);
      else handleOpenAiEvent(event);
    } catch {
      // ponytail: one malformed frame stops parsing entirely; the proxied
      // stream is untouched and the span just carries partial data.
      dead = true;
    }
  };

  return {
    push: (chunk) => {
      if (dead || done) return;
      try {
        for (const frame of splitter.push(chunk)) pushFrame(frame);
      } catch {
        dead = true;
      }
    },
    pushFrame,
    result: () => ({
      ...(model ? { model } : {}),
      ...(sawUsage ? { usage } : {}),
      ...(completionText ? { completionText } : {}),
      ...(finishReason ? { finishReason } : {}),
    }),
  };
}
