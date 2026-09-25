/**
 * @sos-2/security — security hardening contracts (Work Order P14).
 *
 * - Workspace isolation: cross-project workspace access is a typed
 *   ISOLATION denial, fail-closed (./isolation/workspace.ts).
 * - Secrets isolation: references never values; secret-shaped emissions
 *   into artifacts/logs are redacted or denied at the observation
 *   boundary, with the redaction itself observed (./secrets/redaction.ts,
 *   corpus aligned with the merged P3 infra/deployment module).
 * - Credential scoping over the P9 action families: scoped-to-X cannot
 *   mint Y; expired fails closed; broker escalation is a typed
 *   violation (./credentials/scopes.ts, vocabulary aligned with the
 *   merged P9 ACTION_FAMILIES).
 * - The policy audit trail: every allow/deny/redact/unknown decision
 *   appends a durable, replay-safe, content-addressed audit record
 *   through the P7 event discipline (./audit/audit.ts).
 * - Operational diagnostics: symptom -> responsible task/body/provider
 *   attribution from the audit trace links, honest INSUFFICIENT_EVIDENCE
 *   otherwise (./diagnostics/diagnostics.ts).
 *
 * Everything is a provider-neutral contract + deterministic reference
 * implementation with injectable seams (clocks, records). Real platform
 * sandboxing, secret stores and network policy engines attach later as
 * adapters WITHOUT contract change. A policy that cannot be evaluated
 * honestly reports UNKNOWN — it never fabricates enforcement.
 *
 * ZERO dependencies (the lockfile identity rule). No ambient time,
 * randomness, environment, network, processes or timers in src.
 */

export * from './types.js';
export * from './errors.js';
export * from './isolation/workspace.js';
export * from './secrets/redaction.js';
export * from './credentials/scopes.js';
export * from './audit/audit.js';
export * from './diagnostics/diagnostics.js';
