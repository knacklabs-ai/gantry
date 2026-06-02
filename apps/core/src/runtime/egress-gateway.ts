import http from 'http';
import { createHash } from 'crypto';
import type { Duplex } from 'stream';

import {
  evaluateEgressDenylist,
  normalizeEgressHost,
  type EgressSettings,
} from '../shared/egress-policy.js';
import { declaredNetworkAuthority } from '../shared/network-host-declaration.js';
import {
  RUNTIME_EVENT_TYPES,
  type RuntimeEventType,
} from '../domain/events/runtime-event-types.js';
import { normalizeRuntimeEventConversationId } from '../domain/events/runtime-event-conversation.js';
import type { RuntimeEventPublishInput } from '../domain/events/events.js';
import {
  isIpAddress,
  isPrivateNetworkAddress,
  type HostnameLookup,
} from '../domain/network/public-address-policy.js';
import { lookupHostnameWithDeadline } from '../shared/hostname-lookup-deadline.js';
import { logger } from '../infrastructure/logging/logger.js';
import {
  requestDirect,
  requestViaUpstreamProxy,
  tunnelDirect,
  tunnelViaUpstreamProxy,
} from './egress-gateway-proxying.js';

export interface EgressGatewayPrincipal {
  appId: string;
  agentId?: string;
  conversationId?: string;
  threadId?: string;
  runId?: string;
  jobId?: string;
}

export interface EgressGatewayUpstreamProxy {
  url: string;
  provider: string;
}

/**
 * Run-scoped attribution of a declared outbound host to the reviewed capability
 * that authorized it. Derived from selected runtime access (local CLI and skill
 * action network bindings), never from product-specific host code, so egress
 * audit can name the capability that declared a host for the duration of a run.
 */
export interface EgressNetworkAttribution {
  host: string;
  capabilityId: string;
  capabilityLabel: string;
}

export interface EgressGatewayHandle {
  key: string;
  proxyUrl: string;
  port: number;
}

interface EgressGatewayState {
  key: string;
  port: number;
  server: http.Server;
  sockets: Set<Duplex>;
  settings: EgressSettings;
  principal: EgressGatewayPrincipal;
  networkAttribution: Map<string, EgressNetworkAttribution>;
  modelProviderNetworkHosts: Set<string>;
  restrictToAttributedNetworkHosts: boolean;
  lookupHostname?: HostnameLookup;
  dnsLookupTimeoutMs: number;
  upstreamProxy?: EgressGatewayUpstreamProxy;
  publishRuntimeEvent?: (
    event: RuntimeEventPublishInput,
  ) => Promise<unknown> | unknown;
}

function networkAttributionMap(
  attribution: readonly EgressNetworkAttribution[] | undefined,
): Map<string, EgressNetworkAttribution> {
  const map = new Map<string, EgressNetworkAttribution>();
  for (const entry of attribution ?? []) {
    const authority = declaredNetworkAuthority(entry.host);
    if (authority && !map.has(authority)) map.set(authority, entry);
  }
  return map;
}

function declaredNetworkHostSet(
  hosts: readonly string[] | undefined,
): Set<string> {
  const out = new Set<string>();
  for (const host of hosts ?? []) {
    const authority = declaredNetworkAuthority(host);
    if (authority) out.add(authority);
  }
  return out;
}

const EGRESS_GATEWAY_BASE_PORT = 18_080;
const EGRESS_GATEWAY_PORT_SPAN = 2_000;
const EGRESS_GATEWAY_MAX_PORT_PROBES = 50;
const EGRESS_GATEWAY_CLOSE_TIMEOUT_MS = 1_000;
const EGRESS_GATEWAY_DNS_LOOKUP_TIMEOUT_MS = 30_000;
const gateways = new Map<string, EgressGatewayState>();

export async function closeEgressGatewaysForTest(): Promise<void> {
  const states = [...gateways.values()];
  gateways.clear();
  await Promise.all(states.map((state) => closeGatewayState(state)));
}

export async function closeEgressGateway(
  handleOrKey: EgressGatewayHandle | string | undefined,
): Promise<void> {
  if (!handleOrKey) return;
  const key = typeof handleOrKey === 'string' ? handleOrKey : handleOrKey.key;
  const state = gateways.get(key);
  if (!state) return;
  gateways.delete(key);
  await closeGatewayState(state);
}

