/**
 * The typed capability surface of the GitHub project adapter (Work Order
 * P4): which operations the backing provider supports. An unsupported
 * operation is ALWAYS an explicit typed UNSUPPORTED outcome — never a
 * silent failure, never a fabricated success (productization rule:
 * "Provider outages remain truthful unknown/unavailable states"; the six
 * evidence truth states keep UNSUPPORTED distinct everywhere).
 *
 * The capability vocabulary is THIS package's own provider-adapter
 * vocabulary (the W12 adapter-contract precedent — adapter control-plane
 * fields are the adapter's, domain semantics are never redefined).
 */

/** Every operation the GitHubPort contract can express. */
export const GITHUB_CAPABILITIES = [
  'connection',
  'repository-discovery',
  'branch-selection',
  'revision-selection',
  'empty-repository-detection',
  'snapshot-import',
  'webhook-registration',
  'branch-creation',
  'commit-operations',
  'pull-request-operations',
] as const;

export type GitHubCapability = (typeof GITHUB_CAPABILITIES)[number];

const CAPABILITY_SET: ReadonlySet<string> = new Set<string>(GITHUB_CAPABILITIES);

/** Is this a well-formed capability of the GitHubPort contract? */
export function isGitHubCapability(value: unknown): value is GitHubCapability {
  return typeof value === 'string' && CAPABILITY_SET.has(value);
}

/**
 * The typed capability surface of one backing provider: the supported
 * subset (explicit) and the unsupported remainder (equally explicit — a
 * consumer can enumerate what it cannot rely on).
 */
export interface GitHubCapabilitySurface {
  /** The backing provider's stable id (e.g. 'github-reference', 'github-real'). */
  provider_id: string;
  /** The capabilities this provider supports, in canonical order. */
  supported: GitHubCapability[];
  /** The capabilities this provider does NOT support, in canonical order. */
  unsupported: GitHubCapability[];
  /** One honest sentence about the surface (rendered with it). */
  note: string;
}

/** Build a validated capability surface from an arbitrary supported subset. */
export function buildCapabilitySurface(input: {
  provider_id: string;
  supported: readonly GitHubCapability[];
  note: string;
}): GitHubCapabilitySurface {
  const supportedSet = new Set<string>();
  for (const capability of input.supported) {
    if (!isGitHubCapability(capability)) {
      throw new Error(`buildCapabilitySurface: unknown capability: ${JSON.stringify(capability)}`);
    }
    if (supportedSet.has(capability)) {
      throw new Error(`buildCapabilitySurface: duplicate capability: ${capability}`);
    }
    supportedSet.add(capability);
  }
  const supported = GITHUB_CAPABILITIES.filter((capability) => supportedSet.has(capability));
  const unsupported = GITHUB_CAPABILITIES.filter((capability) => !supportedSet.has(capability));
  return {
    provider_id: input.provider_id,
    supported,
    unsupported,
    note: input.note,
  };
}

/** Does the surface support this capability? */
export function surfaceSupports(surface: GitHubCapabilitySurface, capability: GitHubCapability): boolean {
  return surface.supported.includes(capability);
}

/**
 * The typed outcome of a GitHubPort operation: OK with the result, or an
 * EXPLICIT UNSUPPORTED answer naming the missing capability and why
 * (never a silent failure; never a thrown error for an honest refusal).
 */
export type GitHubOperationOutcome<T> =
  | { status: 'OK'; result: T }
  | { status: 'UNSUPPORTED'; capability: GitHubCapability; provider_id: string; reason: string };

/** Construct the OK outcome. */
export function okOutcome<T>(result: T): GitHubOperationOutcome<T> {
  return { status: 'OK', result };
}

/** Construct the explicit UNSUPPORTED outcome. */
export function unsupportedOutcome<T>(
  capability: GitHubCapability,
  providerId: string,
  reason: string,
): GitHubOperationOutcome<T> {
  return { status: 'UNSUPPORTED', capability, provider_id: providerId, reason };
}

/**
 * The user-facing label of a capability (rendered in capability tables).
 * The labels are presentation text, not vocabulary.
 */
export function capabilityLabel(capability: GitHubCapability): string {
  switch (capability) {
    case 'connection':
      return 'Connection (least-privilege repository scope)';
    case 'repository-discovery':
      return 'Repository discovery';
    case 'branch-selection':
      return 'Branch selection';
    case 'revision-selection':
      return 'Revision selection';
    case 'empty-repository-detection':
      return 'Empty-repository detection';
    case 'snapshot-import':
      return 'Snapshot / metadata import';
    case 'webhook-registration':
      return 'Webhook registration (where supported)';
    case 'branch-creation':
      return 'Branch creation';
    case 'commit-operations':
      return 'Commit operations';
    case 'pull-request-operations':
      return 'Pull-request operations';
  }
}
