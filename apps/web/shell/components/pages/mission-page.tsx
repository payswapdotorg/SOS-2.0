/**
 * The Mission page — purpose, goals with measures and statuses, outcomes,
 * stakeholders, constraints (with their machine-checkable bounds),
 * assumptions, ambiguities with resolution state, and the revision note —
 * with the six-question structure via the rationale deep-link.
 */

import { PageShell, PageHeading } from '../page-shell';
import { Card, Row } from '../card';
import { ValueChip } from '../chips';
import { rationaleHref, views } from '../../view-state/demo-data';

export function MissionPage() {
  const mission = views.mission;
  const fixtureRevision = views.source.kind === 'DEMO' ? views.source.fixture_revision : undefined;
  return (
    <PageShell section="mission">
      <PageHeading
        title="Mission"
        intro="The mission anchors every change: what the system is for, how success is measured, and which limits are hard."
        demoRevision={fixtureRevision}
      />
      <div className="space-y-4">
        <Card id="mission-purpose" title="Purpose" demoRevision={fixtureRevision} rationaleHref={rationaleHref(mission.envelope.id)}>
          <p className="text-base text-ink">{mission.content.purpose}</p>
          <p className="mt-2 flex flex-wrap gap-1.5">
            <ValueChip label="version" value={`v${String(mission.envelope.version)}`} />
            <ValueChip label="status" value={mission.envelope.status} />
            <ValueChip label="created" value={mission.envelope.created_at} />
          </p>
        </Card>

        <Card id="mission-goals" title="Goals and measures" demoRevision={fixtureRevision}>
          <ul className="space-y-3">
            {mission.content.goals.map((goal) => (
              <li key={goal.id} className="rounded-lg border border-line bg-surface p-3">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-ink">{goal.statement}</span>
                  <ValueChip label="status" value={goal.status} title="Frozen mission goal vocabulary: PROPOSED, MEASURABLE, ACHIEVED." />
                </p>
                {goal.measures.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-sm text-ink-soft">
                    {goal.measures.map((measureId) => {
                      const measure = mission.content.measures.find((entry) => entry.id === measureId);
                      return measure ? (
                        <li key={measure.id}>
                          {measure.description}
                          {measure.target !== null ? ` — target ${measure.target}${measure.unit !== null ? ` ${measure.unit}` : ''}` : ' — target not formalized yet'}
                        </li>
                      ) : null;
                    })}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-ink-soft">No measures attached yet (progressive formalization).</p>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <Card id="mission-outcomes" title="Outcomes and stakeholders" demoRevision={fixtureRevision}>
          <dl>
            {mission.content.outcomes.map((outcome) => (
              <Row key={outcome.id} label={`Outcome: ${outcome.id}`}>
                {outcome.description}
              </Row>
            ))}
            {mission.content.stakeholders.map((stakeholder) => (
              <Row key={stakeholder.id} label={stakeholder.name}>
                {stakeholder.interest ?? 'Interest not recorded'}
              </Row>
            ))}
          </dl>
        </Card>

        <Card id="mission-constraints" title="Constraints and assumptions" demoRevision={fixtureRevision}>
          <dl>
            {mission.content.constraints.map((constraint) => (
              <Row key={constraint.id} label={constraint.hard ? 'Hard constraint' : 'Preference'}>
                {constraint.statement}
                {constraint.bound !== null ? (
                  <span className="ml-2 font-mono text-xs text-ink-soft">
                    {constraint.bound.axis} {constraint.bound.direction === 'MAX' ? '≤' : '≥'} {String(constraint.bound.limit)}
                  </span>
                ) : null}
              </Row>
            ))}
            {mission.content.assumptions.map((assumption) => (
              <Row key={assumption.id} label="Assumption">
                {assumption.statement}
              </Row>
            ))}
            {mission.content.ambiguities.map((ambiguity) => (
              <Row key={ambiguity.id} label={ambiguity.resolution !== null ? 'Ambiguity (resolved)' : 'Ambiguity (open)'}>
                {ambiguity.statement}
                {ambiguity.resolution !== null ? <span className="block text-ink-soft">{ambiguity.resolution}</span> : null}
              </Row>
            ))}
          </dl>
        </Card>

        <Card id="mission-history" title="Revision history" demoRevision={fixtureRevision}>
          <p className="text-sm text-ink">
            This is revision {String(mission.envelope.version)}
            {mission.envelope.supersedes !== null ? `, superseding ${mission.envelope.supersedes}` : ''}.
          </p>
          {views.missionHistory.length > 0 ? (
            <ul className="mt-2 space-y-1 text-sm text-ink-soft">
              {views.missionHistory.map((previous) => (
                <li key={previous.envelope.id}>
                  <span className="font-mono text-xs">{previous.envelope.id}</span> — {previous.envelope.status} · {previous.envelope.created_at}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-3">
            <a href="/history" className="inline-flex min-h-[44px] items-center rounded-md px-1 text-sm font-medium text-epistemic underline-offset-2 hover:underline">
              Open the full timeline
            </a>
          </p>
        </Card>
      </div>
    </PageShell>
  );
}