export async function ensureEgressGateway(input: {
  key: string;
  settings: EgressSettings;
  principal: EgressGatewayPrincipal;
  networkAttribution?: readonly EgressNetworkAttribution[];
  modelProviderNetworkHosts?: readonly string[];
  restrictToAttributedNetworkHosts?: boolean;
  lookupHostname?: HostnameLookup;
  dnsLookupTimeoutMs?: number;
  upstreamProxy?: EgressGatewayUpstreamProxy;
  publishRuntimeEvent?: (
    event: RuntimeEventPublishInput,
  ) => Promise<unknown> | unknown;
}): Promise<EgressGatewayHandle> {
  const existing = gateways.get(input.key);
  if (existing) {
    existing.settings = input.settings;
    existing.principal = input.principal;
    existing.networkAttribution = networkAttributionMap(
      input.networkAttribution,
    );
    existing.modelProviderNetworkHosts = declaredNetworkHostSet(
      input.modelProviderNetworkHosts,
    );
    existing.restrictToAttributedNetworkHosts =
      input.restrictToAttributedNetworkHosts ??
      existing.networkAttribution.size > 0;
    if (input.lookupHostname) {
      existing.lookupHostname = input.lookupHostname;
    } else {
      delete existing.lookupHostname;
    }
    existing.dnsLookupTimeoutMs =
      input.dnsLookupTimeoutMs ?? EGRESS_GATEWAY_DNS_LOOKUP_TIMEOUT_MS;
    if (input.upstreamProxy) {
      existing.upstreamProxy = input.upstreamProxy;
    } else {
      delete existing.upstreamProxy;
    }
    if (input.publishRuntimeEvent) {
      existing.publishRuntimeEvent = input.publishRuntimeEvent;
    } else {
      delete existing.publishRuntimeEvent;
    }
    return {
      key: input.key,
      proxyUrl: `http://127.0.0.1:${existing.port}/`,
      port: existing.port,
    };
  }
  const preferredPort = preferredEgressGatewayPort(input.key);
  for (let offset = 0; offset < EGRESS_GATEWAY_MAX_PORT_PROBES; offset += 1) {
    const port =
      EGRESS_GATEWAY_BASE_PORT +
      ((preferredPort - EGRESS_GATEWAY_BASE_PORT + offset) %
        EGRESS_GATEWAY_PORT_SPAN);
    try {
      const networkAttribution = networkAttributionMap(
        input.networkAttribution,
      );
      const state: EgressGatewayState = {
        key: input.key,
        port,
        server: createEgressGatewayServer(input.key),
        sockets: new Set(),
        settings: input.settings,
        principal: input.principal,
        networkAttribution,
        modelProviderNetworkHosts: declaredNetworkHostSet(
          input.modelProviderNetworkHosts,
        ),
        restrictToAttributedNetworkHosts:
          input.restrictToAttributedNetworkHosts ?? networkAttribution.size > 0,
        dnsLookupTimeoutMs:
          input.dnsLookupTimeoutMs ?? EGRESS_GATEWAY_DNS_LOOKUP_TIMEOUT_MS,
        ...(input.lookupHostname
          ? { lookupHostname: input.lookupHostname }
          : {}),
        ...(input.upstreamProxy ? { upstreamProxy: input.upstreamProxy } : {}),
        ...(input.publishRuntimeEvent
          ? { publishRuntimeEvent: input.publishRuntimeEvent }
          : {}),
      };
      await listen(state.server, port);
      gateways.set(input.key, state);
      if (offset > 0) {
        logger.warn(
          { key: input.key, preferredPort, port },
          'Egress gateway preferred port was unavailable; using next stable candidate',
        );
      }
      return { key: input.key, proxyUrl: `http://127.0.0.1:${port}/`, port };
    } catch (err) {
      if (!isListenCollision(err)) throw err;
    }
  }
  throw new Error(`No available egress gateway port for ${input.key}.`);
}

function createEgressGatewayServer(key: string): http.Server {
  const server = http.createServer((req, res) => {
    void handleHttpProxyRequest(key, req, res).catch((err) => {
      logger.warn({ err, key }, 'Egress gateway HTTP request failed');
      if (!res.headersSent) res.writeHead(502);
      res.end('Bad Gateway');
    });
  });
  server.on('connect', (req, socket, head) => {
    void handleConnectRequest(key, req, socket, head).catch((err) => {
      logger.warn({ err, key }, 'Egress gateway CONNECT failed');
      socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    });
  });
  server.on('connection', (socket) => {
    const state = gateways.get(key);
    if (state) trackGatewaySocket(state, socket);
  });
  server.on('clientError', (err, socket) => {
    logger.debug({ err, key }, 'Egress gateway client socket error');
    socket.destroy();
  });
  server.on('error', (err) => {
    logger.warn({ err, key }, 'Egress gateway server error');
  });
  return server;
}

