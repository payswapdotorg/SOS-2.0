/**
 * The Changes page — the current change story: what is changing, why (the
 * causal hypothesis), the predicted effects and invariants, the
 * experimental protection (stages, guardrails, rollback criteria), the
 * rollback rehearsal evidence, the authority held, and the gated next
 * step. The alternative candidate from a different diversity family is
 * shown too (the repertoire is not collapsed into one winner).
 */

import Link from 'next/link';
import { gateNextAction, actionAvailabilityLabel } from '@sos-2/web-contracts';
import { PageShell, PageHeading } from '../page-shell';
import { Card, Row } from '../card';
import { TruthStateChip, ValueChip } from '../chips';
import { StateBlockView } from '../state-block';
import { rationaleHref, views } from '../../view-state/demo-data';

export function ChangesPage() {
  const change = views.currentChange;
  const fixtureRevision = views.source.kind === 'DEMO' ? views.source.fixture_revision : undefined;
  const advanceAction = views.experimentStatus.core.next_allowed_action;
  const advanceAvailability = gateNextAction({
    action: advanceAction,
    data_source: views.source,
    grant_held: true,
  });
  const alternative = views.candidates.find((candidate) => candidate.envelope.id !== change.candidate_id);

  return (
    <PageShell section="changes">
      <PageHeading
        title="Changes"
        intro="What is being changed, why SOS believes it helps, and how the change is protected while it rolls out."
        demoRevision={fixtureRevision}
      />
      <div className="space-y-4">
        <Card
          id="change-current"
          title="Current change"
          chip={<ValueChip label="candidate" value="durable-queue" />}
          demoRevision={fixtureRevision}
          rationaleHref={rationaleHref(change.candidate_id)}
        >
          <p className="text-base font-medium text-ink">{change.title}</p>
          <dl className="mt-2">
            <Row label="Predicted effects">
              <ul className="list-inside list-disc">
                {change.predicted_effects.map((effect) => (
                  <li key={effect}>{effect}</li>
                ))}
              </ul>
            </Row>
            <Row label="Must keep holding">
              <ul className="list-inside list-disc">
                {change.invariants.map((invariant) => (
                  <li key={invariant}>{invariant}</li>
                ))}
              </ul>
            </Row>
            <Row label="Confidence">
              {change.confidence_class} — {change.core.uncertainty.statement}
            </Row>
          </dl>
        </Card>

        <Card id="change-protection" title="Protection" demoRevision={fixtureRevision} rationaleHref={rationaleHref(change.experiment_ref ?? change.candidate_id)}>
          <dl>
            <Row label="Experiment">
              <Link href="/experiments" className="font-medium text-epistemic underline-offset-2 hover:underline">
                Canary at 10% exposure
              </Link>
              <span className="ml-2 text-ink-soft">with two wired guardrails and explicit rollback criteria.</span>
            </Row>
            <Row label="Rollback rehearsal">
              {change.rollback_evidence_refs.map((ref) => (
                <span key={ref} className="mr-2 inline-flex items-center gap-1.5">
                  <TruthStateChip state="SUCCESS" />
                  <Link href={rationaleHref(ref)} className="font-mono text-xs underline-offset-2 hover:underline">
                    {ref}
                  </Link>
                </span>
              ))}
              <span className="block text-xs text-ink-soft">A timed rollback rehearsal succeeded — recovery is rehearsed, not assumed.</span>
            </Row>
            <Row label="Authority held">
              {change.core.authority.note}
            </Row>
          </dl>
        </Card>

        <Card id="change-next" title="Next step (gated)" demoRevision={fixtureRevision}>
          <p className="text-sm font-medium text-ink">{advanceAction.label}</p>
          <p className="mt-1 text-sm text-ink-soft">{advanceAction.description}</p>
          <p className="mt-2 flex flex-wrap gap-1.5">
            <ValueChip label="availability" value={actionAvailabilityLabel(advanceAvailability)} title={advanceAvailability.reason} />
            <ValueChip label="requires" value={advanceAction.requires_authority ?? 'no permission'} />
          </p>
          {advanceAvailability.kind === 'NOT_AVAILABLE_IN_DEMO' ? (
            <div className="mt-3">
              <StateBlockView
                block={{
                  kind: 'UNAVAILABLE',
                  surface: 'execute-advance-canary',
                  statement: 'Real execution is not wired in this console build.',
                  present: null,
                  missing: null,
                  action: advanceAvailability.reason,
                }}
              />
            </div>
          ) : null}
        </Card>

        <Card id="change-alternative" title="Alternative under study" demoRevision={fixtureRevision} rationaleHref={alternative ? rationaleHref(alternative.envelope.id) : undefined}>
          {alternative ? (
            <>
              <p className="text-sm text-ink">
                An edge-cache candidate from the <span className="font-medium">latency-optimized</span> family is also under study —
                the repertoire deliberately keeps materially different solution families.
              </p>
              <p className="mt-2 flex flex-wrap gap-1.5">
                <ValueChip label="shadow observation" value="UNKNOWN — analysis pending" title="The shadow render was paused when its body was lost; the observation is not yet analyzed." />
              </p>
            </>
          ) : (
            <p className="text-sm text-ink-soft">No alternative candidate is currently under study.</p>
          )}
        </Card>
      </div>
    </PageShell>
  );
}
