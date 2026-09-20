import { describe, expect, it } from 'vitest';
import {
  RUNTIME_CONFORMANCE_EVIDENCE_KIND,
  RUNTIME_CONFORMANCE_METHOD,
  RUNTIME_VERDICTS,
  STRUCTURAL_ADAPTER_ID,
  evaluateRuntimeConformance,
  isRuntimeConformanceRecord,
  isRuntimeConformanceResult,
  structuralRuntimeAdapter,
  systemStateRevisionToken,
  VERDICT_AVAILABILITY,
} from '../src/index.js';
import type { Invariant } from '@sos-2/conformance';
import {
  CREATED_AT,
  DEPLOYMENT_REVISION,
  EVALUATED_AT,
  IMPLEMENTATION_ID,
  IMPLEMENTATION_REVISION,
  LATER_WINDOW,
  PRODUCER,
  createDeclaredArchitecture,
  createSystemStateFor,
  observation,
} from './helpers.js';

function baseInput() {
  const declared = createDeclaredArchitecture();
  const systemState = createSystemStateFor(declared);
  return { declared, systemState };
}

const FORBIDDEN_UI_PAYMENT: Invariant = {
  kind: 'FORBIDDEN_DEPENDENCY',
  fromKind: 'Component',
  toKind: 'Component',
};