async function handleConnectRequest(
  key: string,
  req: http.IncomingMessage,
  clientSocket: Duplex,
  head: Buffer,
): Promise<void> {
  const state = requireGatewayState(key);
  trackGatewaySocket(state, clientSocket);
  const target = parseConnectTarget(req.url || '');
  if (!target) {
    clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return;
  }
  const deny = evaluateEgressDenylist({
    settings: state.settings,
    host: target.host,
  });
  if (deny) {
    await auditConnect(state, {
      host: deny.host,
      allowed: false,
      denied: true,
      reason: deny.reason,
      matchedPattern: deny.matchedPattern,
    });
    writeDeniedConnect(clientSocket, deny);
    return;
  }
  const attributedTarget = await validateCapabilityAttributedTarget(
    state,
    target.host,
    target.port,
  );
  if (attributedTarget.deny) {
    await auditConnect(state, {
      host: attributedTarget.deny.host,
      port: target.port,
      allowed: false,
      denied: true,
      reason: attributedTarget.deny.reason,
      matchedPattern: attributedTarget.deny.matchedPattern,
    });
    writeDeniedConnect(clientSocket, attributedTarget.deny);
    return;
  }
  await auditConnect(state, {
    host: normalizeEgressHost(target.host),
    port: target.port,
    allowed: true,
    denied: false,
    reason: 'default_allow',
  });
  if (state.upstreamProxy) {
    await tunnelViaUpstreamProxy({
      upstream: state.upstreamProxy,
      target: { ...target, connectHost: attributedTarget.connectHost },
      clientSocket,
      head,
      trackSocket: (socket) => trackGatewaySocket(state, socket),
    });
    return;
  }
  await tunnelDirect({
    target: { ...target, connectHost: attributedTarget.connectHost },
    clientSocket,
    head,
    trackSocket: (socket) => trackGatewaySocket(state, socket),
  });
}

async function handleHttpProxyRequest(
  key: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const state = requireGatewayState(key);
  const target = parseHttpProxyTarget(req.url || '');
  if (!target) {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }
  const deny = evaluateEgressDenylist({
    settings: state.settings,
    host: target.hostname,
  });
  if (deny) {
    await auditConnect(state, {
      host: deny.host,
      allowed: false,
      denied: true,
      reason: deny.reason,
      matchedPattern: deny.matchedPattern,
    });
    res.writeHead(403, { 'content-type': 'application/json' });
    res.end(JSON.stringify(deniedBody(deny)));
    return;
  }
  const attributedTarget = await validateCapabilityAttributedTarget(
    state,
    target.hostname,
    urlPort(target),
  );
  if (attributedTarget.deny) {
    await auditConnect(state, {
      host: attributedTarget.deny.host,
      port: urlPort(target),
      allowed: false,
      denied: true,
      reason: attributedTarget.deny.reason,
      matchedPattern: attributedTarget.deny.matchedPattern,
    });
    res.writeHead(403, { 'content-type': 'application/json' });
    res.end(JSON.stringify(deniedBody(attributedTarget.deny)));
    return;
  }
  if (state.upstreamProxy && attributedTarget.connectHost) {
    const deny = capabilityHostDeny(
      normalizeEgressHost(target.hostname),
      `Capability-declared network host ${normalizeEgressHost(target.hostname)} cannot be DNS-pinned through an upstream HTTP proxy request.`,
    );
    await auditConnect(state, {
      host: deny.host,
      port: urlPort(target),
      allowed: false,
      denied: true,
      reason: deny.reason,
      matchedPattern: deny.matchedPattern,
    });
    res.writeHead(403, { 'content-type': 'application/json' });
    res.end(JSON.stringify(deniedBody(deny)));
    return;
  }
  await auditConnect(state, {
    host: normalizeEgressHost(target.hostname),
    port: urlPort(target),
    allowed: true,
    denied: false,
    reason: 'default_allow',
  });
  const upstream = state.upstreamProxy
    ? requestViaUpstreamProxy(state.upstreamProxy, req, target)
    : requestDirect(req, target, attributedTarget.connectHost);
  upstream.on('response', (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502);
    res.end('Bad Gateway');
  });
  req.pipe(upstream);
}

