/**
 * Shared (non-test) fixtures for @sos-2/value tests.
 * Lives outside the vitest test glob (only *.test.ts files are collected),
 * so importing it never re-registers another file's tests.
 */

import type { MissionView, ValueModelContent } from '../src/index.js';

export const PROVENANCE = ['W1:test'];
export const T0 = '2025-01-01T00:00:00.000Z';
export const T1 = '2025-02-01T00:00:00.000Z';

export function sampleValueContent(): ValueModelContent {
  return {
    objectives: [
      { id: 'grow-revenue', statement: 'Grow revenue per tenant.', direction: 'MAXIMIZE', metric: 'revenue-per-tenant' },
      { id: 'contain-cost', statement: 'Contain infrastructure cost.', direction: 'MINIMIZE', metric: 'monthly-cost' },
    ],
    budgets: [
      { id: 'platform-budget', resource: 'monthly-cost', limit: 8000, unit: 'USD' },
    ],
    incentives: [
      { id: 'efficiency-bonus', statement: 'Reward efficiency improvements.', aligns_with: ['contain-cost'] },
    ],
    opportunities: [
      { id: 'spot-instances', statement: 'Use spot instances for batch workloads.', expected_value: 1200 },
      { id: 'partner-api', statement: 'Monetize a partner API.', expected_value: null },
    ],
    constraints: [
      { id: 'cost-ceiling', type: 'BUDGET_LIMIT', statement: 'Keep monthly cost within 8000.', bound: { axis: 'monthly-cost', direction: 'MAX', limit: 8000 } },
      { id: 'latency-slo', type: 'SERVICE_LEVEL', statement: 'p95 latency at most 250ms.', bound: { axis: 'p95-latency', direction: 'MAX', limit: 250 } },
      { id: 'keep-it-simple', type: 'PREFERENCE', statement: 'Prefer boring technology.', bound: null },
    ],
    approved: true,
  };
}

export function compatibleMission(): MissionView {
  return {
    artifact_id: `sos://Mission/${'e'.repeat(32)}`,
    constraints: [
      { id: 'mission-cost-ceiling', statement: 'Monthly cost at most 10000.', hard: true, bound: { axis: 'monthly-cost', direction: 'MAX', limit: 10000 } },
      { id: 'mission-uptime-floor', statement: 'Uptime at least 99.9%.', hard: true, bound: { axis: 'uptime', direction: 'MIN', limit: 99.9 } },
      { id: 'mission-style', statement: 'Prefer boring technology.', hard: false, bound: null },
    ],
  };
}
