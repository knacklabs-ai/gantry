import { Plan } from '../types/plan';

const VITE_API_URL = (import.meta as unknown as { env?: { VITE_API_URL?: string } })
  .env?.VITE_API_URL?.replace(/\/+$/, '') || '';

function normalizeHttpUrl(input: string | null | undefined): string | null {
  const value = (input || '').trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function resolveApiBase(): string {
  try {
    const url = new URL(window.location.href);
    const apiBase = normalizeHttpUrl(url.searchParams.get('api'));
    if (apiBase) return `${apiBase}/api`;
  } catch {
    // URL parsing failed — fall through to env/default
  }
  const envApiBase = normalizeHttpUrl(VITE_API_URL);
  if (envApiBase) return `${envApiBase}/api`;
  return '/api';
}

function getInitDataHeader(initData?: string): Record<string, string> {
  return initData
    ? {
        'x-telegram-init-data': initData,
      }
    : {};
}

export async function fetchPlans(initData?: string): Promise<Plan[]> {
  const response = await fetch(`${resolveApiBase()}/plans`, {
    headers: {
      ...getInitDataHeader(initData),
    },
  });
  if (response.status === 401) {
    throw new Error(
      'Failed to load plans (401). Reopen this Mini App from Telegram to refresh auth.',
    );
  }
  if (!response.ok)
    throw new Error(`Failed to load plans (${response.status})`);
  const payload = (await response.json()) as { plans?: Plan[] };
  return payload.plans || [];
}

export async function fetchPlan(
  planId: string,
  initData?: string,
): Promise<Plan> {
  const response = await fetch(`${resolveApiBase()}/plans/${planId}`, {
    headers: {
      ...getInitDataHeader(initData),
    },
  });
  if (response.status === 401) {
    throw new Error(
      'Failed to load plan (401). Reopen this Mini App from Telegram to refresh auth.',
    );
  }
  if (!response.ok) throw new Error(`Failed to load plan (${response.status})`);
  const payload = (await response.json()) as { plan: Plan };
  return payload.plan;
}

async function postPlanAction(
  url: string,
  initData?: string,
  body?: Record<string, unknown>,
): Promise<Plan> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...getInitDataHeader(initData),
    },
    body: JSON.stringify(body || {}),
  });
  if (response.status === 401) {
    throw new Error('Action failed (401). Reopen this Mini App from Telegram.');
  }
  if (!response.ok) throw new Error(`Action failed (${response.status})`);
  const payload = (await response.json()) as { plan: Plan };
  return payload.plan;
}

export function approveSection(
  planId: string,
  sectionIndex: number,
  initData?: string,
): Promise<Plan> {
  return postPlanAction(
    `${resolveApiBase()}/plans/${planId}/sections/${sectionIndex}/approve`,
    initData,
  );
}

export function rejectSection(
  planId: string,
  sectionIndex: number,
  reason: string,
  initData?: string,
): Promise<Plan> {
  return postPlanAction(
    `${resolveApiBase()}/plans/${planId}/sections/${sectionIndex}/reject`,
    initData,
    { reason },
  );
}

export function editSection(
  planId: string,
  sectionIndex: number,
  content: string,
  initData?: string,
): Promise<Plan> {
  return postPlanAction(
    `${resolveApiBase()}/plans/${planId}/sections/${sectionIndex}/edit`,
    initData,
    { content },
  );
}

export function approveAll(planId: string, initData?: string): Promise<Plan> {
  return postPlanAction(
    `${resolveApiBase()}/plans/${planId}/approve-all`,
    initData,
  );
}

export function rejectPlan(
  planId: string,
  reason: string,
  initData?: string,
): Promise<Plan> {
  return postPlanAction(
    `${resolveApiBase()}/plans/${planId}/reject`,
    initData,
    { reason },
  );
}