describe('runtime conformance evaluation', () => {
  it('emits PASS/SUCCESS evidence when all declared subjects are covered and no violation is observed', () => {
    const { declared, systemState } = baseInput();
    const observations = [
      observation('component:checkout', 'SUCCESS'),
      observation('component:payment', 'SUCCESS'),
      observation('component:ui', 'SUCCESS'),
      observation('iface:payment-api', 'SUCCESS'),
      observation('store:orders', 'SUCCESS'),
      observation('store:payments', 'SUCCESS'),
    ];
    const result = evaluateRuntimeConformance({
      system_state: systemState,
      declared_architecture: declared,
      invariants: [FORBIDDEN_UI_PAYMENT],
      observations,
      adapter: structuralRuntimeAdapter,
      producer: PRODUCER,
      evaluated_at: EVALUATED_AT,
    });
    expect(result.records).toHaveLength(1);
    const record = result.records[0]!;
    expect(record.verdict).toBe('PASS');
    expect(record.evidence.availability).toBe('SUCCESS');
    expect(record.coverage.summary).toBe('COMPLETE');
    expect(record.check.status).toBe('PASS');
    expect(isRuntimeConformanceRecord(record)).toBe(true);
    expect(isRuntimeConformanceResult(result)).toBe(true);
    expect(result.system_state_id).toBe(systemState.envelope.id);
    expect(result.system_state_version).toBe(systemState.envelope.version);
    expect(result.declared_architecture_id).toBe(declared.envelope.id);
  });

  it('mints kind-Evidence records with OBSERVATIONAL class, explicit method and exact-revision provenance', () => {
    const { declared, systemState } = baseInput();
    const result = evaluateRuntimeConformance({
      system_state: systemState,
      declared_architecture: declared,
      invariants: [FORBIDDEN_UI_PAYMENT],
      observations: [observation('component:ui', 'SUCCESS'), observation('component:payment', 'SUCCESS')],
      adapter: structuralRuntimeAdapter,
      producer: PRODUCER,
      evaluated_at: EVALUATED_AT,
    });
    const evidence = result.records[0]!.evidence;
    expect(evidence.id.startsWith('sos://Evidence/')).toBe(true);
    expect(evidence.kind).toBe(RUNTIME_CONFORMANCE_EVIDENCE_KIND);
    expect(evidence.method).toBe(RUNTIME_CONFORMANCE_METHOD);
    expect(evidence.evidence_class).toBe('OBSERVATIONAL');
    expect(evidence.observational).toBe(true);
    expect(evidence.intervention).toBe(false);
    expect(evidence.subject_ref).toBe(systemState.envelope.id);
    expect(evidence.subject_revision).toBe(systemStateRevisionToken(systemState.envelope.id, 1));
    expect(evidence.source_revision).toBe(IMPLEMENTATION_REVISION);
    expect(evidence.deployment_revision).toBe(DEPLOYMENT_REVISION);
    expect(evidence.llm_output).toBe(false);
    // provenance chain: exact revisions, adapter, invariant hash, observations hash, evaluated-at
    expect(evidence.provenance).toContain(`runtime-conformance:${systemState.envelope.id}@v1`);
    expect(evidence.provenance).toContain(`architecture:${declared.envelope.id}@v1`);
    expect(evidence.provenance).toContain(`implementation-model:${IMPLEMENTATION_ID}`);
    expect(evidence.provenance).toContain(`implementation-revision:${IMPLEMENTATION_REVISION}`);
    expect(evidence.provenance).toContain(`deployment-revision:${DEPLOYMENT_REVISION}`);
    expect(evidence.provenance).toContain(`adapter:${STRUCTURAL_ADAPTER_ID}`);
    expect(evidence.provenance).toContain(`evaluated-at:${EVALUATED_AT}`);
    expect(evidence.provenance.some((entry) => entry.startsWith('invariant:sha256:'))).toBe(true);
    expect(evidence.provenance.some((entry) => entry.startsWith('observations:sha256:'))).toBe(true);
    // window: the enclosing union of the observation windows
    expect(evidence.window).toEqual({ start: CREATED_AT, end: '2025-06-01T01:00:00.000Z' });
  });

  it('links every record to the exact SystemState (OBSERVES) and declared architecture (VERIFIES)', () => {
    const { declared, systemState } = baseInput();
    const result = evaluateRuntimeConformance({
      system_state: systemState,
      declared_architecture: declared,
      invariants: [FORBIDDEN_UI_PAYMENT],
      observations: [],
      adapter: structuralRuntimeAdapter,
      producer: PRODUCER,
      evaluated_at: EVALUATED_AT,
    });
    for (const link of result.links) {
      expect(link.source).toBe(result.records[0]!.evidence.id);
      expect(link.provenance!.length).toBeGreaterThan(0);
    }
    const observes = result.records[0]!.links.find((link) => link.type === 'OBSERVES')!;
    expect(observes.target).toBe(systemState.envelope.id);
    const verifies = result.records[0]!.links.find((link) => link.type === 'VERIFIES')!;
    expect(verifies.target).toBe(declared.envelope.id);
  });

  it('a positively observed forbidden dependency is a witnessed FAIL/FAILURE', () => {
    const { declared, systemState } = baseInput();
    const observations = [
      observation('component:ui', 'SUCCESS', {
        'runtime.edges': [{ target: 'component:payment', kind: 'Dependency' }],
      }),
      observation('component:payment', 'SUCCESS'),
    ];
    const result = evaluateRuntimeConformance({
      system_state: systemState,
      declared_architecture: declared,
      invariants: [FORBIDDEN_UI_PAYMENT],
      observations,
      adapter: structuralRuntimeAdapter,
      producer: PRODUCER,
      evaluated_at: EVALUATED_AT,
    });
    const record = result.records[0]!;
    expect(record.verdict).toBe('FAIL');
    expect(record.evidence.availability).toBe('FAILURE');
    expect(record.check.status).toBe('FAIL');
    expect(record.check.evidence).toContain('component:ui->component:payment');
    expect(record.reason).toContain('positively observed');
  });

  it('absence-based REQUIRED_INTERFACE failures yield UNKNOWN, never FAIL', () => {
    const { declared, systemState } = baseInput();
    // every Component must expose iface:payment-api — the runtime sights all
    // components but only payment declares the Provides edge
    const observations = [
      observation('component:payment', 'SUCCESS', {
        'runtime.node_kind': 'Component',
        'runtime.edges': [{ target: 'iface:payment-api', kind: 'Provides' }],
      }),
      observation('component:checkout', 'SUCCESS', { 'runtime.node_kind': 'Component' }),
      observation('component:ui', 'SUCCESS', { 'runtime.node_kind': 'Component' }),
      observation('iface:payment-api', 'UNKNOWN', { 'runtime.node_kind': 'Interface' }),
    ];
    const invariant: Invariant = { kind: 'REQUIRED_INTERFACE', componentKind: 'Component', interfaceId: 'iface:payment-api' };
    const result = evaluateRuntimeConformance({
      system_state: systemState,
      declared_architecture: declared,
      invariants: [invariant],
      observations,
      adapter: structuralRuntimeAdapter,
      producer: PRODUCER,
      evaluated_at: EVALUATED_AT,
    });
    const record = result.records[0]!;
    // the static check fails (checkout/ui lack the Provides edge) but the
    // violation is absence-based: no positive witness exists
    expect(record.check.status).toBe('FAIL');
    expect(record.verdict).toBe('UNKNOWN');
    expect(record.evidence.availability).toBe('UNKNOWN');
    expect(record.reason).toContain('absence-based');
  });

  it('DATA_OWNERSHIP multi-ownership is witnessed FAIL; zero-ownership stays UNKNOWN', () => {
    const { declared, systemState } = baseInput();
    const invariant: Invariant = { kind: 'DATA_OWNERSHIP' };
    const witnessed = evaluateRuntimeConformance({
      system_state: systemState,
      declared_architecture: declared,
      invariants: [invariant],
      observations: [
        observation('store:payments', 'SUCCESS', { 'runtime.node_kind': 'DataStore' }),
        observation('store:orders', 'SUCCESS', { 'runtime.node_kind': 'DataStore' }),
        observation('component:payment', 'SUCCESS', {
          'runtime.node_kind': 'Component',
          'runtime.edges': [{ target: 'store:payments', kind: 'Owns' }],
        }),
        // a SECOND distinct owner of the same store: positively observed
        // multi-ownership
        observation('component:checkout', 'SUCCESS', {
          'runtime.node_kind': 'Component',
          'runtime.edges': [{ target: 'store:payments', kind: 'Owns' }],
        }),
      ],
      adapter: structuralRuntimeAdapter,
      producer: PRODUCER,
      evaluated_at: EVALUATED_AT,
    });
    expect(witnessed.records[0]!.verdict).toBe('FAIL');
    expect(witnessed.records[0]!.evidence.availability).toBe('FAILURE');

    const absenceBased = evaluateRuntimeConformance({
      system_state: systemState,
      declared_architecture: declared,
      invariants: [invariant],
      observations: [
        observation('store:payments', 'SUCCESS', { 'runtime.node_kind': 'DataStore' }),
        observation('store:orders', 'SUCCESS', { 'runtime.node_kind': 'DataStore' }),
        observation('component:checkout', 'SUCCESS', {
          'runtime.node_kind': 'Component',
          'runtime.edges': [{ target: 'store:orders', kind: 'Owns' }],
        }),
      ],
      adapter: structuralRuntimeAdapter,
      producer: PRODUCER,
      evaluated_at: EVALUATED_AT,
    });
    // store:payments is sighted but nobody was observed owning it
    expect(absenceBased.records[0]!.check.status).toBe('FAIL');
    expect(absenceBased.records[0]!.verdict).toBe('UNKNOWN');
    expect(absenceBased.records[0]!.evidence.availability).toBe('UNKNOWN');
  });

  it('no data at all yields UNKNOWN/UNAVAILABLE (a gap is never zero, never absence-of-violation)', () => {
    const { declared, systemState } = baseInput();
    const result = evaluateRuntimeConformance({
      system_state: systemState,
      declared_architecture: declared,
      invariants: [FORBIDDEN_UI_PAYMENT],
      observations: [],
      adapter: structuralRuntimeAdapter,
      producer: PRODUCER,
      evaluated_at: EVALUATED_AT,
    });
    const record = result.records[0]!;
    expect(record.verdict).toBe('UNKNOWN');
    expect(record.evidence.availability).toBe('UNAVAILABLE');
    expect(record.coverage.summary).toBe('NONE');
    expect(record.reason).toContain('no runtime data exists');
    expect(record.evidence.window).toBeNull();
  });

  it('gap-only observations stay UNKNOWN/UNAVAILABLE; unsupported subjects surface UNSUPPORTED', () => {
    const { declared, systemState } = baseInput();
    const gaps = evaluateRuntimeConformance({
      system_state: systemState,
      declared_architecture: declared,
      invariants: [FORBIDDEN_UI_PAYMENT],
      observations: [observation('component:ui', 'UNAVAILABLE'), observation('component:payment', 'UNAVAILABLE')],
      adapter: structuralRuntimeAdapter,
      producer: PRODUCER,
      evaluated_at: EVALUATED_AT,
    });
    expect(gaps.records[0]!.verdict).toBe('UNKNOWN');
    expect(gaps.records[0]!.evidence.availability).toBe('UNAVAILABLE');
    expect(gaps.records[0]!.coverage.summary).toBe('GAP');

    const unsupported = evaluateRuntimeConformance({
      system_state: systemState,
      declared_architecture: declared,
      invariants: [FORBIDDEN_UI_PAYMENT],
      observations: [observation('component:ui', 'UNSUPPORTED'), observation('component:payment', 'UNSUPPORTED')],
      adapter: structuralRuntimeAdapter,
      producer: PRODUCER,
      evaluated_at: EVALUATED_AT,
    });
    expect(unsupported.records[0]!.verdict).toBe('UNKNOWN');
    expect(unsupported.records[0]!.evidence.availability).toBe('UNSUPPORTED');
    expect(unsupported.records[0]!.coverage.summary).toBe('UNSUPPORTED');
  });

  it('partial coverage yields UNKNOWN/PARTIAL', () => {
    const { declared, systemState } = baseInput();
    const result = evaluateRuntimeConformance({
      system_state: systemState,
      declared_architecture: declared,
      invariants: [FORBIDDEN_UI_PAYMENT],
      observations: [observation('component:ui', 'SUCCESS')],
      adapter: structuralRuntimeAdapter,
      producer: PRODUCER,
      evaluated_at: EVALUATED_AT,
    });
    const record = result.records[0]!;
    expect(record.verdict).toBe('UNKNOWN');
    expect(record.evidence.availability).toBe('PARTIAL');
    expect(record.coverage.summary).toBe('PARTIAL');
    expect(record.coverage.sighted).toBe(1);
    expect(record.reason).toContain('coverage is partial');
  });

  it('invariants with no declared subjects are vacuously UNKNOWN/UNSUPPORTED', () => {
    const { declared, systemState } = baseInput();
    const result = evaluateRuntimeConformance({
      system_state: systemState,
      declared_architecture: declared,
      invariants: [{ kind: 'FORBIDDEN_DEPENDENCY', fromKind: 'Trust', toKind: 'Model' }],
      observations: [observation('component:ui', 'SUCCESS')],
      adapter: structuralRuntimeAdapter,
      producer: PRODUCER,
      evaluated_at: EVALUATED_AT,
    });
    const record = result.records[0]!;
    expect(record.verdict).toBe('UNKNOWN');
    expect(record.evidence.availability).toBe('UNSUPPORTED');
    expect(record.coverage.summary).toBe('EMPTY');
    expect(record.reason).toContain('no declared subjects');
  });

  it('evaluates multiple invariants in input order with unique evidence ids', () => {
    const { declared, systemState } = baseInput();
    const invariants: Invariant[] = [
      FORBIDDEN_UI_PAYMENT,
      { kind: 'DATA_OWNERSHIP' },
      { kind: 'LAYERING', layers: ['DataStore', 'Component', 'Interface'] },
    ];
    const result = evaluateRuntimeConformance({
      system_state: systemState,
      declared_architecture: declared,
      invariants,
      observations: [
        observation('component:ui', 'SUCCESS'),
        observation('component:payment', 'SUCCESS'),
        observation('component:checkout', 'SUCCESS'),
        observation('iface:payment-api', 'SUCCESS'),
        observation('store:orders', 'SUCCESS'),
        observation('store:payments', 'SUCCESS'),
      ],
      adapter: structuralRuntimeAdapter,
      producer: PRODUCER,
      evaluated_at: EVALUATED_AT,
    });
    expect(result.records.map((record) => record.invariant)).toEqual(invariants);
    const ids = result.records.map((record) => record.evidence.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id.startsWith('sos://Evidence/')).toBe(true);
    }
  });

  it('is deterministic: identical inputs produce byte-identical results', () => {
    const { declared, systemState } = baseInput();
    const input = {
      system_state: systemState,
      declared_architecture: declared,
      invariants: [FORBIDDEN_UI_PAYMENT] as const,
      observations: [
        observation('component:ui', 'SUCCESS', {
          'runtime.edges': [{ target: 'component:payment', kind: 'Dependency' }],
        }),
        observation('component:payment', 'PARTIAL'),
      ],
      adapter: structuralRuntimeAdapter,
      producer: PRODUCER,
      evaluated_at: EVALUATED_AT,
    };
    const first = evaluateRuntimeConformance(input);
    // the adapter is a behavioral object (not JSON); re-inject it after cloning
    const clone = JSON.parse(JSON.stringify(input)) as Omit<typeof input, 'adapter'> & { adapter: unknown };
    clone.adapter = structuralRuntimeAdapter;
    const second = evaluateRuntimeConformance(clone as typeof input);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe('the structural runtime view adapter', () => {
  it('projects node kinds and runtime edges; edge targets become indirectly sighted nodes', () => {
    const view = structuralRuntimeAdapter.project([
      observation('component:payment', 'SUCCESS', {
        'runtime.node_kind': 'Component',
        'runtime.edges': [
          { target: 'iface:payment-api', kind: 'Provides' },
          { target: 'store:payments', kind: 'Owns' },
        ],
      }),
      observation('component:checkout', 'UNKNOWN', { 'runtime.node_kind': 'Component' }),
    ]);
    expect(view.graph.nodes.map((node) => [node.id, node.kind]).sort()).toEqual([
      ['component:checkout', 'Component'],
      ['component:payment', 'Component'],
      ['iface:payment-api', 'Interface'],
      ['store:payments', 'DataStore'],
    ]);
    expect(view.graph.edges.map((edge) => `${edge.source}->${edge.target}->${edge.kind}`).sort()).toEqual([
      'component:payment->iface:payment-api->Provides',
      'component:payment->store:payments->Owns',
    ]);
    const byId = new Map(view.sightedNodes.map((node) => [node.id, node]));
    expect(byId.get('component:payment')!.direct).toBe(true);
    expect(byId.get('iface:payment-api')!.direct).toBe(false);
    expect(byId.get('store:payments')!.direct).toBe(false);
    expect(view.unprojected).toEqual([]);
  });

  it('tallies all 6 truth states per subject and never projects gaps or unsupported subjects', () => {
    const view = structuralRuntimeAdapter.project([
      observation('component:ui', 'SUCCESS'),
      observation('component:ui', 'UNAVAILABLE'),
      observation('component:payment', 'UNSUPPORTED'),
    ]);
    expect(view.graph.nodes.map((node) => node.id)).toEqual(['component:ui']);
    const ui = view.subjectCoverage.find((entry) => entry.subject === 'component:ui')!;
    expect(ui.counts).toEqual({
      SUCCESS: 1,
      FAILURE: 0,
      UNKNOWN: 0,
      UNAVAILABLE: 1,
      UNSUPPORTED: 0,
      PARTIAL: 0,
    });
    const payment = view.subjectCoverage.find((entry) => entry.subject === 'component:payment')!;
    expect(payment.counts.UNSUPPORTED).toBe(1);
  });

  it('retains unprojectable observations with reasons instead of dropping them', () => {
    const view = structuralRuntimeAdapter.project([
      observation('component:payment', 'SUCCESS', { 'runtime.node_kind': 'Banana' }),
      observation('component:checkout', 'SUCCESS', { 'runtime.edges': 'not-an-array' }),
      observation('component:ui', 'SUCCESS', { 'runtime.edges': [{ target: 'x', kind: 'Banana' }] }),
    ]);
    expect(view.unprojected).toHaveLength(3);
    expect(view.unprojected.map((entry) => entry.reason)).toEqual([
      expect.stringContaining('not a registered architecture node kind'),
      expect.stringContaining('array of { target, kind }'),
      expect.stringContaining('not a registered architecture edge kind'),
    ]);
  });

  it('rejects malformed observations loudly', () => {
    expect(() => structuralRuntimeAdapter.project([{ subject_ref: '' } as never])).toThrow();
    expect(() => structuralRuntimeAdapter.project([null as never])).toThrow();
    expect(() => structuralRuntimeAdapter.project('nope' as never)).toThrow();
  });

  it('defaults node kinds to Component when runtime.node_kind is absent', () => {
    const view = structuralRuntimeAdapter.project([observation('component:ui', 'SUCCESS')]);
    expect(view.graph.nodes[0]!.kind).toBe('Component');
  });
});

describe('the frozen verdict vocabulary', () => {
  it('PASS/FAIL/UNKNOWN map to disjoint availability sets (never conflated)', () => {
    expect(RUNTIME_VERDICTS).toEqual(['PASS', 'FAIL', 'UNKNOWN']);
    expect(VERDICT_AVAILABILITY['PASS']).toEqual(['SUCCESS']);
    expect(VERDICT_AVAILABILITY['FAIL']).toEqual(['FAILURE']);
    expect(VERDICT_AVAILABILITY['UNKNOWN']).toEqual(['UNKNOWN', 'UNAVAILABLE', 'UNSUPPORTED', 'PARTIAL']);
    const all = Object.values(VERDICT_AVAILABILITY).flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it('observation windows union across multiple windows deterministically', () => {
    const { declared, systemState } = baseInput();
    const result = evaluateRuntimeConformance({
      system_state: systemState,
      declared_architecture: declared,
      invariants: [FORBIDDEN_UI_PAYMENT],
      observations: [observation('component:ui', 'SUCCESS', {}, LATER_WINDOW), observation('component:payment', 'SUCCESS')],
      adapter: structuralRuntimeAdapter,
      producer: PRODUCER,
      evaluated_at: EVALUATED_AT,
    });
    expect(result.records[0]!.evidence.window).toEqual({
      start: CREATED_AT,
      end: '2025-06-01T03:00:00.000Z',
    });
  });
});
