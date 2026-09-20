/**
 * Page renderers — pure functions from view-models (and explicit inputs)
 * to semantic HTML. NO hidden state, NO clocks: everything displayed comes
 * from the view-models; every consequential decision panel links to its
 * rationale chain page (the W11 acceptance).
 */

import type { ImplementationModel } from '@sos-2/semantic-spine';
import type {
  AskVM,
  AssuranceVM,
  CandidateComparisonVM,
  EvidenceVM,
  ExperimentVM,
  HistoryVM,
  MetaStateVM,
  MissionVM,
  RationaleChain,
  ReconciliationVM,
  RepertoireVM,
  RollbackVM,
  SystemStateVM,
} from '@sos-2/ui-contracts';
import type { Confidence } from '@sos-2/evidence';
import type { ConsoleViews, EvidenceQuery } from '../views.js';
import {
  artifactRef,
  badge,
  dl,
  esc,
  page,
  rationaleLink,
  statusBadge,
  table,
  truthStateBadge,
  ul,
} from './html.js';

// ---------------------------------------------------------------------------
// Shared fragments
// ---------------------------------------------------------------------------

function confidenceText(confidence: Confidence): string {
  if (confidence.kind === 'CALIBRATED') {
    return `CALIBRATED ${String(confidence.value)} (calibration ${String(confidence.calibration_ref)})`;
  }
  return `QUALITATIVE ${String(confidence.uncertainty_class)}`;
}

/** The rationale chain panel (upstream/downstream links + evidence refs). */
export function rationalePanel(rationale: RationaleChain): string {
  const renderSide = (title: string, links: readonly { source: string; target: string; type: string }[]): string =>
    links.length === 0
      ? `<p class="empty">${esc(title)}: none</p>`
      : `<h4>${esc(title)}</h4>` +
        links
          .map(
            (link) =>
              `<p class="link-line"><code>${esc(link.source)}</code> —${badge(link.type, 'accent')}→ <code>${esc(link.target)}</code> ${rationaleLink(link.target)}</p>`,
          )
          .join('');
  const evidence =
    rationale.evidence_refs.length === 0
      ? '<p class="empty">evidence refs: none yet (truthful)</p>'
      : `<h4>Evidence refs</h4>` +
        rationale.evidence_refs.map((ref) => `<p class="link-line">${artifactRef(ref)}</p>`).join('');
  return `<div class="rationale-box">
  <strong>Rationale chain</strong> ${rationaleLink(rationale.subject_id)} — subject ${artifactRef(rationale.subject_id)}
  <div class="updown">
    <div>${renderSide('Upstream (origins, inputs, supports)', rationale.upstream)}</div>
    <div>${renderSide('Downstream (consequences, outputs)', rationale.downstream)}</div>
  </div>
  ${evidence}
</div>`;
}

