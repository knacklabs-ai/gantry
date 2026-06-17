import fs from 'node:fs';

const DEFAULT_SMOKE_ENV_FILE = '/tmp/gantry-runtime-smoke.env';

function stripQuotes(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseEnvFile(file) {
  try {
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .reduce((values, line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return values;
        const match = /^([A-Z0-9_]+)=(.*)$/.exec(trimmed);
        if (!match) return values;
        values[match[1]] = stripQuotes(match[2]);
        return values;
      }, {});
  } catch {
    return {};
  }
}

export function parseRuntimeSmokeEnv(
  file = process.env.GANTRY_RUNTIME_SMOKE_ENV || DEFAULT_SMOKE_ENV_FILE,
) {
  const fileValues = parseEnvFile(file);
  const expectedRuntimeInstances = Math.max(
    1,
    Number(
      process.env.GANTRY_EXPECTED_RUNTIME_INSTANCES ||
        fileValues.GANTRY_EXPECTED_RUNTIME_INSTANCES ||
        1,
    ),
  );
  return {
    controlPort:
      process.env.GANTRY_CONTROL_PORT || fileValues.GANTRY_CONTROL_PORT || '',
    controlToken:
      process.env.GANTRY_SMOKE_CONTROL_TOKEN ||
      fileValues.GANTRY_SMOKE_CONTROL_TOKEN ||
      '',
    gantryDevLog: process.env.GANTRY_DEV_LOG || fileValues.GANTRY_DEV_LOG || '',
    expectedRuntimeInstances,
    path: file,
  };
}
