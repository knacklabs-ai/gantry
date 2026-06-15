import { afterEach, describe, expect, it } from 'vitest';

import {
  baseInput,
  createRunnerFixture,
  readRecord,
  readRunnerOutputs,
  registerRunnerFixtureCleanup,
  runRunner,
} from './agent-runner-ipc.test-helpers.js';

registerRunnerFixtureCleanup(afterEach);

const SPIKE_TIMEOUT_MS = 35_000;

describe('warm-pool spike: SDK warm primitive', () => {
  it(
    'boots via startup() and serves one query() with no re-spawn (F10)',
    async () => {
      const fx = createRunnerFixture();
      // GANTRY_WARM_POOL_BOOT=generic makes the runner take the startup() path
      // (Task 1.2). The bind is delivered via GANTRY_SPIKE_BIND (test-only fast
      // path; production uses the IPC bind channel).
      await runRunner(fx, baseInput({ warmGenericBoot: true }), {
        GANTRY_WARM_POOL: '1',
        // A deliberate 2nd warm.query() (test-only hook) proves the SDK's
        // single-use guard fires; production binds exactly once per worker.
        GANTRY_SPIKE_DOUBLE_QUERY: '1',
        GANTRY_SPIKE_BIND: JSON.stringify({
          chatJid: 'wa:111',
          firstMessage: 'do you have kaju katli?',
          memoryBlock: '',
        }),
      });
      const rec = readRecord(fx.recordPath);
      expect(rec.startupCalls).toBe(1); // startup() invoked once
      expect(rec.calls.length).toBe(1); // exactly one query() = no re-spawn
      expect(rec.warmQueryDoubleCallThrew).toBe(true); // single-use enforced
    },
    SPIKE_TIMEOUT_MS,
  );

  it(
    'delivers first message + context at bind, not at boot (F3)',
    async () => {
      const fx = createRunnerFixture();
      await runRunner(fx, baseInput({ warmGenericBoot: true }), {
        GANTRY_WARM_POOL: '1',
        GANTRY_SPIKE_BIND: JSON.stringify({
          chatJid: 'wa:111',
          firstMessage: 'do you have kaju katli?',
          memoryBlock: 'MEM-111',
        }),
      });
      const rec = readRecord(fx.recordPath);
      const call = rec.calls[0];
      expect(call?.promptKind).toBe('stream');
      const text = JSON.stringify(call?.streamMessages);
      expect(text).toContain('do you have kaju katli?'); // bound first message rode the stream
      expect(text).toContain('MEM-111'); // memory block rode the stream
      expect(call?.systemPromptAppend ?? '').not.toContain('wa:111'); // identity NOT in boot prompt
    },
    SPIKE_TIMEOUT_MS,
  );

  it(
    'warm-bound first reply emits dispatchedAt and no runnerStartup (F1)',
    async () => {
      const fx = createRunnerFixture();
      const { stdout } = await runRunner(
        fx,
        baseInput({ warmGenericBoot: true }),
        {
          GANTRY_WARM_POOL: '1',
          GANTRY_SPIKE_BIND: JSON.stringify({
            chatJid: 'wa:111',
            firstMessage: 'hi',
            memoryBlock: '',
          }),
        },
      );
      const outputs = readRunnerOutputs(stdout);
      // The reply envelope is the one carrying the warm dispatch mark. A warm
      // worker's firstSdkMessageAt predates bind, so runnerStartup would
      // mis-route the trace; it must be suppressed in favor of dispatchedAt.
      const reply = outputs.find((o) => o.dispatchedAt !== undefined);
      expect(reply, JSON.stringify(outputs)).toBeDefined();
      expect(reply?.dispatchedAt as number).toBeGreaterThan(0);
      expect(reply?.runnerStartup).toBeUndefined();
      // No envelope anywhere should carry runnerStartup for a warm-bound run.
      expect(
        outputs.some((o) => o.runnerStartup !== undefined),
        JSON.stringify(outputs),
      ).toBe(false);
    },
    SPIKE_TIMEOUT_MS,
  );
});
