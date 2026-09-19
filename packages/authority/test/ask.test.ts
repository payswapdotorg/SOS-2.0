import { describe, expect, it } from 'vitest';
import { canonicalSerialize } from '@sos-2/semantic-spine';
import {
  ASK_DECISION_ACTION,
  DECISION_ACTIONS,
  createAskRequest,
  askRequestArtifactId,
  validateAskRequest,
} from '../src/index.js';
import type { CreateAskRequestInput } from '../src/index.js';
import { PROVENANCE, T0, sampleAskContent } from './helpers.js';
import type { AskContent } from './helpers.js';

function askInput(overrides: Partial<CreateAskRequestInput> = {}): CreateAskRequestInput {
  return { content: sampleAskContent(), provenance: PROVENANCE, created_at: T0, ...overrides };
}

describe('ASK contract (unit) — ASK is a SUCCESS state, not an error', () => {
  it('ASK is a first-class member of the frozen Decision action vocabulary', () => {
    expect(DECISION_ACTIONS).toContain('ASK');
    expect(ASK_DECISION_ACTION).toBe('ASK');
  });

  it('constructing a valid AskRequest is a positive workflow (never throws)', () => {
    const ask = createAskRequest(askInput());
    expect(ask.envelope.kind).toBe('AskRequest');
    expect(ask.envelope.status).toBe('DRAFT');
    expect(ask.content.decision).toContain('Promote candidate C-42');
    expect(ask.content.alternatives).toHaveLength(3);
    expect(validateAskRequest(ask)).toBe(true);
  });

  it('mints content-addressed deterministic ids and round-trips canonically', () => {
    const input = askInput();
    const ask = createAskRequest(input);
    expect(ask.envelope.id).toBe(askRequestArtifactId(input));
    expect(createAskRequest(input).envelope.id).toBe(ask.envelope.id);
    const text = canonicalSerialize(ask);
    const parsed = JSON.parse(text);
    expect(canonicalSerialize(parsed)).toBe(text);
    expect(validateAskRequest(parsed)).toBe(true);
  });

  it('carries the EXACT decision, typed alternatives, evidence quality, uncertainty, trade-offs, risk and authority insufficiency', () => {
    const ask = createAskRequest(askInput());
    expect(ask.content.decision.length).toBeGreaterThan(0);
    for (const alternative of ask.content.alternatives) {
      expect(DECISION_ACTIONS).toContain(alternative.action);
    }
    expect(ask.content.evidence_quality.quality).toBe('MODERATE');
    expect(ask.content.uncertainty.uncertainty_class).toBe('HIGH');
    expect(ask.content.trade_offs.length).toBeGreaterThan(0);
    expect(ask.content.risk.severity).toBe('HIGH');
    expect(ask.content.authority_insufficiency.length).toBeGreaterThan(0);
    // exact field set
    expect(Object.keys(ask.content).sort()).toEqual(
      [
        'alternatives',
        'authority_insufficiency',
        'decision',
        'evidence_quality',
        'risk',
        'trade_offs',
        'uncertainty',
      ].sort(),
    );
  });

  it('alternatives may use every frozen Decision action (including ASK itself)', () => {
    const content = sampleAskContent();
    content.alternatives = DECISION_ACTIONS.map((action, index) => ({
      id: `alt-${index}`,
      action,
      description: `Alternative ${index}.`,
    }));
    const ask = createAskRequest(askInput({ content }));
    expect(ask.content.alternatives).toHaveLength(6);
  });
});
