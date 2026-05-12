export const RUNTIME_EVENT_TYPES = {
  SESSION_MESSAGE_INBOUND: 'session.message.inbound',
  SESSION_MESSAGE_OUTBOUND: 'session.message.outbound',
  SESSION_MESSAGE_STREAMING: 'session.message.streaming',
  SESSION_TYPING: 'session.typing',
  SESSION_PROGRESS: 'session.progress',
  JOB_TRIGGERED: 'job.triggered',
  JOB_RUN_STARTED: 'job.run.started',
  JOB_STARTED: 'job.started',
  JOB_STREAMING: 'job.streaming',
  JOB_TOOL_DENIED: 'job.tool_denied',
  JOB_TOOL_ACTIVITY: 'job.tool_activity',
  JOB_COMPLETED: 'job.completed',
  JOB_FAILED: 'job.failed',
  JOB_RUN_COMPLETED: 'job.run.completed',
  JOB_RUN_FAILED: 'job.run.failed',
  RUN_STARTED: 'run.started',
  RUN_CANCELED: 'run.canceled',
  RUN_COMPLETED: 'run.completed',
  RUN_FAILED: 'run.failed',
  RUN_TIMEOUT: 'run.timeout',
  RUN_DEAD_LETTERED: 'run.dead_lettered',
  WEBHOOK_TEST: 'webhook.test',
} as const;

export type RuntimeEventType =
  (typeof RUNTIME_EVENT_TYPES)[keyof typeof RUNTIME_EVENT_TYPES];

const RUNTIME_EVENT_TYPE_VALUES = new Set<string>(
  Object.values(RUNTIME_EVENT_TYPES),
);

export function isRuntimeEventType(value: unknown): value is RuntimeEventType {
  return (
    typeof value === 'string' &&
    RUNTIME_EVENT_TYPE_VALUES.has(value as RuntimeEventType)
  );
}

export function parseRuntimeEventType(
  value: unknown,
): RuntimeEventType | undefined {
  return isRuntimeEventType(value) ? value : undefined;
}

export function requireRuntimeEventType(
  value: unknown,
  context = 'Runtime event type',
): RuntimeEventType {
  if (isRuntimeEventType(value)) return value;
  throw new Error(`${context} must be a known runtime event type.`);
}
