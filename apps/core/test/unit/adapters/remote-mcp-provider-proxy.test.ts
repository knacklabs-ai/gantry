import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { describe, expect, it } from 'vitest';

import {
  createSseEndpointCapture,
  proxyTarget,
  type SseProxyEndpointState,
} from '@core/adapters/llm/anthropic-claude-agent/inline-lane/remote-mcp-proxy.js';

async function captureEndpoint(
  configuredTarget: URL,
  state: SseProxyEndpointState,
  chunks: string[],
): Promise<void> {
  await pipeline(
    Readable.from(chunks),
    createSseEndpointCapture(configuredTarget, state),
    new Writable({ write: (_chunk, _encoding, callback) => callback() }),
  );
}

describe('inline remote MCP provider proxy confinement', () => {
  it('allows only the configured SSE endpoint and its advertised message endpoint', async () => {
    const configured = new URL('https://mcp.example/sse');
    const state: SseProxyEndpointState = {};

    expect(proxyTarget('/sse', configured, 'sse', state).href).toBe(
      configured.href,
    );
    expect(() =>
      proxyTarget('/messages?sessionId=session-1', configured, 'sse', state),
    ).toThrow('escaped its configured endpoint');

    await captureEndpoint(configured, state, [
      ': heartbeat\r\n\r\nevent: end',
      'point\r\ndata: /messages?sessionId=session-1\r\n\r\n',
    ]);

    expect(state.advertisedTarget?.href).toBe(
      'https://mcp.example/messages?sessionId=session-1',
    );
    expect(
      proxyTarget('/messages?sessionId=session-1', configured, 'sse', state)
        .href,
    ).toBe('https://mcp.example/messages?sessionId=session-1');
    expect(() =>
      proxyTarget('/messages?sessionId=other', configured, 'sse', state),
    ).toThrow('escaped its configured endpoint');
    expect(() => proxyTarget('/admin', configured, 'sse', state)).toThrow(
      'escaped its configured endpoint',
    );
  });

  it('rejects advertised SSE message endpoints on another origin', async () => {
    const configured = new URL('https://mcp.example/sse');
    const state: SseProxyEndpointState = {};

    await captureEndpoint(configured, state, [
      'event: endpoint\ndata: https://other.example/messages\n\n',
    ]);

    expect(state.advertisedTarget).toBeUndefined();
    expect(() => proxyTarget('/messages', configured, 'sse', state)).toThrow(
      'escaped its configured endpoint',
    );
  });
});
