import type { Job } from '../../domain/types.js';
import type {
  AppSessionRecord,
  JobControlPort,
} from './job-management-types.js';

export const DEFAULT_JOB_RUNTIME_APP_ID = 'default';

export function isDefaultRuntimeJobScope(appId: string): boolean {
  return appId === DEFAULT_JOB_RUNTIME_APP_ID;
}

export async function resolveJobAppSession(input: {
  control: JobControlPort;
  job: Job;
  appId: string;
}): Promise<AppSessionRecord | undefined> {
  const { appId, control, job } = input;
  if (job.session_id) {
    const session = await control.getAppSessionById(job.session_id);
    if (session?.appId === appId) return session;
    return undefined;
  }
  return undefined;
}

export async function filterJobsByCanonicalAppSession(input: {
  control: JobControlPort;
  jobs: readonly Job[];
  appId: string;
}): Promise<Job[]> {
  const includeHostOwnedJobs = isDefaultRuntimeJobScope(input.appId);
  const sessionIds = Array.from(
    new Set(
      input.jobs
        .map((job) => job.session_id?.trim())
        .filter((sessionId): sessionId is string => Boolean(sessionId)),
    ),
  );
  if (sessionIds.length === 0) {
    return includeHostOwnedJobs
      ? input.jobs.filter((job) => !job.session_id)
      : [];
  }
  const sessions = await input.control.getAppSessionsByIds(sessionIds);
  const allowedSessionIds = new Set(
    sessions
      .filter((session) => session.appId === input.appId)
      .map((session) => session.sessionId),
  );
  return input.jobs.filter((job) =>
    job.session_id
      ? allowedSessionIds.has(job.session_id)
      : includeHostOwnedJobs,
  );
}
