/**
 * Capability-based body selection (Work Order P5).
 *
 * spec/productization-execution-architecture.md §3: "SOS chooses a body
 * from declared capabilities, not vendor identity."
 *
 * Selection inputs carry NO vendor fields on the selection path: the
 * algorithm reads body_id, capabilities (the §3 advertisement), health
 * and placement ONLY. The provider block exists on the registration for
 * provenance but is structurally irrelevant here — vendor identity can
 * never be a selection key (pinned by tests that flip provider names
 * without changing the outcome).
 */

import { InvalidBodyRecordError } from './errors.js';
import { isSelectableHealth } from './body-health.js';
import type { BodyRegistration } from './body-identity.js';
import { assertValidBodyId } from './body-identity.js';
import type { HarnessCapability } from '@sos-2/harness';
import { HARNESS_CAPABILITIES } from '@sos-2/harness';

/** What a task needs from a body. */
export interface BodySelectionRequirements {
  /** Required §3 capabilities (non-empty, from the vocabulary). */
  readonly requiredCapabilities: readonly HarnessCapability[];
  /**
   * Required placement (§7), or null for any. "cloud" and "remote"
   * bodies keep working while the user's device is offline;
   * "user-device" bodies do not.
   */
  readonly placement: 'cloud' | 'remote' | 'user-device' | null;
}

/** The outcome of a body selection. */
export type BodySelectionResult =
  | {
      readonly status: 'SELECTED';
      readonly body: BodyRegistration;
      /** Deterministic consideration order — traceability. */
      readonly considered: readonly BodyRegistration[];
      readonly reason: string;
    }
  | {
      readonly status: 'NO_BODY_AVAILABLE';
      readonly body: null;
      readonly considered: readonly BodyRegistration[];
      readonly reason: string;
    };

const REQUIREMENTS_NAMESPACE = 'body-selection-requirements';

/** Validate selection requirements (throws InvalidBodyRecordError). */
export function assertValidBodySelectionRequirements(value: unknown): asserts value is BodySelectionRequirements {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidBodyRecordError(REQUIREMENTS_NAMESPACE, 'body selection requirements must be an object');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 2 || !keys.includes('requiredCapabilities') || !keys.includes('placement')) {
    throw new InvalidBodyRecordError(
      REQUIREMENTS_NAMESPACE,
      'body selection requirements must have the exact field set { requiredCapabilities, placement }',
    );
  }
  const required = record['requiredCapabilities'];
  if (
    !Array.isArray(required) ||
    required.length === 0 ||
    !required.every((entry) => typeof entry === 'string' && (HARNESS_CAPABILITIES as readonly string[]).includes(entry)) ||
    new Set(required as string[]).size !== (required as string[]).length
  ) {
    throw new InvalidBodyRecordError(
      REQUIREMENTS_NAMESPACE,
      `requiredCapabilities must be a non-empty, duplicate-free array from [${HARNESS_CAPABILITIES.join(', ')}]`,
    );
  }
  const placement = record['placement'];
  if (placement !== null && !['cloud', 'remote', 'user-device'].includes(String(placement))) {
    throw new InvalidBodyRecordError(
      REQUIREMENTS_NAMESPACE,
      `placement must be cloud | remote | user-device | null, received: ${JSON.stringify(placement)}`,
    );
  }
}

/**
 * Select a body for the requirements — CAPABILITY-BASED, deterministic,
 * vendor-blind:
 *
 *   - only AVAILABLE bodies are selectable (suspended/released never are);
 *   - the body's advertised capabilities must cover every required
 *     capability;
 *   - the placement filter applies when specified;
 *   - ties break by REGISTRATION ORDER (stable) — the earliest
 *     registered matching body wins; provider/vendor fields are never
 *     consulted.
 */
export function selectBody(
  requirements: BodySelectionRequirements,
  bodies: readonly BodyRegistration[],
): BodySelectionResult {
  assertValidBodySelectionRequirements(requirements);
  for (const body of bodies) {
    assertValidBodyId(body.body_id);
  }

  const eligible = bodies.filter((body) => {
    if (!isSelectableHealth(body.health)) {
      return false;
    }
    if (requirements.placement !== null && body.placement !== requirements.placement) {
      return false;
    }
    return requirements.requiredCapabilities.every((capability) => body.capabilities.capabilities.includes(capability));
  });

  if (eligible.length === 0) {
    const reason =
      bodies.length === 0
        ? 'no bodies are registered with the broker'
        : requirements.placement === null
          ? `no AVAILABLE registered body advertises all required capabilities [${requirements.requiredCapabilities.join(', ')}]`
          : `no AVAILABLE registered body with placement ${requirements.placement} advertises all required capabilities [${requirements.requiredCapabilities.join(', ')}]`;
    return { status: 'NO_BODY_AVAILABLE', body: null, considered: eligible, reason };
  }

  // Registration order (stable) — vendor identity is never a key.
  const selected = eligible[0]!;
  const reason = `capability-based selection: body ${JSON.stringify(selected.body_id)} advertises every required capability [${requirements.requiredCapabilities.join(', ')}] and is AVAILABLE (selected by registration order; vendor identity is never a selection key)`;
  return { status: 'SELECTED', body: selected, considered: eligible, reason };
}
