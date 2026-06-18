export type McpToolResultValidationAudit = {
  outputSchemaPresent: boolean;
  structuredResultValidated: boolean;
  toolResultError: boolean;
};

export type McpToolResultValidationPlan = {
  validate(result: unknown): McpToolResultValidationAudit;
};

export class McpToolResultValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpToolResultValidationError';
  }
}

const SUPPORTED_SCHEMA_KEYS = new Set([
  '$schema',
  'additionalProperties',
  'const',
  'description',
  'enum',
  'items',
  'properties',
  'required',
  'title',
  'type',
]);

const SUPPORTED_JSON_TYPES = new Set([
  'array',
  'boolean',
  'integer',
  'null',
  'number',
  'object',
  'string',
]);

export function prepareMcpToolResultValidation(input: {
  serverName: string;
  toolName: string;
  outputSchema?: unknown;
}): McpToolResultValidationPlan {
  const outputSchema = input.outputSchema;
  if (outputSchema === undefined) {
    return {
      validate: (result) => ({
        outputSchemaPresent: false,
        structuredResultValidated: false,
        toolResultError: isMcpToolErrorResult(result),
      }),
    };
  }
  assertSupportedOutputSchema({ ...input, outputSchema });
  return {
    validate: (result) => {
      const toolResultError = isMcpToolErrorResult(result);
      if (toolResultError) {
        return {
          outputSchemaPresent: true,
          structuredResultValidated: false,
          toolResultError,
        };
      }
      const record = asRecord(result);
      if (!record || !Object.hasOwn(record, 'structuredContent')) {
        throw new McpToolResultValidationError(
          `MCP tool ${input.serverName}.${input.toolName} declared outputSchema but returned no structuredContent.`,
        );
      }
      const errors = validateJsonSchema(
        outputSchema,
        record.structuredContent,
        '',
      );
      if (errors.length > 0) {
        throw new McpToolResultValidationError(
          `MCP tool ${input.serverName}.${input.toolName} structuredContent failed outputSchema validation: ${errors.slice(0, 3).join('; ')}.`,
        );
      }
      return {
        outputSchemaPresent: true,
        structuredResultValidated: true,
        toolResultError,
      };
    },
  };
}

function assertSupportedOutputSchema(input: {
  serverName: string;
  toolName: string;
  outputSchema: unknown;
}): void {
  assertSupportedJsonSchema(
    input.outputSchema,
    '',
    input.serverName,
    input.toolName,
  );
}

function assertSupportedJsonSchema(
  schema: unknown,
  path: string,
  serverName: string,
  toolName: string,
): void {
  if (typeof schema === 'boolean') return;
  const record = asRecord(schema);
  if (!record) {
    throw new McpToolResultValidationError(
      `MCP tool ${serverName}.${toolName} provided an invalid outputSchema.`,
    );
  }
  for (const key of Object.keys(record)) {
    if (!SUPPORTED_SCHEMA_KEYS.has(key)) {
      throw unsupportedSchemaKeyword(serverName, toolName, path, key);
    }
  }
  assertSupportedSchemaType(record.type, path, serverName, toolName);
  if (
    record.additionalProperties !== undefined &&
    typeof record.additionalProperties !== 'boolean'
  ) {
    throw unsupportedSchemaKeyword(
      serverName,
      toolName,
      path,
      'additionalProperties',
    );
  }
  const properties = asRecord(record.properties);
  if (properties) {
    for (const [key, childSchema] of Object.entries(properties)) {
      assertSupportedJsonSchema(
        childSchema,
        joinPath(path, key),
        serverName,
        toolName,
      );
    }
  }
  if (record.items !== undefined) {
    assertSupportedJsonSchema(
      record.items,
      joinPath(path, 'items'),
      serverName,
      toolName,
    );
  }
}

function assertSupportedSchemaType(
  type: unknown,
  path: string,
  serverName: string,
  toolName: string,
): void {
  if (type === undefined) return;
  const types = Array.isArray(type) ? type : [type];
  if (
    types.length === 0 ||
    types.some(
      (candidate) =>
        typeof candidate !== 'string' || !SUPPORTED_JSON_TYPES.has(candidate),
    )
  ) {
    throw unsupportedSchemaKeyword(serverName, toolName, path, 'type');
  }
}

function unsupportedSchemaKeyword(
  serverName: string,
  toolName: string,
  path: string,
  key: string,
): McpToolResultValidationError {
  return new McpToolResultValidationError(
    `MCP tool ${serverName}.${toolName} outputSchema uses unsupported keyword ${displayPath(joinPath(path, key))}.`,
  );
}

function isMcpToolErrorResult(result: unknown): boolean {
  const record = asRecord(result);
  return record?.isError === true;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function validateJsonSchema(
  schema: unknown,
  value: unknown,
  path: string,
): string[] {
  if (schema === true) return [];
  if (schema === false) return [`${displayPath(path)} is not allowed`];
  const record = asRecord(schema);
  if (!record) return [`${displayPath(path)} schema is invalid`];
  const typeErrors = validateType(record.type, value, path);
  if (typeErrors.length > 0) return typeErrors;
  if (
    Array.isArray(record.enum) &&
    !record.enum.some((item) => sameJson(item, value))
  ) {
    return [`${displayPath(path)} must match one of the enum values`];
  }
  if ('const' in record && !sameJson(record.const, value)) {
    return [`${displayPath(path)} must match const`];
  }
  const errors: string[] = [];
  const properties = asRecord(record.properties);
  if (properties) {
    const objectValue = asRecord(value);
    for (const key of requiredKeys(record.required)) {
      if (!objectValue || !(key in objectValue)) {
        errors.push(`${displayPath(joinPath(path, key))} is required`);
      }
    }
    if (objectValue) {
      for (const [key, childSchema] of Object.entries(properties)) {
        if (key in objectValue) {
          errors.push(
            ...validateJsonSchema(
              childSchema,
              objectValue[key],
              joinPath(path, key),
            ),
          );
        }
      }
      if (record.additionalProperties === false) {
        for (const key of Object.keys(objectValue)) {
          if (!(key in properties)) {
            errors.push(`${displayPath(joinPath(path, key))} is not allowed`);
          }
        }
      }
    }
  }
  if (Array.isArray(value) && record.items !== undefined) {
    value.forEach((item, index) => {
      errors.push(
        ...validateJsonSchema(
          record.items,
          item,
          joinPath(path, String(index)),
        ),
      );
    });
  }
  return errors;
}

function validateType(type: unknown, value: unknown, path: string): string[] {
  if (type === undefined) return [];
  const types = Array.isArray(type) ? type : [type];
  if (types.some((candidate) => jsonTypeMatches(candidate, value))) return [];
  return [`${displayPath(path)} must be ${types.join(' or ')}`];
}

function jsonTypeMatches(type: unknown, value: unknown): boolean {
  switch (type) {
    case 'null':
      return value === null;
    case 'boolean':
      return typeof value === 'boolean';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'string':
      return typeof value === 'string';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return Boolean(asRecord(value));
    default:
      return true;
  }
}

function requiredKeys(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function joinPath(path: string, key: string): string {
  return `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
}

function displayPath(path: string): string {
  return path || '/';
}

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return Object.is(left, right);
  }
}
