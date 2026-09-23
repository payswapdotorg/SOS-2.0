import type { ActorRef, SourceRevisionRef, Timestamp } from './types.js';

export const ACTION_FAMILIES = [
  'commit',
  'push',
  'pull-request',
  'deployment',
  'configuration',
  'remediation',
  'promotion',
  'rollback',
  'body-lifecycle',
] as const;

export type ActionFamily = (typeof ACTION_FAMILIES)[number];

export interface FileChange {
  readonly path: string;
  readonly contents: string;
}

export interface CommitPayload {
  readonly message: string;
  readonly changes: readonly FileChange[];
  readonly expectedBaseSha: string;
}
export interface PushPayload {
  readonly remote: string;
  readonly ref: string;
  readonly fromSha: string;
}
export interface PullRequestPayload {
  readonly title: string;
  readonly headBranch: string;
  readonly baseBranch: string;
  readonly description: string;
}
export interface DeploymentPayload {
  readonly environment: string;
  readonly sourceSha: string;
}
export interface ConfigurationPayload {
  readonly key: string;
  readonly value: string;
}
export interface RemediationPayload {
  readonly findingId: string;
  readonly strategy: string;
  readonly targetSha: string;
}
export interface PromotionPayload {
  readonly fromEnvironment: string;
  readonly toEnvironment: string;
  readonly sourceSha: string;
}
export interface RollbackReason {
  readonly code: 'FAILED_VERIFICATION' | 'INCIDENT' | 'MANUAL_DIRECTIVE';
  readonly detail: string;
}
export interface RollbackPayload {
  readonly deploymentId: string;
  readonly fromSourceSha: string;
  readonly toSourceSha: string;
  readonly reason: RollbackReason;
}
export type BodyLifecycleOperation = 'start' | 'pause' | 'resume' | 'cancel' | 'replace';
export interface BodyLifecyclePayload {
  readonly bodyId: string;
  readonly operation: BodyLifecycleOperation;
}

/**
 * The action envelope. THIS TYPE CARRIES NO AUTHORITY FIELDS — the gateway
 * has no grant/permission/token/credential surface of its own (the P5 §9
 * surface precedent). Authority is re-evaluated out of band at action time
 * through AuthorityPort; a smuggled authority key is a typed rejection
 * naming the field.
 */
export interface ActionRequest {
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly family: ActionFamily;
  readonly actor: ActorRef;
  readonly requestedAt: Timestamp;
  readonly targetRevision: SourceRevisionRef;
  readonly payload: ActionPayload;
}

export type ActionPayload =
  | { readonly family: 'commit'; readonly commit: CommitPayload }
  | { readonly family: 'push'; readonly push: PushPayload }
  | { readonly family: 'pull-request'; readonly pullRequest: PullRequestPayload }
  | { readonly family: 'deployment'; readonly deployment: DeploymentPayload }
  | { readonly family: 'configuration'; readonly configuration: ConfigurationPayload }
  | { readonly family: 'remediation'; readonly remediation: RemediationPayload }
  | { readonly family: 'promotion'; readonly promotion: PromotionPayload }
  | { readonly family: 'rollback'; readonly rollback: RollbackPayload }
  | { readonly family: 'body-lifecycle'; readonly bodyLifecycle: BodyLifecyclePayload };

export type ActionValidationRejection =
  | { readonly code: 'ENVELOPE_MALFORMED'; readonly field: string; readonly detail: string }
  | { readonly code: 'AUTHORITY_FIELD_SMUGGLED'; readonly field: string; readonly detail: string };

export type ValidateOutcome =
  | { readonly ok: true; readonly request: ActionRequest }
  | { readonly ok: false; readonly rejection: ActionValidationRejection };

