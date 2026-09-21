/**
 * Fail-closed environment loading (Work Order P3).
 *
 * loadEnvironment(tier, source) turns an INJECTED raw record into a typed
 * EnvironmentRecord:
 *
 *   - missing REQUIRED variable => EnvironmentValidationError NAMING the
 *     variable (never a silent default, never an empty-string fallback);
 *   - invalid shape (bad URL, empty token, malformed path) => typed error
 *     naming the variable and the violated shape — without echoing the
 *     value (shapes are checked structurally; messages never embed values);
 *   - LOCAL fixture defaults are applied ONLY for the local tier, only for
 *     variables whose registry requirement for local is 'fixture-default',
 *     and every applied fixture is visibly marked in the record;
 *   - secret values NEVER live in enumerable properties: they are captured
 *     in a closure and reachable only through getSecretValue(name). They
 *     are therefore structurally impossible to serialize —
 *     serializeEnvironment() produces the redacted, log-safe view.
 */

import {
  EnvironmentValidationError,
  assertRawSourceShape,
  type EnvironmentTier,
  type RawEnvironmentSource,
} from '../core/types.ts';
import {
  ENVIRONMENT_VARIABLE_REGISTRY,
  looksSecretShapedByName,
  variableSpec,
} from './schema.ts';

/** Shape validation (structural; error messages carry names, not values). */
export function validateValueShape(name: string, shape: string, value: string): void {
  const fail = (reason: string): never => {
    throw new EnvironmentValidationError(`environment variable ${name} violates shape '${shape}': ${reason}`);
  };
  if (value.length === 0) fail('value is empty');
  switch (shape) {
    case 'non-empty':
      return;
    case 'token': {
      if (value.length < 8) fail('token-class value is too short to be real (min 8 chars)');
      if (/\s/.test(value)) fail('token-class value contains whitespace');
      return;
    }
    case 'url': {
      if (!/^https?:\/\/[^\s]+$/.test(value)) fail('must be an http(s) URL');
      return;
    }
    case 'https-url': {
      // Deployed tiers must use https; the DOCUMENTED exception is the
      // local fixture origin (http://localhost[:port]) — visible, bounded,
      // never applicable to preview/production values.
      if (/^https:\/\/[^\s]+$/.test(value)) return;
      if (/^http:\/\/localhost(:\d+)?(\/[^\s]*)?$/.test(value)) return;
      return fail('must be an https URL (the only exception is the documented local fixture origin http://localhost)');
    }
    case 'postgres-url': {
      if (!/^postgres(ql)?:\/\/[^\s]+$/.test(value)) fail('must be a postgres:// connection URL');
      return;
    }
    case 'relative-path': {
      if (/^([a-zA-Z]+:)?\//.test(value)) fail('must be a relative path inside the monorepo');
      if (value.includes('..')) fail('must not traverse upward (..)');
      return;
    }
    case 'lowercase-identifier': {
      if (!/^[a-z0-9][a-z0-9._/-]*$/.test(value)) fail('must be a lowercase identifier/path segment set');
      return;
    }
    default:
      return fail(`unknown shape '${shape as string}' in registry — fail-closed`);
  }
}

/** A value loaded for a public (non-secret) variable. */
export interface PublicVariableValue {
  readonly name: string;
  readonly value: string;
  readonly source: 'provided' | 'local-fixture';
}

/**
 * The typed environment record. Secret values are held in a closure and
 * exposed ONLY via getSecretValue(); every enumerable surface (vars,
 * missing, fixtureNames, extraNames, serializeEnvironment) is redacted by
 * construction.
 */
export interface EnvironmentRecord {
  readonly tier: EnvironmentTier;
  readonly loadedAtNote: string;
  /** Public (non-secret) values, in registry order then extras. */
  readonly vars: readonly PublicVariableValue[];
  /** Names of REQUIRED-but-missing variables (always [] after successful load). */
  readonly missing: readonly string[];
  /** Names whose value came from the documented LOCAL fixture default. */
  readonly fixtureNames: readonly string[];
  /** Unregistered variable names that were present (kept, classified). */
  readonly extraNames: readonly string[];
  /** Secret variable names that are present (names only — values are never enumerable). */
  readonly secretNames: readonly string[];
  /** Sole accessor for a secret value; throws on unknown/absent name. */
  getSecretValue(name: string): string;
  /** Log-safe serialized view: secret values redacted, fixtures marked. */
  serialize(): string;
}

const NOT_YET_DEPLOYED_NOTE =
  'configuration contract verification only — no validation account exists yet (NOT_YET_DEPLOYED)';

/**
 * Load and validate an environment for a tier from an injected raw source.
 * Deterministic: no clock, no entropy, no process.env, no network.
 */
export function loadEnvironment(tier: EnvironmentTier, source: RawEnvironmentSource): EnvironmentRecord {
  assertRawSourceShape(source, `tier '${tier}'`);

  const missing: string[] = [];
  const publicVars: PublicVariableValue[] = [];
  const fixtureNames: string[] = [];
  const secretNames: string[] = [];
  const secretValues = new Map<string, string>();
  const extras: string[] = [];
  const extraSecrets = new Set<string>();

  // 1. Registry variables, in registry order.
  for (const spec of ENVIRONMENT_VARIABLE_REGISTRY) {
    const requirement = spec.requirement[tier];
    if (requirement === undefined) {
      // Variable not part of this tier's contract. If present anyway it is
      // recorded as an extra (and fail-closed classified if secret-shaped).
      if (source[spec.name] !== undefined) {
        extras.push(spec.name);
        if (spec.secret) extraSecrets.add(spec.name);
      }
      continue;
    }
    const provided = source[spec.name];
    if (provided !== undefined && provided.length > 0) {
      validateValueShape(spec.name, spec.shape, provided);
      if (spec.secret) {
        secretNames.push(spec.name);
        secretValues.set(spec.name, provided);
      } else {
        publicVars.push({ name: spec.name, value: provided, source: 'provided' });
      }
      continue;
    }
    if (requirement === 'required') {
      missing.push(spec.name); // collected, then one typed failure naming ALL missing
      continue;
    }
    if (requirement === 'fixture-default') {
      // LOCAL fixture defaults only — the registry gates this by tier, but
      // the loader enforces the tier gate again independently (defense in
      // depth: preview/production can NEVER receive a fixture value).
      if (tier !== 'local' || spec.localFixtureDefault === undefined) {
        throw new EnvironmentValidationError(
          `environment variable ${spec.name} declares a fixture default but tier '${tier}' is not eligible for fixtures (loader tier gate)`,
        );
      }
      const fixtureValue = spec.localFixtureDefault;
      validateValueShape(spec.name, spec.shape, fixtureValue);
      if (spec.secret) {
        secretNames.push(spec.name);
        secretValues.set(spec.name, fixtureValue);
        fixtureNames.push(spec.name); // name-only provenance: the fixture ORIGIN is visible, the value never is
      } else {
        publicVars.push({ name: spec.name, value: fixtureValue, source: 'local-fixture' });
        fixtureNames.push(spec.name);
      }
      continue;
    }
    // 'optional' and absent => recorded absent (no defaulting).
  }

  // The tier contract may be asserted separately; loading itself only
  // validates shape and completeness (see assertRequiredSecretsPresent in
  // the secrets policy for the names-only presence check).
  if (missing.length > 0) {
    throw new EnvironmentValidationError(
      `tier '${tier}' is missing REQUIRED environment variables (fail-closed, no silent defaults): ` +
        `${missing.join(', ')} — provide each variable explicitly; missing values are never defaulted`,
    );
  }

  // 2. Unregistered variables: kept (recorded), secret-shaped ones captured
  //    as secrets (fail-closed classification), never defaulted.
  const known = new Set(ENVIRONMENT_VARIABLE_REGISTRY.map((spec) => spec.name));
  for (const [name, value] of Object.entries(source)) {
    if (known.has(name)) continue;
    if (value.length === 0) continue;
    extras.push(name);
    if (looksSecretShapedByName(name)) {
      extraSecrets.add(name);
      secretValues.set(name, value);
    } else {
      publicVars.push({ name, value, source: 'provided' });
    }
  }

  const extraNames = extras.filter((name) => !extraSecrets.has(name));
  const allSecretNames = [...secretNames, ...extraSecrets];

  return {
    tier,
    loadedAtNote: NOT_YET_DEPLOYED_NOTE,
    vars: publicVars,
    missing,
    fixtureNames,
    extraNames,
    secretNames: allSecretNames,
    getSecretValue(name: string): string {
      const value = secretValues.get(name);
      if (value === undefined) {
        throw new EnvironmentValidationError(
          `secret variable '${name}' is not present in the loaded tier '${tier}' environment (names only are ever reported)`,
        );
      }
      return value;
    },
    serialize(): string {
      const view = {
        tier,
        note: NOT_YET_DEPLOYED_NOTE,
        publicVars: publicVars.map((v) => ({
          name: v.name,
          value: v.value,
          source: v.source,
        })),
        fixtures: fixtureNames,
        extras: extraNames,
        secrets: allSecretNames.map((name) => ({ name, value: '[REDACTED]' })),
      };
      return JSON.stringify(view);
    },
  };
}

/** Log-safe serialized view (the ONLY serialization path). */
export function serializeEnvironment(record: EnvironmentRecord): string {
  return record.serialize();
}

/** Re-exported for one-stop schema access from the environment layer. */
export { variableSpec };
