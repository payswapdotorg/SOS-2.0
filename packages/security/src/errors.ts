/**
 * Typed errors for the P14 security contracts. A policy violation is
 * NEVER a silent pass and NEVER an untyped crash: the fail-closed seams
 * throw these typed errors, and the audit trail records the decision.
 */

/** Base class carrying the P14 security namespace. */
export class SecurityPolicyError extends Error {
  constructor(
    readonly surface: string,
    message: string,
  ) {
    super(`[${surface}] ${message}`);
    this.name = 'SecurityPolicyError';
  }
}

/** Cross-project workspace access (the pinned ISOLATION denial). */
export class WorkspaceIsolationError extends SecurityPolicyError {
  constructor(message: string) {
    super('workspace-isolation', message);
    this.name = 'WorkspaceIsolationError';
  }
}

/** A secret-shaped value reached a surface it may never reach unredacted. */
export class SecretLeakError extends SecurityPolicyError {
  constructor(message: string) {
    super('secret-isolation', message);
    this.name = 'SecretLeakError';
  }
}

/** Credential scoping violation (family not held / expired / escalation). */
export class CredentialScopeError extends SecurityPolicyError {
  constructor(message: string) {
    super('credential-scope', message);
    this.name = 'CredentialScopeError';
  }
}

/** Audit-trail wiring violations (malformed records, replay abuse). */
export class AuditTrailError extends SecurityPolicyError {
  constructor(message: string) {
    super('audit-trail', message);
    this.name = 'AuditTrailError';
  }
}
