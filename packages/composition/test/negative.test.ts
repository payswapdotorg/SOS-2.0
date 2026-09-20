import { describe, expect, it } from 'vitest';
import { assertValidCompositionContent, createPackageComposition } from '../src/index.js';
import {
  DURABLE_STORE_PACKAGE,
  GOLDEN_PACKAGE,
  T0,
  sampleCompositionContent,
} from './helpers.js';

const base = () => ({ content: sampleCompositionContent(), provenance: ['w6:test'], created_at: T0 });

describe('composition content validation (negative — the mandated rejections)', () => {
  it('REJECTS fewer than 2 members (a composition composes packages)', () => {
    expect(() =>
      createPackageComposition({
        ...base(),
        content: sampleCompositionContent({
          members: [sampleCompositionContent().members[0]!],
        }),
      }),
    ).toThrow(/at least 2 member packages/);
    expect(() => createPackageComposition({ ...base(), content: sampleCompositionContent({ members: [] }) })).toThrow(
      /at least 2/,
    );
  });

  it('REJECTS members that are not Package ids', () => {
    expect(() =>
      createPackageComposition({
        ...base(),
        content: sampleCompositionContent({
          members: [
            { package_id: 'sos://Evidence/' + 'e'.repeat(32), role: 'a', bound_contracts: ['x'] },
            sampleCompositionContent().members[1]!,
          ],
        }),
      }),
    ).toThrow(/members are packages/);
    expect(() =>
      createPackageComposition({
        ...base(),
        content: sampleCompositionContent({
          members: [
            { package_id: 'junk', role: 'a', bound_contracts: ['x'] },
            sampleCompositionContent().members[1]!,
          ],
        }),
      }),
    ).toThrow(/well-formed spine artifact id/);
  });

  it('REJECTS duplicate roles and empty bound contracts', () => {
    const m = sampleCompositionContent().members;
    expect(() =>
      createPackageComposition({
        ...base(),
        content: sampleCompositionContent({ members: [{ ...m[0]!, role: 'twin' }, { ...m[1]!, role: 'twin' }] }),
      }),
    ).toThrow(/duplicate member role/);
    expect(() =>
      createPackageComposition({
        ...base(),
        content: sampleCompositionContent({
          members: [{ ...m[0]!, bound_contracts: [] }, m[1]!],
        }),
      }),
    ).toThrow(/bound_contracts/);
  });

  it('REJECTS an empty binding set (a composition describes actual wiring)', () => {
    expect(() => createPackageComposition({ ...base(), content: sampleCompositionContent({ bindings: [] }) })).toThrow(
      /NON-EMPTY array — a composition describes actual wiring/,
    );
  });

  it('REJECTS bindings with unknown or self-wired roles, unknown kinds, malformed wiring', () => {
    const content = sampleCompositionContent();
    expect(() =>
      createPackageComposition({
        ...base(),
        content: sampleCompositionContent({
          bindings: [{ ...content.bindings[0]!, source_role: 'ghost', target_role: 'store', contract: 'c', wiring: {} }],
        }),
      }),
    ).toThrow(/source_role must be a declared member role/);
    expect(() =>
      createPackageComposition({
        ...base(),
        content: sampleCompositionContent({
          bindings: [{ ...content.bindings[0]!, source_role: 'spine', target_role: 'ghost', contract: 'c', wiring: {} }],
        }),
      }),
    ).toThrow(/target_role must be a declared member role/);
    expect(() =>
      createPackageComposition({
        ...base(),
        content: sampleCompositionContent({
          bindings: [
            { kind: 'PROVIDES_TO', source_role: 'spine', target_role: 'spine', contract: 'c', wiring: {} },
          ],
        }),
      }),
    ).toThrow(/cannot wire a role to itself/);
    expect(() =>
      createPackageComposition({
        ...base(),
        content: sampleCompositionContent({
          bindings: [{ ...content.bindings[0]!, kind: 'VIBES' as never, wiring: {} }],
        }),
      }),
    ).toThrow(/binding kind must be one of/);
    expect(() =>
      createPackageComposition({
        ...base(),
        content: sampleCompositionContent({
          bindings: [{ ...content.bindings[0]!, wiring: 'loose' as never }],
        }),
      }),
    ).toThrow(/wiring must be a plain JSON object/);
  });

  it('REJECTS unjustified probability assessments in content (independence records)', () => {
    expect(() =>
      createPackageComposition({
        ...base(),
        content: sampleCompositionContent({
          independence: [
            {
              value: 0.72,
              method: 'SILENT_PRODUCT' as never,
              justification: { basis: 'DESIGNED_ISOLATION', justification: 'x' },
              members: [
                { package_id: GOLDEN_PACKAGE.envelope.id, probability: 0.9 },
                { package_id: DURABLE_STORE_PACKAGE.envelope.id, probability: 0.8 },
              ],
            },
          ],
        }),
      }),
    ).toThrow(/INDEPENDENCE_JUSTIFIED_PRODUCT/);
  });

  it('REJECTS applicability/assurance/context/diversity violations (the packages-layer disciplines)', () => {
    expect(() =>
      createPackageComposition({ ...base(), content: sampleCompositionContent({ applicability: [] }) }),
    ).toThrow(/at least one applicability estimate/);
    expect(() =>
      createPackageComposition({ ...base(), content: sampleCompositionContent({ assurance_obligations: [] }) }),
    ).toThrow(/at least one assurance obligation/);
    expect(() => createPackageComposition({ ...base(), content: sampleCompositionContent({ context: {} }) })).toThrow(
      /context/,
    );
    expect(() =>
      createPackageComposition({
        ...base(),
        content: sampleCompositionContent({
          applicability: [
            { kind: 'QUALITATIVE', uncertainty_class: 'WEAK', context: {}, sample_size: 0, window: null },
          ],
        }),
      }),
    ).toThrow(/universal score/);
  });

  it('REJECTS unknown maturity, SUPERSEDED without replacement, unknown top-level keys', () => {
    expect(() =>
      createPackageComposition({ ...base(), content: sampleCompositionContent({ maturity: 'SHIPPED' as never }) }),
    ).toThrow(/frozen 7/);
    expect(() =>
      createPackageComposition({
        ...base(),
        // SUPERSEDED is ex-validated: evidence present, replacement missing.
        content: sampleCompositionContent({
          maturity: 'SUPERSEDED',
          evidence_refs: ['sos://Evidence/' + 'a'.repeat(32)],
        }),
      }),
    ).toThrow(/SUPERSEDED composition must declare its replacement/);
    expect(() =>
      assertValidCompositionContent({ ...sampleCompositionContent(), surprise: 1 } as never),
    ).toThrow(/exact 18-field/);
  });

  it('REJECTS evidence/failure/compatibility refs of the wrong kind', () => {
    expect(() =>
      createPackageComposition({
        ...base(),
        content: sampleCompositionContent({ evidence_refs: ['sos://Package/' + '5'.repeat(32)] }),
      }),
    ).toThrow(/Evidence/);
    expect(() =>
      createPackageComposition({
        ...base(),
        content: sampleCompositionContent({
          evidence_refs: ['sos://Evidence/' + 'a'.repeat(32)],
          failure_refs: ['not-an-id'],
        }),
      }),
    ).toThrow(/failure_refs/);
  });
});
