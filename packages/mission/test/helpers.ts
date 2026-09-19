/**
 * Shared test fixtures for @sos-2/mission tests.
 *
 * The Constitution anchor id is CONSUMED from the W0.5 golden contract
 * fixtures (packages/semantic-spine/fixtures) — downstream workers never
 * invent core identifiers (W0.5 export discipline).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { MissionContent } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Constitution anchor id from the W0.5 golden fixture artifact-envelope.json. */
export const CONSTITUTION_ANCHOR_ID: string = (
  JSON.parse(readFileSync(join(here, '../../semantic-spine/fixtures/artifact-envelope.json'), 'utf8')) as {
    authority_ref: string;
  }
).authority_ref;

export const PROVENANCE = ['W1:test'];
export const T0 = '2025-01-01T00:00:00.000Z';
export const T1 = '2025-02-01T00:00:00.000Z';
export const T2 = '2025-03-01T00:00:00.000Z';

export function sampleMissionContent(): MissionContent {
  return {
    purpose: 'Make software continuously better over time while staying comprehensible.',
    goals: [
      {
        id: 'reduce-incidents',
        statement: 'Reduce production incidents.',
        status: 'MEASURABLE',
        measures: ['incident-rate'],
      },
      {
        id: 'keep-humans-in-control',
        statement: 'Keep humans in control of system evolution.',
        status: 'PROPOSED',
        measures: [],
      },
    ],
    outcomes: [
      { id: 'fewer-outages', description: 'Fewer customer-visible outages.', goal_refs: ['reduce-incidents'] },
    ],
    stakeholders: [
      { id: 'operators', name: 'Platform operators', interest: 'Lower toil and fewer pages.' },
      { id: 'end-users', name: 'End users', interest: null },
    ],
    measures: [
      { id: 'incident-rate', description: 'Sev-1+Sev-2 incidents per month.', target: '<= 1', unit: 'incidents/month' },
    ],
    assumptions: [
      { id: 'telemetry-available', statement: 'Incident telemetry is available and trustworthy.' },
    ],
    ambiguities: [
      { id: 'what-counts-as-incident', statement: 'Which events count as incidents is not yet pinned down.', resolution: null },
    ],
    constraints: [
      {
        id: 'cost-ceiling',
        statement: 'Monthly platform cost must stay within the approved envelope.',
        hard: true,
        bound: { axis: 'monthly-cost', direction: 'MAX', limit: 10000 },
      },
      {
        id: 'no-dark-launches',
        statement: 'Prefer explicit rollout decisions.',
        hard: false,
        bound: null,
      },
    ],
  };
}