async function validateCapabilityAttributedTarget(
  state: EgressGatewayState,
  host: string,
  port: number,
): Promise<{
  connectHost?: string;
  deny?: { host: string; matchedPattern: string; reason: string };
}> {
  const normalizedHost = normalizeEgressHost(host);
  const authority = normalizedHost ? `${normalizedHost}:${port}` : undefined;
  if (!normalizedHost || !authority) {
    return {};
  }
  if (state.modelProviderNetworkHosts.has(authority)) {
    return {};
  }
  if (!state.networkAttribution.has(authority)) {
    return state.restrictToAttributedNetworkHosts
      ? {
          deny: capabilityHostDeny(
            normalizedHost,
            `Capability-declared network access did not declare ${authority}.`,
          ),
        }
      : {};
  }
  if (isIpAddress(normalizedHost)) {
    if (isPrivateNetworkAddress(normalizedHost)) {
      return {
        deny: capabilityHostDeny(
          normalizedHost,
          `Capability-declared network host ${normalizedHost} is private, loopback, or link-local.`,
        ),
      };
    }
    return { connectHost: normalizedHost };
  }
  if (!state.lookupHostname) {
    return {
      deny: capabilityHostDeny(
        normalizedHost,
        `Capability-declared network host ${normalizedHost} cannot be DNS-validated by this runtime.`,
      ),
    };
  }
  let records;
  try {
    records = await lookupHostnameWithDeadline({
      hostname: normalizedHost,
      lookupHostname: state.lookupHostname,
      timeoutMs: state.dnsLookupTimeoutMs,
      timeoutMessage: `Capability-declared network host ${normalizedHost} DNS validation timed out.`,
    });
  } catch {
    return {
      deny: capabilityHostDeny(
        normalizedHost,
        `Capability-declared network host ${normalizedHost} could not be resolved safely.`,
      ),
    };
  }
  if (records.length === 0) {
    return {
      deny: capabilityHostDeny(
        normalizedHost,
        `Capability-declared network host ${normalizedHost} did not resolve to a public address.`,
      ),
    };
  }
  const privateRecord = records.find((record) =>
    isPrivateNetworkAddress(record.address),
  );
  if (privateRecord) {
    return {
      deny: capabilityHostDeny(
        normalizedHost,
        `Capability-declared network host ${normalizedHost} resolved to private, loopback, or link-local address ${privateRecord.address}.`,
      ),
    };
  }
  return { connectHost: records[0]!.address };
}

function capabilityHostDeny(
  host: string,
  reason: string,
): { host: string; matchedPattern: string; reason: string } {
  return {
    host,
    matchedPattern: 'capability_network_host',
    reason,
  };
}

function trackGatewaySocket(state: EgressGatewayState, socket: Duplex): void {
  if (state.sockets.has(socket)) return;
  state.sockets.add(socket);
  const onError = (err: Error) => {
    logger.debug(
      { err, key: state.key, port: state.port },
      'Egress gateway socket error',
    );
  };
  socket.on('error', onError);
  socket.once('close', () => {
    state.sockets.delete(socket);
    socket.off('error', onError);
  });
}

async function closeGatewayState(state: EgressGatewayState): Promise<void> {
  state.server.closeIdleConnections?.();
  state.server.closeAllConnections?.();
  for (const socket of state.sockets) {
    socket.destroy();
  }
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(() => {
      logger.warn(
        { key: state.key, port: state.port, sockets: state.sockets.size },
        'Timed out closing egress gateway; continuing run finalization',
      );
      finish();
    }, EGRESS_GATEWAY_CLOSE_TIMEOUT_MS);
    timeout.unref?.();
    state.server.close(() => finish());
  });
}

function writeDeniedConnect(
  socket: Duplex,
  deny: { host: string; matchedPattern: string; reason: string },
): void {
  const body = JSON.stringify(deniedBody(deny));
  socket.end(
    [
      `HTTP/1.1 403 ${deniedConnectReasonPhrase(deny)}`,
      'content-type: application/json',
      `content-length: ${Buffer.byteLength(body)}`,
      '',
      body,
    ].join('\r\n'),
  );
}

