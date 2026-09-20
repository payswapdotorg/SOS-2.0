/**
 * Composition members and bindings — the typed wiring model of a
 * PackageComposition (spec/architecture.md §5: "Package Composition:
 * first-class reusable composition with independent evidence"; R25).
 *
 * A composition declares:
 *   - MEMBERS (>= 2): the member packages, each bound into a ROLE with the
 *     member contracts used in this composition. The same package may
 *     occupy two roles (e.g. two cache instances); roles are unique;
 *   - BINDINGS (>= 1): the typed wiring between roles — the binding kind
 *     vocabulary is frozen (PROVIDES_TO, CONSUMES_FROM, CONFIGURES,
 *     DATA_FLOW, CONTROL_FLOW), every binding cites the contract it
 *     realizes and carries a structured wiring description.
 *
 * Layered validation (documented):
 *   - composition layer (this module): roles unique, member ids are
 *     well-formed sos://Package ids, binding endpoints are declared roles,
 *     no self-bindings, binding contracts non-empty, wiring is a plain JSON
 *     object;
 *   - registry layer (@sos-2/registry): members are REGISTERED packages and
 *     every member's bound contracts exist in that member's declared
 *     contracts (reuse never bypasses compatibility —
 *     spec/architecture-lock.md).
 */

import { isArtifactId, parseArtifactId } from '@sos-2/semantic-spine';
import type { JsonValue } from '@sos-2/semantic-spine';
import { CompositionError } from './errors.js';

/** A member package bound into a role within the composition. */
export interface CompositionMember {
  /** Spine artifact id of the member Package (sos://Package/<segment>). */
  package_id: string;
  /** The member's role name in THIS composition (unique, non-empty). */
  role: string;
  /** Member contracts bound into this composition (non-empty; registry-checked against the member). */
  bound_contracts: string[];
}

/** The frozen binding kinds of the wiring model. */
export const COMPOSITION_BINDING_KINDS = [
  'PROVIDES_TO',
  'CONSUMES_FROM',
  'CONFIGURES',
  'DATA_FLOW',
  'CONTROL_FLOW',
] as const;

export type CompositionBindingKind = (typeof COMPOSITION_BINDING_KINDS)[number];

const COMPOSITION_BINDING_KIND_SET: ReadonlySet<string> = new Set(COMPOSITION_BINDING_KINDS);

export function isCompositionBindingKind(value: unknown): value is CompositionBindingKind {
  return typeof value === 'string' && COMPOSITION_BINDING_KIND_SET.has(value);
}

/** A typed wiring binding between two member roles. */
export interface CompositionBinding {
  /** One of the 5 frozen binding kinds. */
  kind: CompositionBindingKind;
  /** Source member role (must be declared). */
  source_role: string;
  /** Target member role (must be declared; different from the source). */
  target_role: string;
  /** The contract realized by this binding (non-empty id/name). */
  contract: string;
  /** Structured wiring description (plain JSON object). */
  wiring: Record<string, JsonValue>;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

/** Validate composition members (throws CompositionError). */
export function assertValidCompositionMembers(value: unknown): asserts value is CompositionMember[] {
  if (!Array.isArray(value) || value.length < 2) {
    throw new CompositionError(
      `members must be an array of at least 2 member packages (a composition composes packages), received: ${JSON.stringify(value)}`,
    );
  }
  const roles = new Set<string>();
  const packageIds: string[] = [];
  for (const member of value) {
    if (typeof member !== 'object' || member === null || Array.isArray(member)) {
      throw new CompositionError(`composition member must be an object { package_id, role, bound_contracts }, received: ${JSON.stringify(member)}`);
    }
    const record = member as Record<string, unknown>;
    if (Object.keys(record).length !== 3 || !('package_id' in record) || !('role' in record) || !('bound_contracts' in record)) {
      throw new CompositionError('composition member must have the exact field set { package_id, role, bound_contracts }');
    }
    if (!isArtifactId(record['package_id'])) {
      throw new CompositionError(
        `member package_id must be a well-formed spine artifact id, received: ${JSON.stringify(record['package_id'])}`,
      );
    }
    const parsed = parseArtifactId(record['package_id']);
    if (parsed.kind !== 'Package') {
      throw new CompositionError(
        `member package_id must be a Package id (sos://Package/...) — members are packages, received: ${JSON.stringify(record['package_id'])}`,
      );
    }
    if (!isNonEmptyString(record['role'])) {
      throw new CompositionError(`member role must be a non-empty string, received: ${JSON.stringify(record['role'])}`);
    }
    if (roles.has(record['role'])) {
      throw new CompositionError(`duplicate member role: ${JSON.stringify(record['role'])} (roles are unique within a composition)`);
    }
    roles.add(record['role']);
    if (!Array.isArray(record['bound_contracts']) || record['bound_contracts'].length === 0 || !isStringArray(record['bound_contracts'])) {
      throw new CompositionError(
        `member bound_contracts must be a non-empty array of contract ids (the member's contracts used in this composition), received: ${JSON.stringify(record['bound_contracts'])}`,
      );
    }
    packageIds.push(record['package_id']);
  }
  if (new Set(packageIds).size === 0) {
    // Unreachable (>= 2 members, each with a valid id); kept for exhaustiveness.
    throw new CompositionError('composition members must reference at least one package');
  }
}

/** Validate composition bindings (throws CompositionError). */
export function assertValidCompositionBindings(
  value: unknown,
  members: readonly CompositionMember[],
): asserts value is CompositionBinding[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new CompositionError(
      'bindings must be a NON-EMPTY array — a composition describes actual wiring between its members',
    );
  }
  const roles = new Set(members.map((member) => member.role));
  for (const binding of value) {
    if (typeof binding !== 'object' || binding === null || Array.isArray(binding)) {
      throw new CompositionError(`composition binding must be an object, received: ${JSON.stringify(binding)}`);
    }
    const record = binding as Record<string, unknown>;
    if (
      Object.keys(record).length !== 5 ||
      !('kind' in record) ||
      !('source_role' in record) ||
      !('target_role' in record) ||
      !('contract' in record) ||
      !('wiring' in record)
    ) {
      throw new CompositionError(
        'composition binding must have the exact field set { kind, source_role, target_role, contract, wiring }',
      );
    }
    if (!isCompositionBindingKind(record['kind'])) {
      throw new CompositionError(
        `binding kind must be one of ${COMPOSITION_BINDING_KINDS.join(', ')}, received: ${JSON.stringify(record['kind'])}`,
      );
    }
    if (!isNonEmptyString(record['source_role']) || !roles.has(record['source_role'])) {
      throw new CompositionError(
        `binding source_role must be a declared member role, received: ${JSON.stringify(record['source_role'])}`,
      );
    }
    if (!isNonEmptyString(record['target_role']) || !roles.has(record['target_role'])) {
      throw new CompositionError(
        `binding target_role must be a declared member role, received: ${JSON.stringify(record['target_role'])}`,
      );
    }
    if (record['source_role'] === record['target_role']) {
      throw new CompositionError(
        `a binding cannot wire a role to itself: ${JSON.stringify(record['source_role'])}`,
      );
    }
    if (!isNonEmptyString(record['contract'])) {
      throw new CompositionError(`binding contract must be a non-empty contract id, received: ${JSON.stringify(record['contract'])}`);
    }
    const wiring = record['wiring'];
    if (typeof wiring !== 'object' || wiring === null || Array.isArray(wiring)) {
      throw new CompositionError(`binding wiring must be a plain JSON object, received: ${JSON.stringify(wiring)}`);
    }
  }
}
