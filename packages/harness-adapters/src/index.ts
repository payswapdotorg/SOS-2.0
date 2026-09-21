/**
 * @sos-2/harness-adapters — the harness provider adapters (Work Order P8).
 *
 * The adapter contracts mapping the merged P5 Harness Contract onto the
 * §4 integration shapes, as typed ports with injectable transports:
 *
 *   shapes/native-api.ts    §4 tier 1 — native API/SDK-style providers
 *                           (the highest control surface)
 *   shapes/mcp.ts           §4 tier 2 — MCP/equivalent tool protocol
 *   shapes/local-bridge.ts  §4 tier 3 — local companion/service bridge
 *
 * Honest advertisement (unsupported = typed UNSUPPORTED), honest
 * connection statuses (NOT_YET_CONNECTED for real providers, simulated
 * markers for reference transports), exact-field-set request/reply
 * validation (the seam carries NO authority), §4 tier selection
 * (deterministic, vendor-blind), and the in-process bridges serving any
 * HarnessContract through every shape.
 *
 * Determinism: no Date.now / Math.random / fetch / process.env in this
 * package's src — transports and specs are injected.
 */

export * from './errors.js';
export * from './status.js';
export * from './transport.js';
export * from './adapter.js';
export * from './shapes/native-api.js';
export * from './shapes/mcp.js';
export * from './shapes/local-bridge.js';
export * from './in-process.js';
