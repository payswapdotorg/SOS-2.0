/**
 * The GOLDEN brownfield scenario (W15) — a fake legacy system
 * ("merch-catalog-legacy", an e-commerce catalog service stack) as pure,
 * deterministic JSON: modules, dependencies, interfaces, structural runtime
 * observations and OTel-shaped telemetry traces, the declared
 * ("as-documented") architecture, the executable invariant set, the package
 * population (three families: the incumbent legacy implementation plus two
 * reusable replacement families), the optimization goal (replace the legacy
 * search component with a reusable durable-queue-backed search index), the
 * fixed-seed experiment specification with BOTH worlds (nominal and
 * degraded — the degraded world breaches the error-rate guardrail and drives
 * the ROLLBACK path variant), the authority specification and the learning
 * specification.
 *
 * The scenario is intentionally AMBIGUOUS (observed kind "service" plus
 * grouped shard realizations) so recovery produces COMPETING hypotheses,
 * and intentionally DRIFTED (a declared reporting component that no longer
 * exists, an undeclared cache module) so reconciliation classifies real
 * differences across multiple frozen classes.
 */

import { deriveDeterministicArtifactId } from '@sos-2/semantic-spine';
import type { BrownfieldFixtureJson } from './fixture.js';

/** The single loop instant (no hidden clocks). */
export const GOLDEN_NOW = '2025-06-01T00:00:00.000Z';
/** The snapshot capture instant (window start of the ingested evidence). */
export const GOLDEN_CAPTURED_AT = '2025-05-30T00:00:00.000Z';
/** The exact source revision of the golden legacy tree. */
export const GOLDEN_REVISION = 'f7a3c59e1b2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a';
/** The deterministic governance anchor for the golden scenario. */
export const GOLDEN_AUTHORITY_ANCHOR = deriveDeterministicArtifactId('Constitution', {
  note: 'w15 brownfield golden scenario governance anchor',
  scenario: 'merch-catalog-legacy',
});

const GOLDEN_PRODUCER = {
  tool: 'w15-brownfield-harness',
  tool_version: '1.0.0',
  model: null,
  model_version: null,
  command: 'node apps/brownfield-harness/dist/main.js',
  environment: 'brownfield:golden-scenario',
};

const GOLDEN_PROVENANCE = ['W15:brownfield-golden-scenario'];