const FORBIDDEN_AUTHORITY_FIELDS = new Set([
  'authority',
  'grant',
  'grants',
  'grantid',
  'permission',
  'permissions',
  'token',
  'tokens',
  'credential',
  'credentials',
  'scopes',
  'scope',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function findSmuggledAuthorityField(value: unknown, path: string): string | null {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = findSmuggledAuthorityField(value[i], `${path}[${i}]`);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (!isPlainObject(value)) return null;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path === '' ? key : `${path}.${key}`;
    const loweredKey = key.toLowerCase();
    for (const forbidden of FORBIDDEN_AUTHORITY_FIELDS) {
      if (loweredKey.includes(forbidden)) return childPath;
    }
    const hit = findSmuggledAuthorityField(child, childPath);
    if (hit !== null) return hit;
  }
  return null;
}

function malformed(field: string, detail: string): ValidateOutcome {
  return { ok: false, rejection: { code: 'ENVELOPE_MALFORMED', field, detail } };
}

function requireStrings(source: Record<string, unknown>, fields: readonly string[], prefix: string): string | null {
  for (const field of fields) {
    if (!isNonEmptyString(source[field])) return `${prefix}${field}`;
  }
  return null;
}

export function validateRequest(raw: unknown): ValidateOutcome {
  if (!isPlainObject(raw)) return malformed('', 'request must be an object');
  const smuggled = findSmuggledAuthorityField(raw, '');
  if (smuggled !== null) {
    return {
      ok: false,
      rejection: {
        code: 'AUTHORITY_FIELD_SMUGGLED',
        field: smuggled,
        detail: `the action gateway carries no authority fields of its own; field "${smuggled}" is not part of the action surface`,
      },
    };
  }
  if (!isNonEmptyString(raw['actionId'])) return malformed('actionId', 'must be a non-empty string');
  if (!isNonEmptyString(raw['idempotencyKey'])) return malformed('idempotencyKey', 'must be a non-empty string');
  const family = raw['family'];
  if (typeof family !== 'string' || !(ACTION_FAMILIES as readonly string[]).includes(family)) {
    return malformed('family', `must be one of ${ACTION_FAMILIES.join(', ')}`);
  }
  const actor = raw['actor'];
  if (!isPlainObject(actor) || !isNonEmptyString(actor['id'])) return malformed('actor', 'must be { kind, id }');
  if (actor['kind'] !== 'body' && actor['kind'] !== 'human' && actor['kind'] !== 'system') {
    return malformed('actor.kind', 'must be body | human | system');
  }
  if (typeof raw['requestedAt'] !== 'number' || !Number.isFinite(raw['requestedAt'])) {
    return malformed('requestedAt', 'must be a finite epoch-milliseconds number supplied by the caller clock');
  }
  const target = raw['targetRevision'];
  if (!isPlainObject(target) || target['kind'] !== 'source' || !isNonEmptyString(target['sha'])) {
    return malformed('targetRevision', 'must be { kind: "source", sha }');
  }
  const payload = raw['payload'];
  if (!isPlainObject(payload) || payload['family'] !== family) {
    return malformed('payload.family', `payload family must match envelope family "${family as string}"`);
  }
  const payloadError = validatePayload(family as ActionFamily, payload);
  if (payloadError !== null) return malformed(payloadError, `payload does not satisfy the ${family as string} shape`);
  return {
    ok: true,
    request: {
      actionId: raw['actionId'] as string,
      idempotencyKey: raw['idempotencyKey'] as string,
      family: family as ActionFamily,
      actor: { kind: actor['kind'] as ActorRef['kind'], id: actor['id'] as string },
      requestedAt: raw['requestedAt'] as number,
      targetRevision: { kind: 'source', sha: target['sha'] as string },
      payload: buildPayload(family as ActionFamily, payload),
    },
  };
}

function validatePayload(family: ActionFamily, payload: Record<string, unknown>): string | null {
  switch (family) {
    case 'commit': {
      const inner = payload['commit'];
      if (!isPlainObject(inner)) return 'payload.commit';
      if (!isNonEmptyString(inner['message'])) return 'payload.commit.message';
      const changes = inner['changes'];
      if (!Array.isArray(changes)) return 'payload.commit.changes';
      for (const change of changes) {
        if (!isPlainObject(change) || !isNonEmptyString(change['path']) || typeof change['contents'] !== 'string') {
          return 'payload.commit.changes[]';
        }
      }
      return isNonEmptyString(inner['expectedBaseSha']) ? null : 'payload.commit.expectedBaseSha';
    }
    case 'push': {
      const inner = payload['push'];
      if (!isPlainObject(inner)) return 'payload.push';
      return requireStrings(inner, ['remote', 'ref', 'fromSha'], 'payload.push.');
    }
    case 'pull-request': {
      const inner = payload['pullRequest'];
      if (!isPlainObject(inner)) return 'payload.pullRequest';
      return requireStrings(inner, ['title', 'headBranch', 'baseBranch', 'description'], 'payload.pullRequest.');
    }
    case 'deployment': {
      const inner = payload['deployment'];
      if (!isPlainObject(inner)) return 'payload.deployment';
      return requireStrings(inner, ['environment', 'sourceSha'], 'payload.deployment.');
    }
    case 'configuration': {
      const inner = payload['configuration'];
      if (!isPlainObject(inner)) return 'payload.configuration';
      return requireStrings(inner, ['key', 'value'], 'payload.configuration.');
    }
    case 'remediation': {
      const inner = payload['remediation'];
      if (!isPlainObject(inner)) return 'payload.remediation';
      return requireStrings(inner, ['findingId', 'strategy', 'targetSha'], 'payload.remediation.');
    }
    case 'promotion': {
      const inner = payload['promotion'];
      if (!isPlainObject(inner)) return 'payload.promotion';
      return requireStrings(inner, ['fromEnvironment', 'toEnvironment', 'sourceSha'], 'payload.promotion.');
    }
    case 'rollback': {
      const inner = payload['rollback'];
      if (!isPlainObject(inner)) return 'payload.rollback';
      const missing = requireStrings(inner, ['deploymentId', 'fromSourceSha', 'toSourceSha'], 'payload.rollback.');
      if (missing !== null) return missing;
      const reason = inner['reason'];
      if (!isPlainObject(reason)) return 'payload.rollback.reason';
      if (reason['code'] !== 'FAILED_VERIFICATION' && reason['code'] !== 'INCIDENT' && reason['code'] !== 'MANUAL_DIRECTIVE') {
        return 'payload.rollback.reason.code';
      }
      return isNonEmptyString(reason['detail']) ? null : 'payload.rollback.reason.detail';
    }
    case 'body-lifecycle': {
      const inner = payload['bodyLifecycle'];
      if (!isPlainObject(inner)) return 'payload.bodyLifecycle';
      if (!isNonEmptyString(inner['bodyId'])) return 'payload.bodyLifecycle.bodyId';
      const operation = inner['operation'];
      if (operation !== 'start' && operation !== 'pause' && operation !== 'resume' && operation !== 'cancel' && operation !== 'replace') {
        return 'payload.bodyLifecycle.operation';
      }
      return null;
    }
  }
}

function buildPayload(family: ActionFamily, payload: Record<string, unknown>): ActionPayload {
  // Validation already guaranteed every shape; these casts only re-type.
  switch (family) {
    case 'commit':
      return { family, commit: payload['commit'] as CommitPayload };
    case 'push':
      return { family, push: payload['push'] as PushPayload };
    case 'pull-request':
      return { family, pullRequest: payload['pullRequest'] as PullRequestPayload };
    case 'deployment':
      return { family, deployment: payload['deployment'] as DeploymentPayload };
    case 'configuration':
      return { family, configuration: payload['configuration'] as ConfigurationPayload };
    case 'remediation':
      return { family, remediation: payload['remediation'] as RemediationPayload };
    case 'promotion':
      return { family, promotion: payload['promotion'] as PromotionPayload };
    case 'rollback':
      return { family, rollback: payload['rollback'] as RollbackPayload };
    case 'body-lifecycle':
      return { family, bodyLifecycle: payload['bodyLifecycle'] as BodyLifecyclePayload };
  }
}

/** Family-specific authority scope (environment, ref, body id, ...). */
export function scopeFor(request: ActionRequest): string {
  switch (request.payload.family) {
    case 'commit':
      return 'workspace';
    case 'push':
      return request.payload.push.ref;
    case 'pull-request':
      return request.payload.pullRequest.headBranch;
    case 'deployment':
      return request.payload.deployment.environment;
    case 'configuration':
      return request.payload.configuration.key;
    case 'remediation':
      return request.payload.remediation.findingId;
    case 'promotion':
      return request.payload.promotion.toEnvironment;
    case 'rollback':
      return request.payload.rollback.deploymentId;
    case 'body-lifecycle':
      return request.payload.bodyLifecycle.bodyId;
  }
}