function deniedConnectReasonPhrase(deny: {
  host: string;
  matchedPattern: string;
}): string {
  const message =
    deny.matchedPattern === 'capability_network_host'
      ? `Gantry blocked egress to ${deny.host}; request or update network access`
      : `Gantry blocked egress to ${deny.host}`;
  return sanitizeHttpReasonPhrase(message);
}

function sanitizeHttpReasonPhrase(value: string): string {
  const sanitized = value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\x20-\x7E]+/g, '')
    .slice(0, 180)
    .trim();
  return sanitized || 'Forbidden';
}

function deniedBody(deny: {
  host: string;
  matchedPattern: string;
  reason: string;
}): Record<string, string> {
  return {
    deniedHost: deny.host,
    matchedPattern: deny.matchedPattern,
    reason: deny.reason,
    ...(deny.matchedPattern === 'capability_network_host'
      ? { recovery: 'request or update network access' }
      : {}),
  };
}

async function auditConnect(
  state: EgressGatewayState,
  decision: {
    host: string;
    port?: number;
    allowed: boolean;
    denied: boolean;
    reason: string;
    matchedPattern?: string;
  },
): Promise<void> {
  const attribution =
    decision.port === undefined
      ? undefined
      : state.networkAttribution.get(
          `${normalizeEgressHost(decision.host)}:${decision.port}`,
        );
  const payload = {
    host: decision.host,
    principal: state.principal.agentId || state.principal.appId,
    allowed: decision.allowed,
    denied: decision.denied,
    reason: decision.reason,
    ...(decision.matchedPattern
      ? { matchedPattern: decision.matchedPattern }
      : {}),
    ...(attribution
      ? {
          capabilityId: attribution.capabilityId,
          capabilityLabel: attribution.capabilityLabel,
        }
      : {}),
    provider: state.upstreamProxy?.provider ?? 'direct',
    conversationId: state.principal.conversationId,
    runId: state.principal.runId,
  };
  logger.info(payload, 'Egress CONNECT decision');
  if (!state.publishRuntimeEvent) return;
  const eventConversationId = normalizeRuntimeEventConversationId(
    state.principal.conversationId as never,
  );
  try {
    await state.publishRuntimeEvent({
      appId: state.principal.appId as never,
      ...(state.principal.agentId
        ? { agentId: state.principal.agentId as never }
        : {}),
      ...(eventConversationId
        ? { conversationId: eventConversationId as never }
        : {}),
      eventType: RUNTIME_EVENT_TYPES.EGRESS_CONNECT as RuntimeEventType,
      actor: 'egress-gateway',
      responseMode: 'none',
      payload,
    });
  } catch (err) {
    logger.warn(
      { err, host: decision.host, principal: payload.principal },
      'Egress CONNECT audit persistence failed',
    );
  }
}

function requireGatewayState(key: string): EgressGatewayState {
  const state = gateways.get(key);
  if (!state) throw new Error(`Egress gateway state not found for ${key}.`);
  return state;
}

function parseConnectTarget(
  authority: string,
): { host: string; port: number; authority: string } | undefined {
  const parsed = parseAuthority(authority);
  if (!parsed) return undefined;
  return { ...parsed, authority };
}

function parseAuthority(
  authority: string,
): { host: string; port: number } | undefined {
  if (!authority.trim()) return undefined;
  const withScheme = `http://${authority}`;
  try {
    const parsed = new URL(withScheme);
    const host = normalizeEgressHost(parsed.hostname);
    const port = Number(parsed.port || 443);
    if (!host || !Number.isInteger(port) || port <= 0 || port > 65_535) {
      return undefined;
    }
    return { host, port };
  } catch {
    return undefined;
  }
}

function parseHttpProxyTarget(rawUrl: string): URL | undefined {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function urlPort(target: URL): number {
  return Number(target.port || (target.protocol === 'https:' ? 443 : 80));
}

function preferredEgressGatewayPort(key: string): number {
  const hash = createHash('sha256').update(key).digest();
  return (
    EGRESS_GATEWAY_BASE_PORT + (hash.readUInt32BE(0) % EGRESS_GATEWAY_PORT_SPAN)
  );
}

function listen(server: http.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

function isListenCollision(err: unknown): boolean {
  return (
    Boolean(err) &&
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    ((err as NodeJS.ErrnoException).code === 'EADDRINUSE' ||
      (err as NodeJS.ErrnoException).code === 'EACCES')
  );
}
