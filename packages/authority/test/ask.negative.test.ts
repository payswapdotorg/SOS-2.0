import { describe, expect, it } from 'vitest';
import { createAskRequest, validateAskContent, validateAskRequest } from '../src/index.js';
import type { AskContent } from '../src/index.js';
import { PROVENANCE, T0, sampleAskContent } from './helpers.js';

function mutated(mutate: (content: AskContent) => void): AskContent {
  const content = sampleAskContent();
  mutate(content);
  return content;
}

describe('ASK content validation (negative)', () => {
  it('rejects non-object content', () => {
    expect(() => validateAskContent(null)).toThrow(/ask content must be an object/);
    expect(() => validateAskContent('ask')).toThrow(/ask content must be an object/);
  });

  it('rejects a vague/empty decision (the EXACT decision is mandatory)', () => {
    expect(() => createAskRequest({ content: mutated((c) => { c.decision = ''; }), provenance: PROVENANCE, created_at: T0 })).toThrow(
      /decision must be a non-empty string/,
    );
  });

  it('rejects empty alternatives and malformed alternatives', () => {
    expect(() => validateAskContent(mutated((c) => { c.alternatives = []; }))).toThrow(/alternatives must be a non-empty array/);
    expect(() =>
      validateAskContent(mutated((c) => { c.alternatives = [{ id: 'x', action: 'MAYBE' as never, description: 'd' }]; })),
    ).toThrow(/frozen Decision actions/);
    expect(() =>
      validateAskContent(mutated((c) => { c.alternatives = [{ id: 'x', action: 'ACT', description: '' }]; })),
    ).toThrow(/description must be a non-empty string/);
    expect(() =>
      validateAskContent(mutated((c) => { c.alternatives = [{ id: 'X', action: 'ACT', description: 'd' }]; })),
    ).toThrow(/id must be a lowercase slug/);
    expect(() =>
      validateAskContent(
        mutated((c) => {
          c.alternatives = [
            { id: 'dup', action: 'ACT', description: 'd' },
            { id: 'dup', action: 'REJECT', description: 'd2' },
          ];
        }),
      ),
    ).toThrow(/duplicate ask alternative id/);
  });

  it('rejects malformed evidence quality summaries', () => {
    expect(() =>
      validateAskContent(mutated((c) => { c.evidence_quality = { quality: 'PRETTY_GOOD' as never, summary: 's' }; })),
    ).toThrow(/evidence_quality\.quality must be one of/);
    expect(() =>
      validateAskContent(mutated((c) => { c.evidence_quality = { quality: 'STRONG', summary: '' }; })),
    ).toThrow(/evidence_quality\.summary must be a non-empty string/);
  });

  it('rejects malformed uncertainty statements (qualitative classes only)', () => {
    expect(() =>
      validateAskContent(mutated((c) => { c.uncertainty = { uncertainty_class: 'KINDA' as never, basis: 'b' }; })),
    ).toThrow(/uncertainty_class must be one of/);
    expect(() =>
      validateAskContent(mutated((c) => { c.uncertainty = { uncertainty_class: 'LOW', basis: '' }; })),
    ).toThrow(/uncertainty\.basis must be a non-empty string/);
  });

  it('rejects empty trade-offs', () => {
    expect(() => validateAskContent(mutated((c) => { c.trade_offs = []; }))).toThrow(/trade_offs must be a non-empty array/);
    expect(() => validateAskContent(mutated((c) => { c.trade_offs = ['ok', '']; }))).toThrow(/trade_offs must be a non-empty array/);
  });

  it('rejects malformed risks', () => {
    expect(() =>
      validateAskContent(mutated((c) => { c.risk = { description: 'd', severity: 'EXTREME' as never }; })),
    ).toThrow(/risk\.severity must be one of/);
    expect(() =>
      validateAskContent(mutated((c) => { c.risk = { description: '', severity: 'LOW' }; })),
    ).toThrow(/risk\.description must be a non-empty string/);
  });

  it('rejects a missing authority-insufficiency statement', () => {
    expect(() => validateAskContent(mutated((c) => { c.authority_insufficiency = ''; }))).toThrow(
      /authority_insufficiency must be a non-empty string/,
    );
  });

  it('rejects exact-field-set violations and numeric confidence fields (uncalibrated confidence is never accepted)', () => {
    expect(() => validateAskContent({ ...sampleAskContent(), extra: 1 } as unknown as AskContent)).toThrow(/exact field set/);
    const withConfidence = { ...sampleAskContent(), confidence: 0.87 } as unknown as AskContent;
    expect(() => validateAskContent(withConfidence)).toThrow(/must not carry a numeric confidence field/);
    expect(() =>
      validateAskContent(
        mutated((c) => {
          (c.uncertainty as unknown as Record<string, unknown>)['confidence'] = 0.9;
        }),
      ),
    ).toThrow(/must not carry a numeric confidence field/);
    expect(() =>
      createAskRequest({ content: withConfidence, provenance: PROVENANCE, created_at: T0 }),
    ).toThrow(/confidence/);
  });

  it('validateAskRequest rejects structurally invalid artifacts', () => {
    const ask = createAskRequest({ content: sampleAskContent(), provenance: PROVENANCE, created_at: T0 });
    expect(validateAskRequest({ ...ask, extra: 1 })).toBe(false);
    expect(validateAskRequest({ envelope: ask.envelope })).toBe(false);
    expect(validateAskRequest({ envelope: ask.envelope, content: mutated((c) => { c.decision = ''; }) })).toBe(false);
    expect(() => createAskRequest(null as never)).toThrow(/input must be an object/);
  });

  it('delegates envelope discipline to the spine', () => {
    expect(() => createAskRequest({ content: sampleAskContent(), provenance: [], created_at: T0 })).toThrow(/provenance/);
    expect(() => createAskRequest({ content: sampleAskContent(), provenance: PROVENANCE, created_at: 'later' })).toThrow(/RFC3339/);
  });
});
