/**
 * @sos-2/contracts — the single normative source of SOS 2.0 contract TYPES.
 *
 * Every type here is aligned 1:1 with the JSON Schemas in spec/contracts/
 * (trace-link, architecture-delta, evidence, package, implementation-model).
 * The artifact envelope has no JSON Schema; this package IS its typed
 * contract (exact 8-field set from spec/meta-model.md).
 *
 * Guard strictness policy: guards never accept anything the corresponding
 * JSON Schema rejects, and never reject anything a legitimate SOS instance
 * needs. The only documented strengthenings are non-empty identifier strings
 * where a schema merely says "string" — no valid SOS artifact carries an
 * empty identifier.
 *
 * NOTE: the schema loader lives in the './schema-loader' subpath export
 * because it requires ajv (a devDependency). This main entry has zero
 * runtime dependencies.
 */

export * from './artifact-envelope.js';
export * from './artifact-kinds.js';
export * from './architecture-delta.js';
export * from './conformance.js';
export * from './evidence.js';
export * from './implementation-model.js';
export * from './package-record.js';
export * from './trace-links.js';
export * from './truth-states.js';
