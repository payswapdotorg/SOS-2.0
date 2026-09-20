/**
 * Journey tests — the twelve required W11 journeys, their routes and the
 * acceptance content on each page: every consequential decision exposes
 * its rationale chain; truth states stay distinct; uncertainty and
 * provenance are visible.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { assembleViews } from '../src/views.js';
import type { DemoWorld } from '../src/demo/build-demo.js';
import {
  renderAsk,
  renderAssurance,
  renderCandidates,
  renderEvidence,
  renderEvolution,
  renderExperiments,
  renderHistory,
  renderImport,
  renderMission,
  renderOverview,
  renderPackages,
  renderReconciliation,
  renderRollback,
} from '../src/render/pages.js';

const here = dirname(fileURLToPath(import.meta.url));
const world = JSON.parse(readFileSync(join(here, '..', 'fixtures', 'demo.json'), 'utf8')) as DemoWorld;
const views = assembleViews(world);

describe('journey 1 — mission onboarding (/mission)', () => {
  const html = renderMission(views, null, null);
  test('shows the current mission and the revision history', () => {
    expect(html).toContain('Current mission (v2)');
    expect(html).toContain('Revision history');
    expect(html).toContain('SUPERSEDED');
  });
  test('offers creation through the domain types with explicit timestamps', () => {
    expect(html).toContain('Create a mission (via the domain types)');
    expect(html).toContain('name="created_at"');
    expect(html).toContain('no hidden clock');
  });
  test('exposes the rationale chain', () => {
    expect(html).toContain('Rationale chain');
    expect(html).toContain('/rationale?id=');
  });
});

describe('journey 2 — system import (/import)', () => {
  const html = renderImport(views, '', null, null);
  test('shows the System State view with the eight sections', () => {
    expect(html).toContain('Current System State');
    for (const section of ['Implementation (exact revisions)', 'Configuration', 'Deployment', 'Policy', 'Environment relationships', 'Active experiments', 'Package realizations']) {
      expect(html).toContain(section);
    }
  });
  test('offers paste/upload of an ImplementationModel fixture', () => {
    expect(html).toContain('ImplementationModel fixture (JSON)');
    expect(html).toContain('name="model"');
  });
  test('the demo model imports cleanly and reconciles', () => {
    const result = views.importModel(views.world.observed_model);
    expect(result.reconciliation.rows.length).toBeGreaterThan(0);
    const importHtml = renderImport(views, '', result, null);
    expect(importHtml).toContain('Imported model — System State view');
  });
  test('invalid pasted models are rejected truthfully', () => {
    const importHtml = renderImport(views, 'nonsense', null, 'the value does not match the ImplementationModel contract');
    expect(importHtml).toContain('Import rejected');
  });
});

describe('journey 3 — architecture/reality reconciliation (/reconciliation)', () => {
  const html = renderReconciliation(views);
  test('declared vs observed vs classification + why', () => {
    expect(html).toContain('declared');
    expect(html).toContain('observed');
    expect(html).toContain('why (the classifier reason)');
  });
  test('all 7 frozen classification counts are shown', () => {
    for (const classification of ['IMPLEMENTATION_DETAIL', 'EXPECTED_VARIATION', 'PRESERVING_REFINEMENT', 'INTENTIONAL_EVOLUTION', 'DRIFT', 'UNKNOWN', 'CONTRADICTION']) {
      expect(html).toContain(classification);
    }
  });
});

describe('journey 4 — evidence investigation (/evidence)', () => {
  const html = renderEvidence(views, { subject: null, truth_states: null });
  test('all 6 truth states are displayed distinctly', () => {
    for (const state of ['SUCCESS', 'FAILURE', 'UNKNOWN', 'UNAVAILABLE', 'UNSUPPORTED', 'PARTIAL']) {
      expect(html).toContain(`>${state}<`);
    }
  });
  test('the demo pool covers every truth state (never conflated)', () => {
    const counts = views.evidence({ subject: null, truth_states: null }).counts_by_truth_state;
    for (const state of ['SUCCESS', 'FAILURE', 'UNKNOWN', 'UNAVAILABLE', 'UNSUPPORTED', 'PARTIAL'] as const) {
      expect(counts[state]).toBeGreaterThan(0);
    }
  });
  test('provenance, producer and LLM marks are visible', () => {
    expect(html).toContain('method:');
    expect(html).toContain('otel-collector');
    expect(html).toContain('LLM OUTPUT — never authoritative');
  });
  test('query by subject filters rows', () => {
    const subject = world.evidence[0]!.subject_ref;
    const filtered = views.evidence({ subject, truth_states: null });
    expect(filtered.rows.length).toBeGreaterThan(0);
    expect(filtered.rows.every((row) => row.subject_ref === subject)).toBe(true);
  });
  test('query by truth state filters rows', () => {
    const filtered = views.evidence({ subject: null, truth_states: ['FAILURE'] });
    expect(filtered.rows.length).toBeGreaterThan(0);
    expect(filtered.rows.every((row) => row.availability === 'FAILURE')).toBe(true);
  });
});

describe('journey 5 — candidate comparison (/candidates)', () => {
  const html = renderCandidates(views);
  test('side-by-side with uncertainty and evidence context', () => {
    expect(html).toContain('Candidate comparison');
    expect(html).toContain('Uncertainty (carried, never authorization)');
    expect(html).toContain('Evidence context (by truth state)');
  });
  test('both diversity families are present with no winner ranking', () => {
    expect(html).toContain('No single global score');
    expect(views.candidates.candidates).toHaveLength(2);
  });
});

describe('journey 6 — assurance review (/assurance)', () => {
  const html = renderAssurance(views);
  test('cases with objections, validity and derived verdicts', () => {
    expect(html).toContain('OBJECTIONED');
    expect(html).toContain('VALID');
    expect(html).toContain('Objections (first-class, never dropped)');
    expect(html).toContain('open objection');
  });
  test('the open objection is visible with its statement', () => {
    expect(html).toContain('objection-single-region');
    expect(html).toContain('failover behavior elsewhere is unproven');
  });
});

describe('journey 7 — experiment monitoring (/experiments)', () => {
  const html = renderExperiments(views);
  test('lifecycle, guardrails and stopping triggers', () => {
    expect(html).toContain('CANARY');
    expect(html).toContain('Guardrails (fail-closed)');
    expect(html).toContain('Stopping criteria (typed, with exact conditions)');
    expect(html).toContain('Rollback triggers (wired to guardrails)');
  });
  test('the simulated run is honestly marked', () => {
    expect(html).toContain('SIMULATED — evaluation infrastructure, never evidence');
  });
  test('guardrail statuses and exact conditions are shown', () => {
    expect(html).toContain('SATISFIED');
    expect(html).toContain('sample_size');
  });
});

describe('journey 8 — ASK (/ask)', () => {
  const html = renderAsk(views);
  test('the structured ask: exact decision, alternatives, evidence quality, uncertainty, trade-offs, risk, authority insufficiency', () => {
    expect(html).toContain('The EXACT decision requested');
    expect(html).toContain('Typed alternatives (each carries a frozen decision action)');
    expect(html).toContain('Evidence quality');
    expect(html).toContain('Uncertainty');
    expect(html).toContain('Trade-offs in play');
    expect(html).toContain('Risk');
    expect(html).toContain('WHY authority is insufficient');
  });
  test('ASK is presented as a success state with the rule trace', () => {
    expect(html).toContain('ASK is a first-class success state');
    expect(html).toContain('Engine rule trace (which rules fired, in order)');
    expect(html).toContain('R4_UNCERTAINTY');
  });
});

describe('journey 9 — rollback (/rollback)', () => {
  const html = renderRollback(views);
  test('the recovery declaration view: mechanism, trigger, authority, evidence', () => {
    expect(html).toContain('ROLLBACK_DEPLOYMENT');
    expect(html).toContain('BUDGET');
    expect(html).toContain('Evidence the containment works');
  });
  test('the bound promotion decision (ACT) with its bounded recovery', () => {
    expect(html).toContain('The bound promotion decision');
    expect(html).toContain('ACT');
    expect(html).toContain('wired rollback trigger');
  });
});

describe('journey 10 — package discovery/composition (/packages)', () => {
  const html = renderPackages(views);
  test('the repertoire view with diversity dimensions, limitations and failures', () => {
    expect(html).toContain('Diversity dimensions');
    expect(html).toContain('Learned limitations');
    expect(html).toContain('Retained failure contexts (negative evidence)');
    expect(html).toContain('Assurance obligations (reuse never bypasses assurance)');
  });
  test('three families stay distinct (no collapse into a winner)', () => {
    expect(views.repertoire.families.sort()).toEqual(['balanced-composition', 'cost-optimized', 'latency-optimized']);
    expect(views.repertoire.candidates).toHaveLength(3);
  });
  test('the retained failure context is visible', () => {
    expect(html).toContain('Retained failure contexts (negative evidence)');
    // The latency-optimized family carries one retained FAILURE context.
    const latencyEntry = views.repertoire.candidates.find((candidate) => candidate.family === 'latency-optimized');
    expect(latencyEntry?.failure_contexts).toHaveLength(1);
    expect(latencyEntry?.failure_contexts[0]?.availability).toBe('FAILURE');
    expect(html).toContain('>FAILURE<');
  });
});

describe('journey 11 — architecture history (/history)', () => {
  const html = renderHistory(views);
  test('supersedes chains over time', () => {
    expect(html).toContain('supersedes chains over time');
    expect(html).toContain('ArchitectureGraph');
    expect(html).toContain('Mission');
    expect(html).toContain('SystemState');
  });
  test('chains are complete and ordered oldest -> newest', () => {
    for (const chain of views.history.chains) {
      expect(chain.chain[0]?.supersedes).toBeNull();
      for (let index = 1; index < chain.chain.length; index += 1) {
        expect(chain.chain[index]?.supersedes).toBe(chain.chain[index - 1]?.id);
      }
      expect(chain.current_head).toBe(chain.chain[chain.chain.length - 1]?.id);
    }
  });
});

describe('journey 12 — SOS self-evolution review (/evolution)', () => {
  const html = renderEvolution(views);
  test('read-only projection of the meta state', () => {
    expect(html).toContain('read-only');
    expect(html).toContain('W11');
    expect(html).toContain('W12');
    expect(html).toContain('Work orders (versioned, dependency-gated, evidence-bound)');
  });
  test('the meta state mirrors the canonical machine state', () => {
    expect(views.meta.merged_count).toBe(13); // W0 bootstrap + W0.5-W10 + W13
    expect(views.meta.eligible).toEqual(['W11', 'W12']);
  });
});

describe('W11 acceptance — every consequential decision exposes rationale', () => {
  const pages: readonly [string, string][] = [
    ['mission', renderMission(views, null, null)],
    ['import', renderImport(views, '', null, null)],
    ['reconciliation', renderReconciliation(views)],
    ['evidence', renderEvidence(views, { subject: null, truth_states: null })],
    ['candidates', renderCandidates(views)],
    ['assurance', renderAssurance(views)],
    ['experiments', renderExperiments(views)],
    ['ask', renderAsk(views)],
    ['rollback', renderRollback(views)],
    ['packages', renderPackages(views)],
    ['history', renderHistory(views)],
    ['evolution', renderEvolution(views)],
  ];

  test('every journey page carries a rationale chain panel with typed links', () => {
    for (const [name, html] of pages) {
      expect(html).toContain('Rationale chain');
      expect(html).toContain('Upstream (origins, inputs, supports)');
      expect(html).toContain('Downstream (consequences, outputs)');
      expect(html, `${name} must link rationale pages`).toContain('/rationale?id=');
    }
  });

  test('the overview lists all twelve journeys', () => {
    const html = renderOverview(views);
    for (const journey of ['Mission onboarding', 'System import', 'reconciliation', 'Evidence investigation', 'Candidate comparison', 'Assurance review', 'Experiment monitoring', 'ASK', 'Rollback', 'Package discovery / composition', 'Architecture history', 'Self-evolution review']) {
      expect(html).toContain(journey);
    }
  });

  test('every rationale chain in the demo web has at least one typed trace link', () => {
    const subjects = new Set(world.links.flatMap((link) => [link.source, link.target]));
    expect(subjects.size).toBeGreaterThan(10);
    for (const subject of subjects) {
      const chain = views.rationaleOf(subject);
      expect(chain.upstream.length + chain.downstream.length).toBeGreaterThan(0);
    }
  });
});