function missionContent(vm: MissionVM): string {
  return `${dl([
    ['Purpose', esc(vm.purpose)],
    ['Version', `v${vm.version} ${statusBadge(vm.status)}`],
    ['Created at', esc(vm.created_at)],
    ['Supersedes', vm.supersedes === null ? 'none (root)' : artifactRef(vm.supersedes)],
    ['Authority', vm.authority_ref === null ? 'none' : artifactRef(vm.authority_ref)],
    ['Provenance', ul(vm.provenance.map(esc))],
  ])}
<h3>Goals</h3>
${table(
  ['id', 'statement', 'status', 'measures'],
  vm.goals.map((goal) => [esc(goal.id), esc(goal.statement), statusBadge(goal.status), ul(goal.measures.map(esc))]),
)}
<h3>Measures</h3>
${table(
  ['id', 'description', 'target', 'unit'],
  vm.measures.map((measure) => [esc(measure.id), esc(measure.description), esc(measure.target ?? '—'), esc(measure.unit ?? '—')]),
)}
<h3>Outcomes</h3>
${table(
  ['id', 'description', 'goals'],
  vm.outcomes.map((outcome) => [esc(outcome.id), esc(outcome.description), ul(outcome.goal_refs.map(esc))]),
)}
<h3>Constraints</h3>
${table(
  ['id', 'statement', 'hard', 'bound'],
  vm.constraints.map((constraint) => [
    esc(constraint.id),
    esc(constraint.statement),
    constraint.hard ? badge('HARD', 'warn') : badge('soft'),
    constraint.bound === null
      ? '—'
      : `${esc(constraint.bound.axis)} ${esc(constraint.bound.direction)} ${esc(String(constraint.bound.limit))}`,
  ]),
)}
<h3>Stakeholders</h3>
${table(
  ['id', 'name', 'interest'],
  vm.stakeholders.map((stakeholder) => [esc(stakeholder.id), esc(stakeholder.name), esc(stakeholder.interest ?? '—')]),
)}
<h3>Assumptions</h3>
${ul(vm.assumptions.map((assumption) => `${esc(assumption.id)}: ${esc(assumption.statement)}`))}
<h3>Ambiguities</h3>
${table(
  ['id', 'statement', 'resolution'],
  vm.ambiguities.map((ambiguity) => [
    esc(ambiguity.id),
    esc(ambiguity.statement),
    ambiguity.resolution === null ? badge('open', 'unknown') : esc(ambiguity.resolution),
  ]),
)}
${rationalePanel(vm.rationale)}`;
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export function renderOverview(views: ConsoleViews): string {
  const world = views.world;
  const evidenceCounts = views.evidence({ subject: null, truth_states: null }).counts_by_truth_state;
  const body = `
<section class="panel">
  <h2>The checkout demo world</h2>
  <p class="lede">One coherent product system governed by SOS: a mission with a revision, a recovered architecture hypothesis, a live system state, evidence in all six truth states, two candidates from different diversity families, a canary experiment, two assurance cases, a promotion with bounded recovery, an authority-insufficient ASK, and a package repertoire — every consequential decision linked to its typed rationale chain.</p>
  ${dl([
    ['Presentation instant (fixed)', `<code>${esc(world.now)}</code>`],
    ['Constitution anchor', artifactRef(world.constitution_id)],
    ['Mission (current)', `${artifactRef(views.mission.id)} v${views.mission.version}`],
    ['Declared architecture (current)', `${artifactRef(views.world.graphs[views.world.graphs.length - 1]!.envelope.id)} v${views.world.graphs[views.world.graphs.length - 1]!.envelope.version}`],
    ['Observed implementation', `${artifactRef(world.observed_model.id)} @ <code>${esc(world.observed_model.revision.slice(0, 12))}…</code>`],
    ['Evidence records (by truth state)', Object.entries(evidenceCounts).map(([state, count]) => `${truthStateBadge(state)} ${count}`).join(' · ')],
    ['Typed trace links in the rationale web', String(world.links.length)],
    ['Package repertoire (diverse families)', views.repertoire.families.map(esc).join(' · ')],
  ])}
</section>
<section class="panel">
  <h2>The twelve journeys</h2>
  <div class="cards">
    <article class="card"><h3>Mission onboarding</h3><p>View the current mission and create a new revision through the domain types.</p><a href="/mission">Open →</a></article>
    <article class="card"><h3>System import</h3><p>Paste an ImplementationModel fixture and see the System State view.</p><a href="/import">Open →</a></article>
    <article class="card"><h3>Architecture / reality reconciliation</h3><p>Declared vs observed vs classification — and why.</p><a href="/reconciliation">Open →</a></article>
    <article class="card"><h3>Evidence investigation</h3><p>Query by subject and truth state; provenance always visible.</p><a href="/evidence">Open →</a></article>
    <article class="card"><h3>Candidate comparison</h3><p>Side-by-side with uncertainty and evidence context.</p><a href="/candidates">Open →</a></article>
    <article class="card"><h3>Assurance review</h3><p>Cases with objections, validity and derived verdicts.</p><a href="/assurance">Open →</a></article>
    <article class="card"><h3>Experiment monitoring</h3><p>Lifecycle, guardrails and stopping triggers.</p><a href="/experiments">Open →</a></article>
    <article class="card"><h3>ASK</h3><p>The structured ask: exact decision, alternatives, trade-offs, risk.</p><a href="/ask">Open →</a></article>
    <article class="card"><h3>Rollback</h3><p>The recovery declaration bound to the promoted change.</p><a href="/rollback">Open →</a></article>
    <article class="card"><h3>Package discovery / composition</h3><p>The diverse repertoire with limitations and failures retained.</p><a href="/packages">Open →</a></article>
    <article class="card"><h3>Architecture history</h3><p>Supersedes chains over time.</p><a href="/history">Open →</a></article>
    <article class="card"><h3>Self-evolution review</h3><p>Read-only projection of the SOS program's own meta state.</p><a href="/evolution">Open →</a></article>
  </div>
</section>`;
  return page('Overview', '/', body);
}

export function renderMission(views: ConsoleViews, created: MissionVM | null, error: string | null): string {
  const world = views.world;
  const form = `
<section class="panel">
  <h2>Create a mission (via the domain types)</h2>
  <p class="lede">The form creates a <code>@sos-2/mission</code> artifact through <code>createMission</code> — the console contains zero domain logic; creation is validated by the mission package and the result is projected back through <code>@sos-2/ui-contracts</code>. Timestamps are explicit (no hidden clocks); the default is the demo presentation instant.</p>
  ${error === null ? '' : `<div class="error-box"><strong>Creation rejected</strong> (the domain validator spoke):<br>${esc(error)}</div>`}
  <form class="stack" method="post" action="/mission">
    <label>Purpose (the mandatory semantic anchor)
      <input type="text" name="purpose" required value="Make checkout continuously better for EU shoppers" />
    </label>
    <label>Goal statement
      <input type="text" name="goal" value="Reduce checkout p95 latency below 250ms in the EU region" />
    </label>
    <label>Measure description
      <input type="text" name="measure_description" value="EU checkout p95 latency" />
    </label>
    <label>Measure target
      <input type="text" name="measure_target" value="&lt;= 250" />
    </label>
    <label>Hard constraint statement
      <input type="text" name="constraint" value="Monthly infrastructure cost stays within budget" />
    </label>
    <label>Provenance entry
      <input type="text" name="provenance" value="W11:console:mission-onboarding" />
    </label>
    <label>Created at (RFC3339, explicit — no hidden clock)
      <input type="text" name="created_at" value="${esc(world.now)}" />
    </label>
    <button type="submit">Create mission</button>
  </form>
</section>`;
  const createdPanel =
    created === null
      ? ''
      : `<section class="panel">
  <h2>Created mission</h2>
  ${missionContent(created)}
</section>`;
  const body = `
<section class="panel">
  <h2>Current mission (v${views.mission.version})</h2>
  ${missionContent(views.mission)}
</section>
<section class="panel">
  <h2>Revision history</h2>
  ${table(
    ['version', 'status', 'created at', 'id'],
    [...views.mission_history, views.mission].map((mission) => [
      `v${mission.version}`,
      statusBadge(mission.status),
      esc(mission.created_at),
      artifactRef(mission.id),
    ]),
  )}
</section>
${createdPanel}
${form}`;
  return page('Mission', '/mission', body);
}

export function renderImport(
  views: ConsoleViews,
  pastedModelJson: string,
  importResult: { system_state: SystemStateVM; reconciliation: ReconciliationVM } | null,
  error: string | null,
): string {
  const demoModelJson = JSON.stringify(views.world.observed_model, null, 2);
  const initial = pastedModelJson === '' ? demoModelJson : pastedModelJson;
  const resultPanel =
    importResult === null
      ? ''
      : `<section class="panel">
  <h2>Imported model — System State view</h2>
  ${renderSystemStateSection(importResult.system_state)}
  <h3>Reconciliation against the declared architecture</h3>
  ${reconciliationTable(importResult.reconciliation)}
</section>`;
  const body = `
<section class="panel">
  <h2>System import</h2>
  <p class="lede">Paste or upload an <strong>ImplementationModel</strong> fixture (JSON). The console validates it against the <code>@sos-2/contracts</code> ImplementationModel contract and renders the System State view plus the reconciliation against the declared architecture. The textarea is prefilled with the demo fixture's observed model.</p>
  ${error === null ? '' : `<div class="error-box"><strong>Import rejected</strong> — the pasted value does not match the ImplementationModel contract:<br>${esc(error)}</div>`}
  <form class="stack" method="post" action="/import">
    <label>ImplementationModel fixture (JSON)
      <textarea name="model" spellcheck="false">${esc(initial)}</textarea>
    </label>
    <button type="submit">Import model</button>
  </form>
</section>
<section class="panel">
  <h2>Current System State (from the demo fixture)</h2>
  ${renderSystemStateSection(views.system_state)}
</section>
${resultPanel}`;
  return page('System import', '/import', body);
}

function renderSystemStateSection(vm: SystemStateVM): string {
  return `${dl([
    ['System State', `${artifactRef(vm.id)} v${vm.version} ${statusBadge(vm.status)}`],
    ['Created at', esc(vm.created_at)],
    ['Architecture hypothesis', `${artifactRef(vm.architecture_ref.artifact_id)} v${vm.architecture_ref.version}`],
    [
      'Observed model',
      vm.observed_model === null
        ? 'none presented'
        : `${artifactRef(vm.observed_model.id)} — ${vm.observed_model.component_count} components, ${vm.observed_model.dependency_count} dependencies @ <code>${esc(vm.observed_model.revision.slice(0, 12))}…</code>`,
    ],
    ['Provenance', ul(vm.provenance.map(esc))],
  ])}
<h3>Implementation (exact revisions)</h3>
${table(
  ['artifact', 'revision kind', 'value'],
  vm.implementation.map((entry) => [artifactRef(entry.artifact_id), esc(entry.revision.kind), `<code>${esc(entry.revision.value)}</code>`]),
)}
<h3>Configuration</h3>
${table(['config', 'version'], vm.configuration.map((entry) => [esc(entry.config_id), `<code>${esc(entry.revision.value)}</code>`]))}
<h3>Deployment</h3>
${table(['deployment', 'environment', 'id'], vm.deployment.map((entry) => [esc(entry.deployment_id), esc(entry.environment), `<code>${esc(entry.revision.value)}</code>`]))}
<h3>Policy</h3>
${table(['policy', 'version'], vm.policy.map((entry) => [esc(entry.policy_id), `v${entry.version}`]))}
<h3>Environment relationships</h3>
${table(['source', 'kind', 'target'], vm.environment_relationships.map((entry) => [esc(entry.source), badge(entry.kind), esc(entry.target)]))}
<h3>Active experiments</h3>
${vm.active_experiments.length === 0 ? '<p class="empty">none</p>' : table(['experiment', 'environment'], vm.active_experiments.map((entry) => [artifactRef(entry.experiment_id), esc(entry.environment)]))}
<h3>Package realizations</h3>
${vm.package_realizations.length === 0 ? '<p class="empty">none</p>' : table(['package', 'version', 'realized by'], vm.package_realizations.map((entry) => [artifactRef(entry.package_id), esc(entry.version), ul(entry.realized_by.map(esc))]))}
${rationalePanel(vm.rationale)}`;
}

function reconciliationTable(vm: ReconciliationVM): string {
  return `${dl([
    ['Observed model', artifactRef(vm.observed_model_id)],
    ['Declared architecture', artifactRef(vm.declared_graph_id)],
    [
      'Findings by classification',
      Object.entries(vm.counts_by_classification)
        .map(([classification, count]) => `${badge(classification, classification === 'DRIFT' || classification === 'CONTRADICTION' ? 'bad' : classification === 'UNKNOWN' ? 'unknown' : 'neutral')} ${count}`)
        .join(' · '),
    ],
  ])}
${table(
  ['subject', 'classification', 'declared', 'observed', 'why (the classifier reason)'],
  vm.rows.map((row) => [
    `<code>${esc(row.subject)}</code>`,
    badge(row.classification, row.classification === 'DRIFT' || row.classification === 'CONTRADICTION' ? 'bad' : row.classification === 'UNKNOWN' ? 'unknown' : 'neutral'),
    esc(row.declared),
    esc(row.observed),
    esc(row.reason),
  ]),
)}
${vm.drift_evidence.length === 0 ? '' : `<h3>Drift evidence records (DRIFT / CONTRADICTION)</h3>${table(
  ['id', 'classification', 'subject', 'availability', 'reason'],
  vm.drift_evidence.map((drift) => [
    artifactRef(drift.id),
    badge(drift.classification, 'bad'),
    `<code>${esc(drift.subject)}</code>`,
    truthStateBadge(drift.availability),
    esc(drift.reason),
  ]),
)}`}
${rationalePanel(vm.rationale)}`;
}

export function renderReconciliation(views: ConsoleViews): string {
  const body = `
<section class="panel">
  <h2>Architecture / reality reconciliation</h2>
  <p class="lede">The declared architecture hypothesis vs the observed implementation — classified by the merged W0.5/W2 authorities into the 7 frozen conformance classes. Every row shows both sides and the classifier's reason; DRIFT and CONTRADICTION additionally produce Evidence-shaped drift records.</p>
  ${reconciliationTable(views.reconciliation)}
</section>`;
  return page('Reconciliation', '/reconciliation', body);
}

export function renderEvidence(views: ConsoleViews, query: EvidenceQuery): string {
  const vm = views.evidence(query);
  const subjects = [...new Set(views.world.evidence.map((record) => record.subject_ref))].sort();
  const body = `
<section class="panel">
  <h2>Evidence investigation</h2>
  <p class="lede">Query the evidence pool by subject and truth state. The six truth states stay distinct — UNKNOWN, UNAVAILABLE and UNSUPPORTED are never conflated; provenance (who/what produced it, how the truth state was assigned) is always visible; LLM-produced records carry their never-authoritative mark.</p>
  <form class="stack" method="get" action="/evidence">
    <label>Subject (artifact id)
      <select name="subject">
        <option value="">— all subjects —</option>
        ${subjects
          .map(
            (subject) =>
              `<option value="${esc(subject)}"${query.subject === subject ? ' selected' : ''}>${esc(subject)}</option>`,
          )
          .join('')}
      </select>
    </label>
    <label>Truth states (ctrl/cmd-click for several; none = all)
      <select name="truth_state" multiple size="6">
        ${(['SUCCESS', 'FAILURE', 'UNKNOWN', 'UNAVAILABLE', 'UNSUPPORTED', 'PARTIAL'] as const)
          .map(
            (state) =>
              `<option value="${state}"${query.truth_states?.includes(state) ? ' selected' : ''}>${state}</option>`,
          )
          .join('')}
      </select>
    </label>
    <button type="submit">Query evidence</button>
  </form>
  <h3>Pool counts by truth state (all 6, never folded)</h3>
  <div class="counts">
    ${Object.entries(vm.counts_by_truth_state)
      .map(([state, count]) => `<span>${truthStateBadge(state)} ${count}</span>`)
      .join('')}
  </div>
  <h3>Records (${vm.rows.length} shown)</h3>
  ${table(
    ['id', 'kind', 'subject', 'truth state', 'class', 'uncertainty', 'freshness', 'producer', 'llm'],
    vm.rows.map((row) => [
      artifactRef(row.id),
      esc(row.kind),
      artifactRef(row.subject_ref),
      truthStateBadge(row.availability),
      badge(row.evidence_class),
      esc(confidenceText(row.confidence)),
      row.freshness === null ? badge('not evaluated') : `${statusBadge(row.freshness.status)}`,
      `<span class="evidence-provenance">${esc(row.producer.tool)}${row.producer.model === null ? '' : ` + ${esc(row.producer.model)}`}<br>method: ${esc(row.method)}</span>`,
      row.llm_output ? badge('LLM OUTPUT — never authoritative', 'unknown') : '',
    ]),
  )}
  <h3>Provenance detail</h3>
  ${table(
    ['id', 'provenance entries', 'source revision', 'deployment revision', 'window'],
    vm.rows.map((row) => [
      artifactRef(row.id),
      ul(row.provenance.map(esc)),
      row.source_revision === null ? '—' : `<code>${esc(row.source_revision)}</code>`,
      row.deployment_revision === null ? '—' : `<code>${esc(row.deployment_revision)}</code>`,
      row.window === null ? '—' : `${esc(row.window.start)} → ${esc(row.window.end)}`,
    ]),
  )}
  ${rationalePanel(vm.rationale)}
</section>`;
  return page('Evidence', '/evidence', body);
}

export function renderCandidates(views: ConsoleViews): string {
  const vm = views.candidates;
  const body = `
<section class="panel">
  <h2>Candidate comparison</h2>
  <p class="lede">Side-by-side over the declared architecture ${artifactRef(vm.base_graph_id)} v${vm.base_graph_version}. No single global score, no ranking into one winner: each side carries its invariants, predicted effects, uncertainty mark and its own evidence context (distinct truth-state counts).</p>
  ${vm.candidates
    .map(
      (side) => `<h3>${artifactRef(side.id)} ${badge(`v${side.version}`)} ${side.causal_claim ? badge('CAUSAL CLAIM', 'warn') : ''}</h3>
${dl([
  ['Invariants', ul(side.invariants.map(esc))],
  ['Predicted effects', ul(side.predicted_effects.map(esc))],
  ['Uncertainty (carried, never authorization)', side.confidence === null ? 'none' : esc(confidenceText(side.confidence))],
  ['Base subject revision', side.base_subject_revision === null ? '—' : `<code>${esc(side.base_subject_revision)}</code>`],
  ['Causal hypothesis', side.hypothesis_ref === null ? '—' : artifactRef(side.hypothesis_ref)],
  ['Bounded subgraph', side.bounded_subgraph_ref === null ? '—' : `${artifactRef(side.bounded_subgraph_ref.graph_id)} v${side.bounded_subgraph_ref.version}`],
  [
    'Evidence context (by truth state)',
    Object.entries(side.evidence.counts_by_truth_state)
      .map(([state, count]) => `${truthStateBadge(state)} ${count}`)
      .join(' · '),
  ],
  ['Evidence refs', side.evidence.refs.length === 0 ? 'none' : ul(side.evidence.refs.map((ref) => artifactRef(ref)))],
])}
${rationaleLink(side.id)}`,
    )
    .join('\n')}
  ${rationalePanel(vm.rationale)}
</section>`;
  return page('Candidates', '/candidates', body);
}

export function renderAssurance(views: ConsoleViews): string {
  const body = views.assurance
    .map(
      (vm) => `<section class="panel">
  <h2>Assurance case ${artifactRef(vm.id)} ${badge(`v${vm.version}`)} ${statusBadge(vm.status)}</h2>
  <p class="lede">Claims, arguments, assumptions, hazards, controls, evidence, validity conditions and first-class objections — with the DERIVED verdict (recomputed by the living evaluation, never stored). Objections are never dropped: open objections surface in the verdict.</p>
  ${dl([
    ['Verdict (derived at ' + esc(vm.evaluated_at ?? '—') + ')', vm.verdict === null ? badge('not evaluated', 'unknown') : statusBadge(vm.verdict)],
    ['Open objections', String(vm.open_objections.length)],
    ['Invalidations', vm.invalidations.length === 0 ? 'none' : ul(vm.invalidations.map((invalidation) => `${badge(invalidation.reason, 'bad')} ${esc(invalidation.subject)} — ${esc(invalidation.message)}`))],
  ])}
  <h3>Claims</h3>
  ${table(['id', 'statement'], vm.claims.map((claim) => [esc(claim.id), esc(claim.statement)]))}
  <h3>Arguments</h3>
  ${table(
    ['id', 'strategy', 'premises', 'conclusion'],
    vm.arguments.map((argument) => [esc(argument.id), esc(argument.strategy), ul(argument.premises.map(esc)), esc(argument.conclusion)]),
  )}
  <h3>Assumptions</h3>
  ${table(['id', 'statement'], vm.assumptions.map((assumption) => [esc(assumption.id), esc(assumption.statement)]))}
  <h3>Hazards &amp; controls</h3>
  ${table(
    ['hazard', 'controls'],
    vm.hazards.map((hazard) => [
      esc(hazard.description),
      ul(
        vm.controls
          .filter((control) => control.addresses.includes(hazard.id))
          .map((control) => `${esc(control.id)}: ${esc(control.mechanism)}`),
      ),
    ]),
  )}
  <h3>Evidence (bound to claims)</h3>
  ${table(
    ['evidence', 'role', 'claim'],
    vm.evidence_refs.map((ref) => [artifactRef(ref.evidence_id), badge(ref.role, ref.role === 'CONTRADICTS' ? 'bad' : 'good'), esc(ref.claim_ref)]),
  )}
  <h3>Validity conditions</h3>
  ${table(
    ['kind', 'subject', 'valid revisions'],
    vm.validity_conditions.map((condition) => [badge(condition.kind), artifactRef(condition.subject), ul(condition.valid_revisions.map((revision) => `<code>${esc(revision)}</code>`))]),
  )}
  <h3>Objections (first-class, never dropped)</h3>
  ${table(
    ['id', 'statement', 'status', 'resolution'],
    vm.objections.map((objection) => [
      esc(objection.id),
      esc(objection.statement),
      statusBadge(objection.status),
      objection.resolution === null
        ? badge('awaiting resolution', 'unknown')
        : `${esc(objection.resolution.note)} <span class="note">(${esc(objection.resolution.resolved_at)})</span>`,
    ]),
  )}
  ${rationalePanel(vm.rationale)}
</section>`,
    )
    .join('\n');
  return page('Assurance', '/assurance', body);
}

export function renderExperiments(views: ConsoleViews): string {
  const vm = views.experiment;
  const body = `
<section class="panel">
  <h2>Experiment ${artifactRef(vm.id)} ${badge(`v${vm.version}`)} ${statusBadge(vm.status)}</h2>
  <p class="lede">Lifecycle, guardrails and stopping triggers. The displayed run is the fixture's simulated canary — honestly marked: simulation is evaluation infrastructure and is never presented as intervention evidence (the promotion gate consumes the REAL canary and rehearsal evidence instead).</p>
  ${dl([
    ['Design kind', badge(vm.design_kind)],
    ['Stage', `${badge(vm.stage.phase, 'accent')} exposure ${vm.stage.exposure_percent}%`],
    ['Canary ladder', vm.canary_ladder.map((step) => `${step}%`).join(' → ')],
    ['Candidate under test', artifactRef(vm.candidate_ref)],
    ['Causal hypothesis', artifactRef(vm.hypothesis_ref)],
    ['Population', `${esc(vm.population.description)} (unit ${badge(vm.population.unit)})`],
    ['Allocation', `${esc(vm.allocation.assignment)} — ${vm.allocation.arms.map((arm) => `${esc(arm.id)}:${badge(arm.role)}`).join(', ')} (ratio ${vm.allocation.ratios.join(':')})`],
    ['Provenance', ul([`created ${esc(vm.created_at)}`])],
  ])}
  <h3>Metrics</h3>
  ${table(
    ['id', 'role', 'description', 'direction', 'guardrail threshold'],
    vm.metrics.map((metric) => [
      esc(metric.id),
      badge(metric.role, metric.role === 'GUARDRAIL' ? 'warn' : metric.role === 'PRIMARY' ? 'accent' : 'neutral'),
      esc(metric.description),
      esc(metric.direction),
      metric.guardrail_threshold === undefined ? '—' : esc(String(metric.guardrail_threshold)),
    ]),
  )}
  ${
    vm.result === null
      ? '<p class="empty">no run yet</p>'
      : `<h3>Latest run</h3>${dl([
    ['Result record', artifactRef(vm.result.id)],
    ['Observed at', esc(vm.result.observed_at)],
    ['Sample size', String(vm.result.sample_size)],
    ['Overall availability (derived)', truthStateBadge(vm.result.overall_availability)],
    ['Simulation mark', vm.result.simulated ? badge('SIMULATED — evaluation infrastructure, never evidence', 'unknown') : badge('real run')],
  ])}`
  }
  <h3>Guardrails (fail-closed)</h3>
  ${table(
    ['metric', 'arm', 'status', 'availability', 'observed', 'threshold', 'why'],
    vm.guardrails.map((guardrail) => [
      esc(guardrail.metric_id),
      esc(guardrail.arm_id),
      statusBadge(guardrail.status),
      truthStateBadge(guardrail.availability),
      guardrail.observed_value === null ? '—' : esc(String(guardrail.observed_value)),
      esc(String(guardrail.threshold)),
      esc(guardrail.reason),
    ]),
  )}
  <h3>Primary metrics</h3>
  ${table(
    ['metric', 'status', 'candidate value', 'comparison', 'why'],
    vm.primary.map((metric) => [
      esc(metric.metric_id),
      statusBadge(metric.status),
      metric.candidate_value === null ? '—' : esc(String(metric.candidate_value)),
      esc(metric.comparison),
      esc(metric.reason),
    ]),
  )}
  <h3>Stopping criteria (typed, with exact conditions)</h3>
  ${table(
    ['rule', 'triggered', 'why', 'exact conditions'],
    vm.stopping.map((trigger) => [
      esc(trigger.rule_id),
      trigger.triggered ? badge('TRIGGERED', 'warn') : badge('not triggered'),
      esc(trigger.reason),
      ul(trigger.conditions.map((condition) => `${condition.satisfied ? '✓' : '✗'} ${esc(condition.condition)}`)),
    ]),
  )}
  <h3>Rollback triggers (wired to guardrails)</h3>
  ${table(
    ['rule', 'triggered', 'why', 'exact conditions'],
    vm.rollback.map((trigger) => [
      esc(trigger.rule_id),
      trigger.triggered ? badge('TRIGGERED', 'bad') : badge('not triggered'),
      esc(trigger.reason),
      ul(trigger.conditions.map((condition) => `${condition.satisfied ? '✓' : '✗'} ${esc(condition.condition)}`)),
    ]),
  )}
  ${rationalePanel(vm.rationale)}
</section>`;
  return page('Experiments', '/experiments', body);
}

export function renderAsk(views: ConsoleViews): string {
  const vm = views.ask;
  const body = `
<section class="panel">
  <h2>ASK — the structured escalation ${badge(`priority ${vm.priority}`, 'warn')}</h2>
  <p class="lede">ASK is a first-class success state: current authority was insufficient, and the engine escalated the EXACT decision together with everything a human needs to decide. Nothing here is an error.</p>
  ${dl([
    ['Ask request', artifactRef(vm.ask_id)],
    ['Originating decision record', artifactRef(vm.decision_record_ref)],
    ['The EXACT decision requested', esc(vm.decision)],
    ['Evidence quality', `${badge(vm.evidence_quality.quality, 'accent')} — ${esc(vm.evidence_quality.summary)}`],
    ['Uncertainty', `${badge(vm.uncertainty.uncertainty_class, 'unknown')} — ${esc(vm.uncertainty.basis)}`],
    ['Risk', `${badge(vm.risk.severity, 'bad')} — ${esc(vm.risk.description)}`],
    ['WHY authority is insufficient', esc(vm.authority_insufficiency)],
  ])}
  <h3>Typed alternatives (each carries a frozen decision action)</h3>
  ${table(
    ['id', 'action', 'description'],
    vm.alternatives.map((alternative) => [esc(alternative.id), badge(alternative.action), esc(alternative.description)]),
  )}
  <h3>Trade-offs in play</h3>
  ${ul(vm.trade_offs.map(esc), true)}
  <h3>Evidence summary (freshness re-evaluated at presentation)</h3>
  ${table(
    ['evidence', 'provided', 'availability', 'class', 'freshness'],
    vm.evidence_summary.map((row) => [
      artifactRef(row.ref),
      row.provided ? badge('provided') : badge('NOT SUPPLIED', 'unknown'),
      row.availability === null ? '—' : truthStateBadge(row.availability),
      row.evidence_class === null ? '—' : badge(row.evidence_class),
      row.freshness === null ? badge('not evaluated') : `${statusBadge(row.freshness)} <span class="note">${esc(row.freshness_reason ?? '')}</span>`,
    ]),
  )}
  <h3>Engine rule trace (which rules fired, in order)</h3>
  ${table(
    ['#', 'rule', 'outcome', 'code', 'reason'],
    vm.rule_trace.map((entry) => [
      String(entry.order),
      esc(entry.rule),
      entry.outcome === null ? badge('pass-through') : badge(entry.outcome, 'warn'),
      entry.code === null ? '—' : `<code>${esc(entry.code)}</code>`,
      esc(entry.reason),
    ]),
  )}
  ${rationalePanel(vm.rationale)}
</section>`;
  return page('ASK', '/ask', body);
}

export function renderRollback(views: ConsoleViews): string {
  const vm = views.rollback;
  const promotion = vm.promotion_decision;
  const body = `
<section class="panel">
  <h2>Rollback — the recovery declaration ${artifactRef(vm.id)} ${badge(`v${vm.version}`)} ${statusBadge(vm.status)}</h2>
  <p class="lede">Every live change declares its bounded recovery: mechanism, trigger, authority and evidence — or an explicit governed exception defining another containment mechanism.</p>
  ${dl([
    ['The live change', artifactRef(vm.change_ref)],
    ['Mechanism', `<strong>${esc(vm.mechanism.kind)}</strong>${vm.mechanism.kind === 'ROLLBACK_DEPLOYMENT' ? ` — back to <code>${esc(vm.mechanism.to_deployment_id)}</code>` : ''}`],
    [
      'Trigger',
      vm.trigger.kind === 'BUDGET'
        ? `BUDGET — ${esc(vm.trigger.metric)} crosses ${esc(vm.trigger.threshold)} within ${esc(String(vm.trigger.window_ms))}ms`
        : vm.trigger.kind === 'DEADLINE'
          ? `DEADLINE — within ${esc(String(vm.trigger.within_ms))}ms`
          : `MANUAL — authority ${esc(vm.trigger.authority_ref)}`,
    ],
    ['Authority (grant)', artifactRef(vm.authority_ref)],
    ['Evidence the containment works', artifactRef(vm.evidence_ref)],
    ['Governed exception', vm.exception === null ? 'none (bounded recovery declared)' : `${esc(vm.exception.containment)} (${artifactRef(vm.exception.authority_ref)})`],
  ])}
  ${
    promotion === null
      ? ''
      : `<h3>The bound promotion decision</h3>${dl([
    ['Decision', badge(promotion.action, 'good')],
    ['Decision record', artifactRef(promotion.id)],
    ['Bounded recovery (the W9 wiring)', promotion.recovery === null ? 'none declared' : `${esc(promotion.recovery.mechanism)} — bound ${esc(String(promotion.recovery.max_recovery_seconds))}s, ${esc(String(promotion.recovery.wired_trigger_count))} wired rollback trigger(s)`],
    ['Gate reasons', ul(promotion.reasons.map(esc))],
  ])}`
  }
  ${rationalePanel(vm.rationale)}
</section>`;
  return page('Rollback', '/rollback', body);
}

export function renderPackages(views: ConsoleViews): string {
  const vm = views.repertoire;
  const body = `
<section class="panel">
  <h2>Package discovery / composition — the repertoire</h2>
  <p class="lede">The diverse candidate set for capability “${esc(vm.capability)}”. No universal winner: every declared family keeps its representative. Uncertainty is never a bare score; evidence context distinguishes resolved from unresolved; learned limitations and failure contexts are retained.</p>
  ${dl([
    ['Families present', vm.families.map((family) => badge(family, 'accent')).join(' ')],
    ['Candidates', String(vm.candidates.length)],
    ['Matched before diversity shaping', String(vm.matched_count)],
    ['Total current registry entries', String(vm.total_current_entries)],
  ])}
  ${vm.candidates
    .map(
      (candidate) => `<article class="card">
  <h3>${esc(candidate.semantic_capability)} ${badge(candidate.kind)} ${badge(candidate.maturity, 'accent')}</h3>
  <p>${artifactRef(candidate.id)} v${candidate.version} — altitude <strong>${esc(candidate.altitude)}</strong>, family <strong>${esc(candidate.family)}</strong> ${candidate.context_match === 'MATCHED' ? badge('context matched') : badge(candidate.context_match, 'unknown')}</p>
  <p><strong>Diversity dimensions</strong></p>
  ${table(
    ['dimension', 'stance'],
    candidate.dimensions.map((stance) => [badge(stance.dimension), esc(stance.stance)]),
  )}
  <p><strong>Applicability (context-conditioned)</strong></p>
  ${table(
    ['kind', 'context', 'uncertainty', 'sample size'],
    candidate.applicability.map((estimate) => [
      badge(estimate.kind),
      esc(Object.entries(estimate.context).map(([key, value]) => `${key}=${value}`).join(', ')),
      estimate.kind === 'CALIBRATED' ? `p=${esc(String(estimate.probability))} (${esc(estimate.uncertainty_class)})` : esc(estimate.uncertainty_class),
      esc(String(estimate.sample_size)),
    ]),
  )}
  <p><strong>Uncertainty for this query</strong>: ${esc(candidate.uncertainty.uncertainty_class)} (${esc(candidate.uncertainty.basis)})</p>
  <p><strong>Evidence context</strong>: ${esc(String(candidate.evidence_context.resolved))} resolved / ${esc(String(candidate.evidence_context.unresolved))} unresolved of ${esc(String(candidate.evidence_context.total_refs))} cited — ${esc(String(candidate.evidence_context.successes))} SUCCESS, ${esc(String(candidate.evidence_context.failures))} FAILURE</p>
  <p><strong>Learned limitations</strong></p>
  ${ul(candidate.learned_limitations.map(esc))}
  <p><strong>Retained failure contexts (negative evidence)</strong></p>
  ${candidate.failure_contexts.length === 0 ? '<p class="empty">none</p>' : table(
    ['evidence', 'availability', 'window', 'subject revision'],
    candidate.failure_contexts.map((failure) => [
      artifactRef(failure.ref),
      truthStateBadge(failure.availability),
      failure.window === null ? '—' : `${esc(failure.window.start)} → ${esc(failure.window.end)}`,
      failure.subject_revision === null ? '—' : `<code>${esc(failure.subject_revision)}</code>`,
    ]),
  )}
  <p><strong>Assurance obligations (reuse never bypasses assurance)</strong></p>
  ${table(
    ['mechanism', 'obligation'],
    candidate.assurance_obligations.map((obligation) => [badge(obligation.kind), esc(obligation.obligation)]),
  )}
  <p>${rationaleLink(candidate.id)}</p>
</article>`,
    )
    .join('\n')}
  <h3>The retrieval decision's rationale (top-ranked entry)</h3>
  <p class="note">Every entry above links to its own rationale chain page; the top-ranked entry's full chain is shown here.</p>
  ${rationalePanel(vm.candidates[0]?.rationale ?? views.rationaleOf(vm.candidates[0]?.id ?? ''))}
</section>`;
  return page('Packages', '/packages', body);
}

export function renderHistory(views: ConsoleViews): string {
  const vm = views.history;
  const body = `
<section class="panel">
  <h2>Architecture history — supersedes chains over time</h2>
  <p class="lede">Versioned, identity-preserving supersede chains per artifact kind (the spine's envelope versioning). History is complete and queryable: every entry keeps its exact version, status, creation instant and provenance.</p>
  ${vm.chains
    .map(
      (chain) => `<h3>${esc(chain.kind)}</h3>
${table(
  ['version', 'status', 'created at', 'id', 'supersedes', 'provenance'],
  chain.chain.map((entry) => [
    `v${entry.version}`,
    statusBadge(entry.status),
    esc(entry.created_at),
    `${artifactRef(entry.id)} ${rationaleLink(entry.id)}`,
    entry.supersedes === null ? 'root' : artifactRef(entry.supersedes),
    ul(entry.provenance.map(esc)),
  ]),
)}
<p class="note">Current head: ${chain.current_head === null ? 'none' : artifactRef(chain.current_head)}</p>`,
    )
    .join('\n')}
  ${rationalePanel(vm.rationale)}
</section>`;
  return page('History', '/history', body);
}

export function renderEvolution(views: ConsoleViews): string {
  const vm = views.meta;
  const body = `
<section class="panel">
  <h2>SOS self-evolution review (read-only)</h2>
  <p class="lede">${esc(vm.self_evolution_note)}</p>
  ${dl([
    ['Program', esc(vm.program)],
    ['Status', statusBadge(vm.status)],
    ['Current frontier', vm.frontier.map((workOrder) => badge(workOrder, 'accent')).join(' ')],
    ['Current task', esc(vm.current_task)],
    ['Merged work orders', String(vm.merged_count)],
    ['Eligible now', vm.eligible.map((workOrder) => badge(workOrder, 'good')).join(' ')],
  ])}
  <h3>Work orders (versioned, dependency-gated, evidence-bound)</h3>
  ${table(
    ['work order', 'status', 'dependencies', 'merged as'],
    vm.tasks.map((task) => [
      esc(task.id),
      statusBadge(
        task.status === 'COMPLETE' || task.status === 'BOOTSTRAP_COMPLETE'
          ? 'SUCCESS'
          : task.status === 'ELIGIBLE'
            ? 'CURRENT'
            : 'UNKNOWN',
      ) + ` <span class="note">${esc(task.status)}</span>`,
      task.dependencies.length === 0 ? '—' : ul(task.dependencies.map(esc)),
      task.mergedAs === null ? '—' : `<code>${esc(task.mergedAs.slice(0, 12))}…</code>`,
    ]),
  )}
  ${rationalePanel(vm.rationale)}
</section>`;
  return page('Self-evolution', '/evolution', body);
}

export function renderRationale(views: ConsoleViews, subjectId: string, found: boolean): string {
  const body = found
    ? `<section class="panel">
  <h2>Rationale chain — ${artifactRef(subjectId)}</h2>
  <p class="lede">The typed, spine-bound explanation: upstream (origins, inputs, supports), downstream (consequences, outputs) and the exact evidence refs. Every link is one of the 17 frozen trace types; a decision without a rationale chain cannot exist in this console.</p>
  ${rationalePanel(views.rationaleOf(subjectId))}
</section>`
    : `<section class="panel">
  <h2>Rationale chain — ${artifactRef(subjectId)}</h2>
  <div class="error-box"><strong>No typed trace links mention this artifact</strong> — there is nothing to explain yet (a rationale chain without trace links is rejected by contract).</div>
</section>`;
  return page('Rationale', '/rationale', body);
}

/** Render the full page set (used by the determinism hash test). */
export function renderAllPages(views: ConsoleViews): Map<string, string> {
  const pages = new Map<string, string>();
  pages.set('/', renderOverview(views));
  pages.set('/mission', renderMission(views, null, null));
  pages.set('/import', renderImport(views, '', null, null));
  pages.set('/reconciliation', renderReconciliation(views));
  pages.set('/evidence', renderEvidence(views, { subject: null, truth_states: null }));
  pages.set('/candidates', renderCandidates(views));
  pages.set('/assurance', renderAssurance(views));
  pages.set('/experiments', renderExperiments(views));
  pages.set('/ask', renderAsk(views));
  pages.set('/rollback', renderRollback(views));
  pages.set('/packages', renderPackages(views));
  pages.set('/history', renderHistory(views));
  pages.set('/evolution', renderEvolution(views));
  for (const subject of new Set(views.world.links.flatMap((link) => [link.source, link.target]))) {
    pages.set(`/rationale?id=${encodeURIComponent(subject)}`, renderRationale(views, subject, true));
  }
  return pages;
}

export type { ImplementationModel };
