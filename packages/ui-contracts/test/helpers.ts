/**
 * Shared test helpers for @sos-2/ui-contracts — compact domain fixtures
 * built EXCLUSIVELY through the domain packages' own builders (never
 * hand-written JSON), mirroring the W11 fixture discipline.
 */

import {
  createTraceLink,
  deriveDeterministicArtifactId,
} from '@sos-2/semantic-spine';
import type { TraceLink } from '@sos-2/semantic-spine';
import { createMission } from '@sos-2/mission';
import type { MissionArtifact } from '@sos-2/mission';

export const NOW = '2025-06-15T12:00:00Z';

/** A stable, deterministic constitution anchor id (spine-minted). */
export const CONSTITUTION_ID = deriveDeterministicArtifactId('Constitution', {
  kind: 'constitution',
  authority: 'self-authorized root',
});

export function slug(index: number): string {
  return `fixture-${index}`;
}

/** Deterministic evidence id minted from a small seed object. */
export function evidenceId(seed: string): string {
  return deriveDeterministicArtifactId('Evidence', { fixture: seed });
}

export function systemStateId(seed: string): string {
  return deriveDeterministicArtifactId('SystemState', { fixture: seed });
}

export function candidateId(seed: string): string {
  return deriveDeterministicArtifactId('CandidateState', { fixture: seed });
}

export function hypothesisId(seed: string): string {
  return deriveDeterministicArtifactId('CausalHypothesis', { fixture: seed });
}

export function askId(seed: string): string {
  return deriveDeterministicArtifactId('AskRequest', { fixture: seed });
}

export function decisionId(seed: string): string {
  return deriveDeterministicArtifactId('Decision', { fixture: seed });
}

/** Build a typed trace link with fixture provenance. */
export function link(source: string, target: string, type: TraceLink['type']): TraceLink {
  return createTraceLink({
    source,
    target,
    type,
    provenance: ['W11:ui-contracts:fixture'],
  });
}

/** A minimal valid mission (v1 root). */
export function fixtureMission(purpose: string, version = 1, supersedes: string | null = null): MissionArtifact {
  return createMission({
    content: {
      purpose,
      goals: [
        { id: 'goal-reliability', statement: 'Keep checkout reliable', status: 'MEASURABLE', measures: ['measure-uptime'] },
      ],
      outcomes: [{ id: 'outcome-stable-checkout', description: 'Checkout stays stable', goal_refs: ['goal-reliability'] }],
      stakeholders: [{ id: 'stakeholder-shoppers', name: 'Shoppers', interest: 'Fast, reliable checkout' }],
      measures: [{ id: 'measure-uptime', description: 'Monthly uptime', target: '>= 99.9%', unit: 'percent' }],
      assumptions: [{ id: 'assumption-load', statement: 'Traffic stays within 2x of current peak' }],
      ambiguities: [{ id: 'ambiguity-regions', statement: 'Which regions matter first?', resolution: null }],
      constraints: [
        { id: 'constraint-cost', statement: 'Monthly cost stays within budget', hard: true, bound: { axis: 'monthly-cost', direction: 'MAX', limit: 5000 } },
      ],
    },
    provenance: ['W11:ui-contracts:fixture'],
    created_at: NOW,
    authority_ref: CONSTITUTION_ID,
    version,
    status: 'ACTIVE',
    supersedes,
  });
}

/** A raw spine id for kinds the fixtures only reference. */
export function rawId(kind: string, seed: string): string {
  return deriveDeterministicArtifactId(kind, { fixture: seed });
}
