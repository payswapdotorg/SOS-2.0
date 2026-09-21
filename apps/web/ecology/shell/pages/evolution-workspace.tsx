/**
 * The Evolution workspace (Work Order P10, the /experiments surface) — the
 * controlled evolution plane in BOTH directions:
 *
 *   1. the controlled EXPERIMENT on the system (the canary: design,
 *      guardrails, the honestly-simulated evaluation, the gated next step);
 *   2. the SELF-EVOLUTION of SOS itself (the process revision chain with
 *      the exact restore after the rolled-back trial, the non-disableable
 *      governance guard with its retained typed rejection, the retained
 *      failure memory, the learned rules and the machine state) — read
 *      from canonical live state through the @sos-2/live-store
 *      repositories, READ-ONLY (the console observes self-evolution, it
 *      never steers it).
 */

import Link from 'next/link';
import { actionAvailabilityLabel, gateNextAction } from '@sos-2/web-contracts';
import { PageShell, PageHeading } from '../../../shell/components/page-shell';
import { Card, Row } from '../../../shell/components/card';
import { StateBlockView } from '../../../shell/components/state-block';
import { ValueChip } from '../../../shell/components/chips';
import { ecologyViews } from '../../view-state/ecology-data';

export async function EvolutionWorkspace() {
  const views = await ecologyViews();
  const experiment = views.experimentStatus;
  const evolution = views.evolution;
  const fixtureRevision = evolution.core.data_source.kind === 'DEMO' ? evolution.core.data_source.fixture_revision : undefined;
  const experimentNext = experiment.core.next_allowed_action;
  const experimentAvailability = gateNextAction({ action: experimentNext, data_source: experiment.core.data_source, grant_held: true });

  return (
    <PageShell section="experiments">
      <PageHeading
        title="Experiments and self-evolution"
        intro="Controlled change in both directions: the canary experiment changing the system under staged exposure, and SOS applying the same loop to itself — process revisions under a non-disableable guard, with failures retained as memory."
        demoRevision={fixtureRevision}
      />

      <div className="space-y-6">
        {/* 1. The controlled experiment (the canary) */}
        <section aria-labelledby="controlled-experiment" className="space-y-4">
          <h2 id="controlled-experiment" className="text-lg font-semibold text-ink">
            Controlled experiment — the system
          </h2>
          <Card
            id="experiment-stage"
            title={experiment.title}
            chip={<ValueChip label={experiment.phase} value={`${String(experiment.exposure_percent)}% exposure`} />}
            demoRevision={fixtureRevision}
            rationaleHref={views.rationaleHref(experiment.experiment_id)}
          >
            <p className="flex flex-wrap gap-1.5">
              <ValueChip label="ladder" value={experiment.canary_ladder.map((step) => `${String(step)}%`).join(' → ')} />
              <ValueChip label="candidate" value="durable queue" title={experiment.candidate_ref} />
            </p>
            <p className="mt-3 text-sm text-ink">
              Production checkout requests in the EU region during peak hours; deterministic hash allocation, 9 parts control to 1 part treatment.
            </p>
          </Card>

          <Card id="experiment-metrics" title="Metrics and guardrails" demoRevision={fixtureRevision}>
            <ul className="space-y-2">
              {experiment.metrics.map((metric) => (
                <li key={metric.metric_id} className="flex flex-wrap items-center gap-2 text-sm">
                  <ValueChip label={metric.role} value={metric.metric_id} title={metric.description} />
                  <span className="text-ink">{metric.description}</span>
                  {metric.guardrail_threshold !== null ? (
                    <span className="text-xs font-medium text-warn">guardrail at most {String(metric.guardrail_threshold)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>

          <Card id="experiment-criteria" title="Stopping and rollback criteria" demoRevision={fixtureRevision}>
            <dl>
              <Row label="Stop when">
                <ul className="list-inside list-disc">
                  {experiment.stopping_criteria.map((criterion, index) => (
                    <li key={index}>{criterion.description}</li>
                  ))}
                </ul>
              </Row>
              <Row label="Roll back when">
                <ul className="list-inside list-disc">
                  {experiment.rollback_criteria.map((criterion) => (
                    <li key={criterion.id}>{criterion.description}</li>
                  ))}
                </ul>
              </Row>
            </dl>
          </Card>

          <Card id="experiment-evaluation" title="Evaluation (honestly simulated)" demoRevision={fixtureRevision} rationaleHref={views.rationaleHref(experiment.experiment_id)}>
            <p className="text-sm text-ink" data-simulated="true">
              {experiment.evaluation_summary}
            </p>
            <p className="mt-2 flex flex-wrap gap-1.5">
              <ValueChip label="simulated" value={experiment.run_is_simulated ? 'yes' : 'no'} />
              {experiment.simulator !== null ? <ValueChip label="simulator" value={`v${experiment.simulator.version} · seed ${String(experiment.simulator.seed)}`} /> : null}
            </p>
          </Card>

          <Card id="experiment-next" title="Next step (gated)" demoRevision={fixtureRevision}>
            <p className="text-sm font-medium text-ink">{experimentNext.label}</p>
            <p className="mt-2 flex flex-wrap gap-1.5">
              <ValueChip label="availability" value={actionAvailabilityLabel(experimentAvailability)} title={experimentAvailability.reason} />
              <ValueChip label="requires" value={experimentNext.requires_authority ?? 'no permission'} />
            </p>
            {experimentAvailability.kind === 'NOT_AVAILABLE_IN_DEMO' ? (
              <p className="mt-3 text-sm text-ink-soft">{experimentAvailability.reason}</p>
            ) : null}
          </Card>
        </section>

        {/* 2. The self-evolution of SOS itself */}
        <section aria-labelledby="self-evolution" className="space-y-4">
          <h2 id="self-evolution" className="text-lg font-semibold text-ink">
            Self-evolution — SOS itself
          </h2>
          <p className="max-w-3xl text-sm text-ink-soft">{evolution.read_only_note}</p>
          <p className="flex flex-wrap gap-1.5">
            <ValueChip label="read from" value={evolution.live_read.store_ref} title="The self-evolution records were read through the @sos-2/live-store repositories (never from fixture objects directly)." />
            <ValueChip label="families read" value={String(evolution.live_read.families_read.length)} title={evolution.live_read.families_read.join(', ')} />
            <ValueChip label="as of" value={evolution.live_read.as_of} />
          </p>

          {evolution.state_blocks.map((block) => (
            <StateBlockView key={block.surface} block={block} />
          ))}

          <Card
            id="process-chain"
            title="The process revision chain (the evolvable surface)"
            chip={<ValueChip label="revisions" value={String(evolution.process_chain.entries.length)} />}
            demoRevision={fixtureRevision}
          >
            <ol className="relative space-y-4 border-l-2 border-line pl-5">
              {evolution.process_chain.entries.map((entry, index, all) => {
                const restoredTo = index > 0 && all.slice(0, index).some((earlier) => earlier.parameters_digest === entry.parameters_digest);
                return (
                  <li key={entry.process_id} className="relative">
                    <span
                      aria-hidden="true"
                      className={`absolute -left-[27px] top-1.5 h-3 w-3 rounded-full border-2 ${
                        entry.status === 'ACTIVE' ? 'border-ok bg-ok-soft' : entry.status === 'RETIRED' ? 'border-stop bg-stop-soft' : 'border-line-strong bg-surface'
                      }`}
                    />
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-ink">{entry.notes}</span>
                      <ValueChip label="version" value={`v${String(entry.version)}`} />
                      <ValueChip label="status" value={entry.status} />
                      <ValueChip label="at" value={entry.created_at} />
                    </p>
                    <p className="mt-1 text-xs text-ink-soft">
                      Parameters digest <span className="font-mono">{entry.parameters_digest.slice(0, 16)}…</span>
                      {restoredTo ? ' — byte-equal to the baseline parameters (the exact restore)' : ''}
                    </p>
                    <p className="mt-1 text-xs text-ink-soft">
                      search policy {entry.parameters.strategy.search_policy} · exploration {String(entry.parameters.strategy.exploration_rate)} · per-family cap{' '}
                      {String(entry.parameters.strategy.max_candidates_per_family)} · validated altitudes{' '}
                      {String(entry.parameters.retrieval_weights.VALIDATED_COMPOSITION)}/{String(entry.parameters.retrieval_weights.VALIDATED_PACKAGE)}
                    </p>
                  </li>
                );
              })}
            </ol>
          </Card>

          <Card id="guard-status" title="The governance guard (non-disableable)" chip={<ValueChip label="status" value="ENFORCING" title="The guard is outside the evolvable surface — it cannot be weakened by any meta-change." />} demoRevision={fixtureRevision}>
            <p className="text-sm text-ink">{evolution.guard.note}</p>
            <dl className="mt-3">
              <Row label="Frozen invariants">
                <ul className="flex flex-wrap gap-1.5">
                  {evolution.guard.invariants.map((invariant) => (
                    <li key={invariant}>
                      <ValueChip label="invariant" value={invariant} />
                    </li>
                  ))}
                </ul>
              </Row>
              <Row label="Evolvable keys (the guard is outside them)">
                <p className="text-xs text-ink-soft">{evolution.guard.evolvable_keys.join(', ')}</p>
              </Row>
              <Row label="Retained rejections">
                {evolution.guard.rejections.length === 0 ? (
                  <span className="text-sm text-ink-soft">No governance-weakening attempt is recorded.</span>
                ) : (
                  <ul className="space-y-2">
                    {evolution.guard.rejections.map((rejection) => (
                      <li key={rejection.change_id} className="rounded-lg border border-stop/30 bg-stop-soft p-3 text-sm" data-guard-rejection={rejection.code}>
                        <p className="font-medium text-stop">
                          {rejection.code} — {rejection.invariant}
                        </p>
                        <p className="mt-1 text-ink">{rejection.reason}</p>
                        <p className="mt-1 text-xs text-ink-soft">attempted keys: {rejection.attempted_keys.join(', ')}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </Row>
            </dl>
          </Card>

          <Card id="failure-memory" title="Retained failure memory (never deleted)" demoRevision={fixtureRevision} rationaleHref={`/history/revision/ArchitectureMemory/${evolution.failure_memory.memories[0]?.memory_id.slice('sos://ArchitectureMemory/'.length) ?? ''}`}>
            <p className="text-sm text-ink">{evolution.failure_memory.note}</p>
            <ul className="mt-3 space-y-2">
              {evolution.failure_memory.memories.flatMap((memory) => memory.entries).map((entry) => (
                <li key={entry.id} className="rounded-lg border border-line bg-surface-warm p-3 text-sm" data-memory-entry={entry.entry_kind}>
                  <p className="flex flex-wrap items-center gap-1.5">
                    <ValueChip label="entry" value={entry.entry_kind} />
                    <ValueChip label="recorded" value={entry.recorded_at} />
                    {entry.severity !== null ? <ValueChip label="severity" value={entry.severity} /> : null}
                    {entry.owner_kind !== null ? <ValueChip label="owner" value={entry.owner_kind} /> : null}
                    {entry.resolution !== null ? <ValueChip label="resolution" value={entry.resolution.state} /> : null}
                  </p>
                  <p className="mt-1 text-ink">{entry.statement}</p>
                  {entry.context_facts.length > 0 ? <p className="mt-1 text-xs text-ink-soft">context: {entry.context_facts.join(' · ')}</p> : null}
                </li>
              ))}
            </ul>
          </Card>

          <Card id="learned-rules" title="Learned rules (evidence-bound, context-scoped)" demoRevision={fixtureRevision}>
            <ul className="space-y-2">
              {evolution.learned_rules.map((rule) => (
                <li key={rule.id} className="rounded-lg border border-line bg-surface-warm p-3 text-sm" data-learned-rule={rule.id}>
                  <p className="text-ink">{rule.statement}</p>
                  <p className="mt-1 flex flex-wrap gap-1.5">
                    <ValueChip label="applicability" value={Object.entries(rule.applicability).map(([key, value]) => `${key}=${String(value)}`).join(', ')} />
                    <ValueChip label="uncertainty" value={rule.uncertainty_class} />
                  </p>
                </li>
              ))}
              {evolution.learned_rules.length === 0 ? <li className="text-sm text-ink-soft">No learned rule is recorded yet.</li> : null}
            </ul>
          </Card>

          <Card id="machine-state" title="Machine state (the program's own governance)" demoRevision={fixtureRevision}>
            {evolution.machine_state === null ? (
              <p className="text-sm text-ink-soft">No development-state snapshot is stored yet.</p>
            ) : (
              <dl>
                <Row label="Program">
                  {evolution.machine_state.program} — {evolution.machine_state.status}
                </Row>
                <Row label="Current task">{evolution.machine_state.current_task}</Row>
                <Row label="Frontier">
                  <p className="flex flex-wrap gap-1.5">
                    {evolution.machine_state.frontier.map((task) => (
                      <ValueChip key={task} label="work order" value={task} />
                    ))}
                  </p>
                </Row>
                <Row label="Snapshot">
                  {evolution.machine_state.state_id} · revision {String(evolution.machine_state.revision)} · updated {evolution.machine_state.updated_at}
                </Row>
              </dl>
            )}
          </Card>

          <Card id="evolution-next" title="Next step (read-only)" demoRevision={fixtureRevision}>
            <p className="text-sm font-medium text-ink">{evolution.core.next_allowed_action.label}</p>
            <p className="mt-1 text-sm text-ink-soft">{evolution.core.next_allowed_action.description}</p>
            <p className="mt-2">
              <Link href={evolution.core.next_allowed_action.href ?? '/history'} className="inline-flex min-h-[44px] items-center rounded-md px-1 text-sm font-medium text-epistemic underline-offset-2 hover:underline">
                Open the process revision diff
              </Link>
            </p>
          </Card>
        </section>
      </div>
    </PageShell>
  );
}
