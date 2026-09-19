/**
 * JSON Schema loader for the SOS 2.0 contract schemas in spec/contracts/.
 *
 * This is a SEPARATE subpath export (`@sos-2/contracts/schema-loader`) because
 * it requires ajv (a devDependency). The main package entry stays free of
 * runtime dependencies. Consumers that use the loader outside the development
 * workspace must provide ajv themselves.
 *
 * Repository location strategy (first match wins):
 *   1. explicit `root` argument
 *   2. SOS_REPO_ROOT environment variable
 *   3. walk up from process.cwd() (or the module's own location) until a
 *      directory containing spec/contracts/ is found
 *
 * Only top-level `*.schema.json` files are loaded. Instance documents (for
 * example spec/contracts/deltas/*.json) live in subdirectories and are never
 * mistaken for schemas.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Named import: ajv's dist/2020 typings pair `export default Ajv2020` with a
// CJS implementation; the named form resolves correctly under NodeNext for
// both types and runtime (Node's cjs-module-lexer detects exports.Ajv2020).
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv/dist/2020.js';

export class SchemaLoaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaLoaderError';
  }
}

/** Directory containing spec/contracts, verified to exist. */
export function findRepoRoot(startDir: string = process.cwd()): string {
  let dir = path.resolve(startDir);
  try {
    const stat = fs.statSync(dir);
    if (stat.isFile()) {
      dir = path.dirname(dir);
    }
  } catch {
    throw new SchemaLoaderError(`cannot resolve starting directory: ${startDir}`);
  }
  for (;;) {
    if (fs.existsSync(path.join(dir, 'spec', 'contracts'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new SchemaLoaderError(
        `could not locate the repository root (a directory containing spec/contracts) starting from ${startDir}`,
      );
    }
    dir = parent;
  }
}

export function resolveRepoRoot(explicit?: string): string {
  if (explicit !== undefined) {
    return path.resolve(explicit);
  }
  const fromEnv = process.env['SOS_REPO_ROOT'];
  if (fromEnv !== undefined && fromEnv !== '') {
    return path.resolve(fromEnv);
  }
  return findRepoRoot();
}

export interface LoadedContractSchema {
  /** Schema name derived from the file name, e.g. "trace-link". */
  name: string;
  /** Schema $id, e.g. "sos://schema/trace-link". */
  id: string | null;
  /** Raw parsed schema. */
  schema: Record<string, unknown>;
}

/**
 * Load every top-level contract schema from spec/contracts/.
 * Returns entries sorted by name (deterministic).
 */
export function loadSpecSchemas(root?: string): LoadedContractSchema[] {
  const repoRoot = resolveRepoRoot(root);
  const contractsDir = path.join(repoRoot, 'spec', 'contracts');
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(contractsDir, { withFileTypes: true });
  } catch (cause) {
    throw new SchemaLoaderError(`cannot read ${contractsDir}: ${String(cause)}`);
  }
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const loaded: LoadedContractSchema[] = [];
  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(contractsDir, file), 'utf8'));
    } catch (cause) {
      throw new SchemaLoaderError(`cannot parse ${file}: ${String(cause)}`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new SchemaLoaderError(`${file} is not a JSON Schema object`);
    }
    const schema = parsed as Record<string, unknown>;
    loaded.push({
      name: file.replace(/\.schema\.json$/, ''),
      id: typeof schema['$id'] === 'string' ? (schema['$id'] as string) : null,
      schema,
    });
  }
  if (loaded.length === 0) {
    throw new SchemaLoaderError(`no contract schemas found in ${contractsDir}`);
  }
  return loaded;
}

export interface ValidationResult {
  valid: boolean;
  /** Human-readable error list (empty when valid). */
  errors: string[];
}

export interface ContractValidator {
  /** Loaded schema names, sorted. */
  schemaNames(): string[];
  /** Map from schema name to its $id. */
  schemaIds(): Record<string, string | null>;
  /** Validate an instance against a schema (by name or $id). */
  validate(schemaName: string, instance: unknown): ValidationResult;
  /** Validate and throw on failure. */
  assertValid(schemaName: string, instance: unknown): void;
}

/**
 * Build an ajv (draft 2020-12) validator over the contract schemas.
 * Schemas are addressable both by name ("trace-link") and by $id
 * ("sos://schema/trace-link").
 */
export function createContractValidator(root?: string): ContractValidator {
  const loaded = loadSpecSchemas(root);
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const byKey = new Map<string, ValidateFunction>();
  const ids: Record<string, string | null> = {};
  for (const entry of loaded) {
    let validate: ValidateFunction;
    try {
      validate = ajv.compile(entry.schema);
    } catch (cause) {
      throw new SchemaLoaderError(`schema ${entry.name} failed to compile: ${String(cause)}`);
    }
    byKey.set(entry.name, validate);
    if (entry.id !== null) {
      byKey.set(entry.id, validate);
    }
    ids[entry.name] = entry.id;
  }
  const validate = (schemaName: string, instance: unknown): ValidationResult => {
    const fn = byKey.get(schemaName);
    if (fn === undefined) {
      throw new SchemaLoaderError(
        `unknown schema: ${schemaName} (loaded: ${loaded.map((e) => e.name).join(', ')})`,
      );
    }
    const ok = fn(instance);
    if (ok) {
      return { valid: true, errors: [] };
    }
    const errors = (fn.errors ?? []).map((error) => {
      const instancePath = error.instancePath === '' ? '<root>' : error.instancePath;
      return `${instancePath} ${error.message ?? 'is invalid'}`;
    });
    return { valid: false, errors };
  };
  return {
    schemaNames: () => loaded.map((entry) => entry.name),
    schemaIds: () => ids,
    validate,
    assertValid(schemaName: string, instance: unknown): void {
      const result = validate(schemaName, instance);
      if (!result.valid) {
        throw new SchemaLoaderError(
          `schema validation failed for ${schemaName}: ${result.errors.join('; ')}`,
        );
      }
    },
  };
}

/** Convenience: this module's own location, usable as a walk-up start point. */
export const moduleDir = path.dirname(fileURLToPath(import.meta.url));
