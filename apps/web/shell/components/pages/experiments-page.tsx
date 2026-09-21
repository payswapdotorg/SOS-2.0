/**
 * The Experiments page — the controlled evolution plane: design (population,
 * allocation arms, metrics with roles and guardrail thresholds), the staged
 * exposure ladder, stopping and rollback criteria, the honestly-marked
 * SIMULATED evaluation, and the gated next step.
 */

import { actionAvailabilityLabel, gateNextAction } from '@sos-2/web-contracts';
import { PageShell, PageHeading } from '../page-shell';
import { Card, Row } from '../card';
import { ValueChip } from '../chips';
import { StateBlockView } from '../state-block';
import { rationaleHref, views } from '../../view-state/demo-data';

export function ExperimentsPage() {
  const vm = views.experimentStatus;
  const fixtureRevision = views.source.kind === 'DEMO' ? views.source.fixture_revision : undefined;
  const nextAction = vm.core.next_allowed_action;
  const availability = gateNextAction({ action: nextAction, data_source: views.source, grant_held: true });

  return (
    <PageShell section="experiments">
      <PageHeading
        title="Experiments"
        intro="Controlled changes with staged exposure: design → approve → shadow → canary → monitor → stop, roll back or promote."
        demoRevision={fixtureRevision}
      />
      <div className="space-y-4">
        <Card
          id="experiment-stage"
          title={vm.title}
          chip={<ValueChip label={vm.phase} value={`${String(vm.exposure_percent)}% exposure`} />}
          demoRevision={fixtureRevision}
          rationaleHref={rationaleHref(vm.experiment_id)}
        >
          <p className="flex flex-wrap gap-1.5">
            <ValueChip label="ladder" value={vm.canary_ladder.map((step) => `${String(step)}%`).join(' → ')} />
            <ValueChip label="candidate" value="durable queue" title={vm.candidate_ref} />
          </p>
          <p className="mt-3 text-sm text-ink">
            Production checkout requests in the EU region during peak hours; deterministic hash allocation,
            9 parts control to 1 part treatment.
          </p>
        </Card>

        <Card id="experiment-metrics" title="Metrics and guardrails" demoRevision={fixtureRevision}>
          <ul className="space-y-2">
            {vm.metrics.map((metric) => (
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
                {vm.stopping_criteria.map((criterion, index) => (
                  <li key={index}>{criterion.description}</li>
                ))}
              </ul>
            </Row>
            <Row label="Roll back when">
              <ul className="list-inside list-disc">
                {vm.rollback_criteria.map((criterion) => (
                  <li key={criterion.id}>{criterion.description}</li>
                ))}
              </ul>
            </Row>
          </dl>
        </Card>

        <Card id="experiment-evaluation" title="Evaluation (honestly simulated)" demoRevision={fixtureRevision} rationaleHref={rationaleHref(vm.experiment_id)}>
          <p className="text-sm text-ink" data-simulated="true">{vm.evaluation_summary}</p>
          <p className="mt-2 flex flex-wrap gap-1.5">
            <ValueChip label="simulated" value={vm.run_is_simulated ? 'yes' : 'no'} />
            {vm.simulator !== null ? <ValueChip label="simulator" value={`v${vm.simulator.version} · seed ${String(vm.simulator.seed)}`} /> : null}
          </p>
          <p className="mt-3 text-sm text-ink-soft">
            Simulation is evaluation infrastructure: it never counts as intervention evidence, and live guardrail
            telemetry that the collector cannot produce stays UNSUPPORTED rather than guessed.
          </p>
        </Card>

        <Card id="experiment-next" title="Next step (gated)" demoRevision={fixtureRevision}>
          <p className="text-sm font-medium text-ink">{nextAction.label}</p>
          <p className="mt-2 flex flex-wrap gap-1.5">
            <ValueChip label="availability" value={actionAvailabilityLabel(availability)} title={availability.reason} />
            <ValueChip label="requires" value={nextAction.requires_authority ?? 'no permission'} />
          </p>
          {availability.kind === 'NOT_AVAILABLE_IN_DEMO' ? (
            <div className="mt-3">
              <StateBlockView
                block={{
                  kind: 'UNAVAILABLE',
                  surface: 'execute-advance-canary',
                  statement: 'Real execution is not wired in this console build.',
                  present: null,
                  missing: null,
                  action: availability.reason,
                }}
              />
            </div>
          ) : null}
        </Card>
      </div>
    </PageShell>
  );
}
