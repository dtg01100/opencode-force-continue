import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DIR = join(__dirname, "..", "schemas");

let schemaCache = {};

function loadSchema(name) {
  if (schemaCache[name]) return schemaCache[name];
  const schemaPath = join(SCHEMAS_DIR, name);

  if (!existsSync(schemaPath)) {
    // Provide a helpful, actionable error message instead of a raw exception
    const msg = `Schema not found: ${schemaPath}\n` +
      `Expected schema file '${name}' in '${SCHEMAS_DIR}'.\n` +
      `If this project was installed from npm, ensure the package includes the 'schemas/' directory or run the local setup (e.g. 'npm run setup:local').`;
    const e = new Error(msg);
    e.name = "SchemaNotFoundError";
    throw e;
  }

  try {
    const raw = readFileSync(schemaPath, "utf-8");
    const schema = JSON.parse(raw);
    schemaCache[name] = schema;
    return schema;
  } catch (err) {
    // Wrap parsing/read errors with context so callers get actionable info
    const msg = `Failed to load or parse schema '${name}' at ${schemaPath}: ${err.message}`;
    const e = new Error(msg);
    e.name = "SchemaLoadError";
    throw e;
  }
}

function getType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function validateType(value, expectedType, path) {
  const actualType = getType(value);
  if (expectedType === "integer") {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      return { valid: false, errors: [{ path, message: `Expected integer, got ${actualType}` }] };
    }
  } else if (actualType !== expectedType) {
    return { valid: false, errors: [{ path, message: `Expected ${expectedType}, got ${actualType}` }] };
  }
  return { valid: true, errors: [] };
}

function validateEnum(value, enumValues, path) {
  if (!enumValues.includes(value)) {
    return { valid: false, errors: [{ path, message: `Value must be one of: ${enumValues.join(", ")}` }] };
  }
  return { valid: true, errors: [] };
}

function validateMinimum(value, minimum, path) {
  if (typeof value === "number" && value < minimum) {
    return { valid: false, errors: [{ path, message: `Value ${value} is less than minimum ${minimum}` }] };
  }
  return { valid: true, errors: [] };
}

function validateConst(value, constValue, path) {
  if (value !== constValue) {
    return { valid: false, errors: [{ path, message: `Value must equal: ${constValue}` }] };
  }
  return { valid: true, errors: [] };
}

function validateAgainstSchema(value, schema, path = "") {
  const errors = [];

  if (schema.if) {
    const ifResult = validateAgainstSchema(value, schema.if, path);
    if (ifResult.valid && schema.then) {
      const thenResult = validateAgainstSchema(value, schema.then, path);
      errors.push(...thenResult.errors);
    }
    if (!ifResult.valid && schema.else) {
      const elseResult = validateAgainstSchema(value, schema.else, path);
      errors.push(...elseResult.errors);
    }
  }

  if (schema.allOf) {
    for (const branchSchema of schema.allOf) {
      const branchResult = validateAgainstSchema(value, branchSchema, path);
      errors.push(...branchResult.errors);
    }
  }

  if (schema.type) {
    const typeResult = validateType(value, schema.type, path);
    errors.push(...typeResult.errors);
    if (!typeResult.valid && schema.type !== "object" && schema.type !== "array") {
      return { valid: false, errors };
    }
  }

  if (schema.enum) {
    const enumResult = validateEnum(value, schema.enum, path);
    errors.push(...enumResult.errors);
    if (!enumResult.valid) return { valid: false, errors };
  }

  if (schema.const !== undefined) {
    const constResult = validateConst(value, schema.const, path);
    errors.push(...constResult.errors);
    if (!constResult.valid) return { valid: false, errors };
  }

  if (schema.minimum !== undefined && typeof value === "number") {
    const minResult = validateMinimum(value, schema.minimum, path);
    errors.push(...minResult.errors);
  }

  if (schema.type === "object" && typeof value === "object" && value !== null && !Array.isArray(value)) {
    if (schema.required) {
      for (const req of schema.required) {
        if (!(req in value)) {
          errors.push({ path: `${path}.${req}`, message: `Missing required property: ${req}` });
        }
      }
    }

    if (schema.properties) {
      for (const [prop, propSchema] of Object.entries(schema.properties)) {
        if (prop in value) {
          const propResult = validateAgainstSchema(value[prop], propSchema, `${path}.${prop}`);
          errors.push(...propResult.errors);
        }
      }
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!schema.properties || !(key in schema.properties)) {
          errors.push({ path: `${path}.${key}`, message: `Unknown property: ${key}` });
        }
      }
    }
  }

  if (schema.type === "array" && Array.isArray(value)) {
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        const itemResult = validateAgainstSchema(value[i], schema.items, `${path}[${i}]`);
        errors.push(...itemResult.errors);
      }
    }
  }

    if (schema.oneOf) {
        const validBranches = [];
        for (const branchSchema of schema.oneOf) {
          const branchResult = validateAgainstSchema(value, branchSchema, path);
          if (branchResult.valid) {
            validBranches.push(branchSchema);
          }
        }
        if (validBranches.length === 0) {
          errors.push({ path, message: "Value does not match one of the expected schemas" });
        }
      }

  return { valid: errors.length === 0, errors };
}

export function validateConfig(config) {
  const schema = loadSchema("config.schema.json");
  return validateAgainstSchema(config, schema, "config");
}

export function validateSessionState(state) {
  const schema = loadSchema("session-state.schema.json");
  return validateAgainstSchema(state, schema, "state");
}

export function validateToolInput(toolName, input) {
  const schema = loadSchema(`tool-inputs/${toolName}.schema.json`);
  return validateAgainstSchema(input, schema, toolName);
}

export { validateAgainstSchema, loadSchema };
