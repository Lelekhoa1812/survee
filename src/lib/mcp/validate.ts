/** A small checker for the JSON Schema subset published by the MCP tools. One schema, one set of rules. */

interface Schema {
  type?: string;
  anyOf?: Schema[];
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  enum?: unknown[];
  items?: Schema;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
}

/** Returns a short error, or null when the value matches. */
export function validateToolArgs(schema: Record<string, unknown>, value: unknown): string | null {
  return check(schema as Schema, value, "");
}

function check(schema: Schema, value: unknown, path: string): string | null {
  const where = path || "arguments";
  if (schema.anyOf) {
    const errors = schema.anyOf.map((option) => check(option, value, path));
    if (errors.some((error) => error === null)) return null;
    return `${where} must match one of the allowed types.`;
  }
  if (schema.type === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return `${where} must be an object.`;
    const rec = value as Record<string, unknown>;
    const props = schema.properties ?? {};
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(rec)) {
        if (!Object.prototype.hasOwnProperty.call(props, key)) return `Unknown field "${key}".`;
      }
    }
    for (const key of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(rec, key)) return `${key} is required.`;
    }
    for (const [key, child] of Object.entries(props)) {
      if (!Object.prototype.hasOwnProperty.call(rec, key)) continue;
      const nested = check(child, rec[key], path ? `${path}.${key}` : key);
      if (nested) return nested;
    }
    return null;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) return `${where} must be a list.`;
    if (schema.minItems !== undefined && value.length < schema.minItems) return `${where} must contain at least ${schema.minItems} item${schema.minItems === 1 ? "" : "s"}.`;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return `${where} must contain at most ${schema.maxItems} items.`;
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        const nested = check(schema.items, value[i], `${where}[${i}]`);
        if (nested) return nested;
      }
    }
    return null;
  }
  if (schema.type === "string") {
    if (typeof value !== "string") return `${where} must be a string.`;
    if (schema.minLength !== undefined && value.length < schema.minLength) return `${where} must contain at least ${schema.minLength} character${schema.minLength === 1 ? "" : "s"}.`;
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return `${where} must contain at most ${schema.maxLength} characters.`;
  } else if (schema.type === "boolean") {
    if (typeof value !== "boolean") return `${where} must be true or false.`;
  } else if (schema.type === "integer") {
    if (typeof value !== "number" || !Number.isInteger(value)) return `${where} must be an integer.`;
    if (schema.minimum !== undefined && value < schema.minimum) return `${where} must be at least ${schema.minimum}.`;
    if (schema.maximum !== undefined && value > schema.maximum) return `${where} must be at most ${schema.maximum}.`;
  } else if (schema.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return `${where} must be a number.`;
    if (schema.minimum !== undefined && value < schema.minimum) return `${where} must be at least ${schema.minimum}.`;
    if (schema.maximum !== undefined && value > schema.maximum) return `${where} must be at most ${schema.maximum}.`;
  } else if (schema.type === "null") {
    if (value !== null) return `${where} must be null.`;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    return `${where} must be one of ${schema.enum.map(String).join(", ")}.`;
  }
  return null;
}