/** The golden scenario fixture (pure JSON, deterministic). */
export const GOLDEN_BROWNFIELD_SCENARIO: BrownfieldFixtureJson = {
  now: GOLDEN_NOW,
  producer: GOLDEN_PRODUCER,
  provenance: GOLDEN_PROVENANCE,
  authority_ref: GOLDEN_AUTHORITY_ANCHOR,

  snapshot: {
    system_name: 'merch-catalog-legacy',
    revision: GOLDEN_REVISION,
    created_at: GOLDEN_CAPTURED_AT,
    modules: [
      {
        id: 'legacy-catalog',
        kind: 'service',
        path: 'services/catalog/index.ts',
        revision: GOLDEN_REVISION,
        realizes: [],
        realized_by: ['services/catalog/handlers.ts'],
      },
      {
        id: 'legacy-search',
        kind: 'service',
        path: 'services/search/index.ts',
        revision: GOLDEN_REVISION,
        realizes: [],
        realized_by: ['services/search/query.ts'],
      },
      {
        id: 'legacy-index',
        kind: 'library',
        path: 'packages/catalog-index/src/index.ts',
        revision: GOLDEN_REVISION,
        realizes: [],
        realized_by: [],
      },
      {
        id: 'legacy-index-shard-a',
        kind: 'library',
        path: 'packages/catalog-index/src/shard-a.ts',
        revision: GOLDEN_REVISION,
        realizes: ['store:catalog-index'],
        realized_by: [],
      },
      {
        id: 'legacy-index-shard-b',
        kind: 'library',
        path: 'packages/catalog-index/src/shard-b.ts',
        revision: GOLDEN_REVISION,
        realizes: ['store:catalog-index'],
        realized_by: [],
      },
      {
        id: 'legacy-cache',
        kind: 'library',
        path: 'packages/edge-cache/src/index.ts',
        revision: GOLDEN_REVISION,
        realizes: [],
        realized_by: [],
      },
    ],
    interfaces: [
      {
        id: 'iface:catalog-api',
        provider: 'legacy-catalog',
        contract_ref: null,
        consumers: ['legacy-search'],
      },
    ],
    dependencies: [
      { source: 'legacy-catalog', target: 'legacy-search', kind: 'uses' },
      { source: 'legacy-search', target: 'legacy-index', kind: 'uses' },
      { source: 'legacy-search', target: 'legacy-index-shard-a', kind: 'uses' },
      { source: 'legacy-search', target: 'legacy-index-shard-b', kind: 'uses' },
      { source: 'legacy-index-shard-a', target: 'legacy-index-shard-b', kind: 'uses' },
    ],
    runtime_observations: [
      {
        subject_ref: 'legacy-catalog',
        availability: 'SUCCESS',
        window: { start: GOLDEN_CAPTURED_AT, end: GOLDEN_NOW },
        observed: null,
        attributes: {
          'runtime.node_kind': 'Component',
          'runtime.edges': [
            { target: 'legacy-search', kind: 'Dependency' },
            { target: 'iface:catalog-api', kind: 'Provides' },
          ],
        },
        producer: GOLDEN_PRODUCER,
      },
      {
        subject_ref: 'legacy-search',
        availability: 'SUCCESS',
        window: { start: GOLDEN_CAPTURED_AT, end: GOLDEN_NOW },
        observed: null,
        attributes: {
          'runtime.node_kind': 'Component',
          'runtime.edges': [
            { target: 'legacy-index', kind: 'Dependency' },
            { target: 'legacy-index-shard-a', kind: 'Dependency' },
            { target: 'legacy-index-shard-b', kind: 'Dependency' },
            { target: 'iface:catalog-api', kind: 'Consumes' },
          ],
        },
        producer: GOLDEN_PRODUCER,
      },
      {
        subject_ref: 'legacy-index',
        availability: 'SUCCESS',
        window: { start: GOLDEN_CAPTURED_AT, end: GOLDEN_NOW },
        observed: null,
        attributes: {
          'runtime.node_kind': 'Component',
          'runtime.edges': [{ target: 'store:catalog-index', kind: 'Owns' }],
        },
        producer: GOLDEN_PRODUCER,
      },
      {
        subject_ref: 'legacy-index-shard-a',
        availability: 'SUCCESS',
        window: { start: GOLDEN_CAPTURED_AT, end: GOLDEN_NOW },
        observed: null,
        attributes: {
          'runtime.node_kind': 'Component',
          'runtime.edges': [{ target: 'legacy-index-shard-b', kind: 'Dependency' }],
        },
        producer: GOLDEN_PRODUCER,
      },
      {
        subject_ref: 'legacy-index-shard-b',
        availability: 'SUCCESS',
        window: { start: GOLDEN_CAPTURED_AT, end: GOLDEN_NOW },
        observed: null,
        attributes: { 'runtime.node_kind': 'Component', 'runtime.edges': [] },
        producer: GOLDEN_PRODUCER,
      },
      {
        subject_ref: 'legacy-cache',
        availability: 'PARTIAL',
        window: { start: GOLDEN_CAPTURED_AT, end: GOLDEN_NOW },
        observed: null,
        attributes: { 'runtime.node_kind': 'Component', 'runtime.edges': [] },
        producer: GOLDEN_PRODUCER,
      },
    ],
    telemetry_traces: {
      spans: [
        {
          traceId: 'd4cda95b652f4a1592b4f4d2ba58d011',
          spanId: '6e0c63257de34c01',
          parentSpanId: null,
          name: 'POST /catalog/query',
          kind: 'SERVER',
          startTimeUnixNano: '1748563200000000000',
          endTimeUnixNano: '1748563200123000000',
          status: { code: 'OK', message: null },
          attributes: { 'http.status_code': 200 },
          resource: {
            attributes: {
              'service.name': 'legacy-catalog',
              'telemetry.sdk.version': '1.28.0',
              'deployment.environment.name': 'production',
            },
          },
        },
        {
          traceId: 'd4cda95b652f4a1592b4f4d2ba58d022',
          spanId: '6e0c63257de34c02',
          parentSpanId: '6e0c63257de34c01',
          name: 'GET /internal/search',
          kind: 'CLIENT',
          startTimeUnixNano: '1748563200010000000',
          endTimeUnixNano: '1748563200090000000',
          status: { code: 'OK', message: null },
          attributes: { 'peer.service': 'legacy-search' },
          resource: {
            attributes: {
              'service.name': 'legacy-search',
              'telemetry.sdk.version': '1.28.0',
              'deployment.environment.name': 'production',
            },
          },
        },
      ],
      metrics: [
        {
          metricName: 'catalog.search.latency_ms',
          metricKind: 'GAUGE',
          timeUnixNano: '1748563200123000000',
          value: 82.5,
          attributes: { region: 'eu-1' },
          resource: {
            attributes: {
              'service.name': 'legacy-search',
              'telemetry.sdk.version': '1.28.0',
              'deployment.environment.name': 'production',
            },
          },
        },
      ],
      logs: [
        {
          timeUnixNano: '1748563200124000000',
          severityNumber: 9,
          severityText: 'INFO',
          body: 'catalog query completed',
          attributes: {},
          resource: {
            attributes: {
              'service.name': 'legacy-catalog',
              'telemetry.sdk.version': '1.28.0',
              'deployment.environment.name': 'production',
            },
          },
        },
      ],
    },
  },

  declared: {
    nodes: [
      { id: 'capability:catalog', kind: 'Capability', criticality: 'normal', attributes: {} },
      { id: 'legacy-catalog', kind: 'Component', criticality: 'critical', attributes: { language: 'typescript' } },
      { id: 'legacy-search', kind: 'Component', criticality: 'normal', attributes: { language: 'typescript' } },
      { id: 'legacy-index', kind: 'Component', criticality: 'normal', attributes: { language: 'typescript' } },
      { id: 'store:catalog-index', kind: 'DataStore', criticality: 'critical', attributes: { engine: 'embedded' } },
      { id: 'iface:catalog-api', kind: 'Interface', criticality: 'normal', attributes: { protocol: 'https' } },
      { id: 'legacy-reporting', kind: 'Component', criticality: 'normal', attributes: { language: 'python' } },
    ],
    edges: [
      { source: 'legacy-catalog', target: 'capability:catalog', kind: 'Realizes', criticality: 'normal', attributes: {} },
      { source: 'legacy-catalog', target: 'iface:catalog-api', kind: 'Provides', criticality: 'normal', attributes: {} },
      { source: 'legacy-catalog', target: 'legacy-search', kind: 'Dependency', criticality: 'normal', attributes: {} },
      { source: 'legacy-search', target: 'iface:catalog-api', kind: 'Consumes', criticality: 'normal', attributes: {} },
      { source: 'legacy-search', target: 'legacy-index', kind: 'Dependency', criticality: 'normal', attributes: {} },
      { source: 'legacy-index', target: 'store:catalog-index', kind: 'Owns', criticality: 'normal', attributes: {} },
      { source: 'legacy-reporting', target: 'legacy-catalog', kind: 'Dependency', criticality: 'normal', attributes: {} },
    ],
    provenance: [...GOLDEN_PROVENANCE, 'brownfield:declared-architecture-of-merch-catalog-legacy'],
    created_at: GOLDEN_CAPTURED_AT,
  },

  invariants: [
    { kind: 'FORBIDDEN_DEPENDENCY', fromKind: 'Component', toKind: 'DataStore' },
    { kind: 'DATA_OWNERSHIP' },
  ],

  packages: [
    {
      key: 'incumbent',
      content: {
        semantic_capability: 'search-indexing',
        contracts: ['contract:legacy-search-runtime/v1'],
        preconditions: ['an embedded catalog index on disk'],
        postconditions: ['query results served from the embedded index'],
        applicability: [
          {
            kind: 'QUALITATIVE',
            uncertainty_class: 'MODERATE',
            context: { environment: 'production', system: 'merch-catalog-legacy' },
            sample_size: 12,
            window: null,
          },
        ],
        assurance_obligations: [{ kind: 'TEST', obligation: 'legacy search runtime regression suite passes' }],
        context: { environment: 'production', system: 'merch-catalog-legacy' },
        learned_limitations: ['embedded index cannot outlive a single process; no durability'],
        diversity_profile: {
          family: 'legacy-monolith',
          dimensions: [
            { dimension: 'OPERATIONAL_COMPLEXITY', stance: 'low — one process, one index' },
            { dimension: 'RESILIENCE', stance: 'low — in-process only, no failover' },
          ],
        },
        changes: 'initial discovery of the incumbent legacy search implementation',
      },
      evidence: [
        {
          kind: 'package-evaluation',
          availability: 'SUCCESS',
          evidence_class: 'OBSERVATIONAL',
          method: 'evaluation:production-observation',
          provenance: ['W15:golden-scenario:incumbent-evidence-1'],
        },
        {
          kind: 'package-evaluation',
          availability: 'SUCCESS',
          evidence_class: 'OBSERVATIONAL',
          method: 'evaluation:production-observation',
          provenance: ['W15:golden-scenario:incumbent-evidence-2'],
        },
      ],
      target_maturity: 'DISCOVERED',
    },
    {
      key: 'durable-queue',
      content: {
        semantic_capability: 'search-indexing',
        contracts: ['contract:durable-search-index/v2'],
        preconditions: ['a message broker with at-least-once delivery'],
        postconditions: ['index updates durably queued', 'queries served from the rebuilt index'],
        applicability: [
          {
            kind: 'QUALITATIVE',
            uncertainty_class: 'STRONG',
            context: { environment: 'production', deployment: 'central' },
            sample_size: 9,
            window: null,
          },
        ],
        assurance_obligations: [
          { kind: 'TEST', obligation: 'durable queue integration tests pass' },
          { kind: 'FAULT_INJECTION', obligation: 'broker restart does not lose queued index updates' },
        ],
        context: { environment: 'production', deployment: 'central' },
        learned_limitations: ['adds broker operational dependency'],
        diversity_profile: {
          family: 'durable-queue',
          dimensions: [
            { dimension: 'RESILIENCE', stance: 'high — durable queue survives node loss' },
            { dimension: 'COST', stance: 'moderate — broker infrastructure' },
            { dimension: 'LATENCY', stance: 'moderate — queue hop adds milliseconds' },
          ],
        },
        changes: 'initial discovery of the durable-queue search-index package family',
      },
      evidence: [
        {
          kind: 'package-evaluation',
          availability: 'SUCCESS',
          evidence_class: 'OBSERVATIONAL',
          method: 'evaluation:reference-benchmark',
          provenance: ['W15:golden-scenario:durable-queue-evidence-1'],
        },
        {
          kind: 'package-evaluation',
          availability: 'SUCCESS',
          evidence_class: 'OBSERVATIONAL',
          method: 'evaluation:reference-benchmark',
          provenance: ['W15:golden-scenario:durable-queue-evidence-2'],
        },
        {
          kind: 'package-evaluation',
          availability: 'SUCCESS',
          evidence_class: 'INTERVENTIONAL',
          method: 'evaluation:controlled-rollout',
          provenance: ['W15:golden-scenario:durable-queue-evidence-3'],
        },
      ],
      target_maturity: 'VALIDATED',
    },
    {
      key: 'edge-cache',
      content: {
        semantic_capability: 'search-indexing',
        contracts: ['contract:edge-cache-index/v1'],
        preconditions: ['edge POPs with local memory'],
        postconditions: ['hot queries served from edge cache', 'cache invalidation on index rebuild'],
        applicability: [
          {
            kind: 'QUALITATIVE',
            uncertainty_class: 'WEAK',
            context: { environment: 'production', deployment: 'edge' },
            sample_size: 3,
            window: null,
          },
        ],
        assurance_obligations: [{ kind: 'SHADOW', obligation: 'edge cache serves consistent results in shadow' }],
        context: { environment: 'production', deployment: 'edge' },
        learned_limitations: ['cold-start regions see cache misses'],
        diversity_profile: {
          family: 'edge-cache',
          dimensions: [
            { dimension: 'LATENCY', stance: 'very low — edge-local hits' },
            { dimension: 'COST', stance: 'low — commodity edge POPs' },
            { dimension: 'RESILIENCE', stance: 'moderate — eventual consistency' },
          ],
        },
        changes: 'initial discovery of the edge-cache search-index package family',
      },
      evidence: [
        {
          kind: 'package-evaluation',
          availability: 'SUCCESS',
          evidence_class: 'OBSERVATIONAL',
          method: 'evaluation:reference-benchmark',
          provenance: ['W15:golden-scenario:edge-cache-evidence-1'],
        },
        {
          kind: 'package-evaluation',
          availability: 'SUCCESS',
          evidence_class: 'OBSERVATIONAL',
          method: 'evaluation:reference-benchmark',
          provenance: ['W15:golden-scenario:edge-cache-evidence-2'],
        },
        {
          kind: 'package-evaluation',
          availability: 'SUCCESS',
          evidence_class: 'INTERVENTIONAL',
          method: 'evaluation:controlled-rollout',
          provenance: ['W15:golden-scenario:edge-cache-evidence-3'],
        },
      ],
      target_maturity: 'VALIDATED',
    },
  ],

  goal: {
    capability: 'search-indexing',
    query_context: { environment: 'production', deployment: 'central' },
    constraints: [
      {
        id: 'cost-cap',
        statement: 'The replacement must not exceed the monthly infrastructure budget envelope.',
        hard: true,
        bound: { axis: 'monthly_cost', direction: 'MAX', limit: 400 },
      },
      {
        id: 'latency-goal',
        statement: 'Search p99 latency should stay under 200ms (soft mission goal, not machine-checked).',
        hard: false,
        bound: null,
      },
    ],
    mission_ref: 'mission:catalog-search-modernization',
    objective_axes: [
      { axis: 'COST', direction: 'MINIMIZE' },
      { axis: 'LATENCY', direction: 'MINIMIZE' },
      { axis: 'RESILIENCE', direction: 'MAXIMIZE' },
    ],
    predicted_estimates_by_key: {
      incumbent: { COST: 120, LATENCY: 180, RESILIENCE: 20, monthly_cost: 120 },
      'durable-queue': { COST: 300, LATENCY: 120, RESILIENCE: 85, monthly_cost: 300 },
      'edge-cache': { COST: 90, LATENCY: 45, RESILIENCE: 55, monthly_cost: 90 },
    },
    repertoire_edges: {
      COST: [150, 250],
      LATENCY: [80, 140],
    },
    fitness_axis: { axis: 'LATENCY', direction: 'MINIMIZE' },
    target_component: 'legacy-search',
    replacement_id: 'legacy-search-optimized',
    replacement_kind: 'Component',
    hypothesis_statement:
      'Replacing the legacy search component with a reusable search-indexing package from a validated family reduces search latency while preserving the declared architecture invariants.',
    predicted_effects: [
      'search p99 latency falls below 200ms',
      'search error rate stays below the 5% guardrail threshold',
      'the catalog index remains durably owned by exactly one component',
    ],
  },

  experiment: {
    population_description: 'Catalog search traffic in the production region.',
    unit: 'REQUEST',
    canary_ladder: [1, 5, 25, 50],
    canary_exposure_percent: 5,
    metrics: [
      {
        id: 'search-latency-p99-ms',
        role: 'PRIMARY',
        description: 'Search p99 latency in milliseconds (lower is better).',
        direction: 'DECREASE',
      },
      {
        id: 'search-error-rate',
        role: 'GUARDRAIL',
        description: 'Search error rate (fraction of failed requests).',
        direction: 'DECREASE',
        guardrail_threshold: 0.05,
      },
      {
        id: 'search-throughput-qps',
        role: 'SECONDARY',
        description: 'Search throughput in queries per second (higher is better).',
        direction: 'INCREASE',
      },
    ],
    stopping_criteria: [{ kind: 'MAX_SAMPLES', max_samples: 2000 }],
    rollback_criteria: [
      {
        id: 'rollback-error-rate',
        guardrail_metric_ids: ['search-error-rate'],
        description: 'Roll back when the search error-rate guardrail is breached or cannot be established (fail-closed).',
      },
    ],
    seed: 20250601,
    samples_per_arm: 500,
    nominal_effects: [
      { arm_id: 'control', metric_id: 'search-latency-p99-ms', true_mean: 185, noise_std: 10 },
      { arm_id: 'treatment', metric_id: 'search-latency-p99-ms', true_mean: 128, noise_std: 9 },
      { arm_id: 'control', metric_id: 'search-error-rate', true_mean: 0.02, noise_std: 0.004 },
      { arm_id: 'treatment', metric_id: 'search-error-rate', true_mean: 0.012, noise_std: 0.003 },
      { arm_id: 'control', metric_id: 'search-throughput-qps', true_mean: 950, noise_std: 40 },
      { arm_id: 'treatment', metric_id: 'search-throughput-qps', true_mean: 1310, noise_std: 55 },
    ],
    degraded_effects: [
      { arm_id: 'control', metric_id: 'search-latency-p99-ms', true_mean: 185, noise_std: 10 },
      { arm_id: 'treatment', metric_id: 'search-latency-p99-ms', true_mean: 141, noise_std: 12 },
      { arm_id: 'control', metric_id: 'search-error-rate', true_mean: 0.02, noise_std: 0.004 },
      { arm_id: 'treatment', metric_id: 'search-error-rate', true_mean: 0.087, noise_std: 0.006 },
      { arm_id: 'control', metric_id: 'search-throughput-qps', true_mean: 950, noise_std: 40 },
      { arm_id: 'treatment', metric_id: 'search-throughput-qps', true_mean: 1120, noise_std: 60 },
    ],
  },

  authority: {
    grantee: 'agent:w15-brownfield-loop',
    permissions: ['READ', 'PROMOTE'],
    expires_at: '2025-07-01T00:00:00.000Z',
  },

  learning: {
    transfer_target_context: { environment: 'production', system: 'merch-catalog-legacy' },
    decay_signals: [
      {
        package_key: 'incumbent',
        kind: 'USAGE_DECAY',
        note: 'A validated replacement family advanced through the loop; review the incumbent legacy-monolith package usage.',
      },
    ],
    nominal_rule:
      'For catalog search modernization, validated search-indexing package families satisfied the declared invariants and the simulated guardrails; promotion still requires current intervention evidence before the live change.',
    rollback_rule:
      'For bounded component replacements in this system, wire the error-rate guardrail before any exposure: the degraded world breached it and the loop rolled back within the declared recovery bound.',
  },
};
