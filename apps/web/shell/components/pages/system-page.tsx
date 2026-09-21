/**
 * The System page — the current system condition with exact
 * implementation / deployment / configuration / policy revisions, the
 * architecture reference, active experiments, package realizations,
 * environment relationships, observation coverage, and the honest
 * UNAVAILABLE block for live deployment signals (not connected in this
 * build).
 */

import { PageShell, PageHeading } from '../page-shell';
import { Card, Row } from '../card';
import { ConditionChip, ValueChip } from '../chips';
import { StateBlockView } from '../state-block';
import { notConnectedBlock } from '../../view-state/state-selection';
import { rationaleHref, views } from '../../view-state/demo-data';

export function SystemPage() {
  const system = views.systemState;
  const condition = views.systemCondition;
  const fixtureRevision = views.source.kind === 'DEMO' ? views.source.fixture_revision : undefined;
  return (
    <PageShell section="system">
      <PageHeading
        title="System"
        intro="The current system state with the exact revisions it observes — implementation, deployment, configuration and policy."
        demoRevision={fixtureRevision}
      />
      <div className="space-y-4">
        <Card
          id="system-condition"
          title="Current system condition"
          chip={<ConditionChip condition={condition.condition} basis={condition.condition_basis} />}
          demoRevision={fixtureRevision}
          rationaleHref={rationaleHref(condition.system_state_id)}
        >
          <p className="text-sm text-ink">{condition.condition_basis}</p>
          {condition.coverage_block !== null ? <div className="mt-3"><StateBlockView block={condition.coverage_block} /></div> : null}
        </Card>

        <Card id="system-refs" title="Exact revisions" demoRevision={fixtureRevision}>
          <dl>
            {condition.refs.map((ref) => (
              <Row key={`${ref.kind}-${ref.id}`} label={ref.kind.charAt(0) + ref.kind.slice(1).toLowerCase()}>
                <span className="font-mono text-xs">{ref.id}</span>
                <span className="ml-2 rounded bg-surface-warm px-1.5 py-0.5 font-mono text-xs text-ink-soft">{ref.revision}</span>
                {ref.environment !== undefined ? <span className="ml-2 text-xs text-ink-soft">({ref.environment})</span> : null}
              </Row>
            ))}
          </dl>
        </Card>

        <Card id="system-architecture" title="Architecture and experiments" demoRevision={fixtureRevision}>
          <dl>
            <Row label="Architecture reference">
              <span className="font-mono text-xs">{system.content.architecture_ref.artifact_id}</span>
              <span className="ml-2 text-xs text-ink-soft">v{String(system.content.architecture_ref.version)}</span>
            </Row>
            <Row label="Active experiments">
              {condition.active_experiment_refs.length > 0 ? (
                <ul className="space-y-1">
                  {condition.active_experiment_refs.map((ref) => (
                    <li key={ref}>
                      <span className="font-mono text-xs">{ref}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                'No active experiments.'
              )}
            </Row>
            <Row label="Package realizations">
              {system.content.package_realizations.length > 0 ? (
                <ul className="space-y-1">
                  {system.content.package_realizations.map((realization) => (
                    <li key={realization.package_id} className="text-sm">
                      <span className="font-mono text-xs">{realization.package_id}</span>
                      <span className="ml-2 text-ink-soft">realized by {realization.realized_by.join(', ')}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                'No package realizations recorded.'
              )}
            </Row>
            <Row label="Environments">
              {system.content.environment_relationships.map((relationship) => (
                <span key={`${relationship.source}-${relationship.target}`} className="mr-3 inline-flex items-center gap-1">
                  <ValueChip label={`${relationship.source} → ${relationship.target}`} value={relationship.kind} />
                </span>
              ))}
            </Row>
          </dl>
        </Card>

        <section aria-label="Live deployment signals">
          <StateBlockView block={notConnectedBlock('live-deployment-signals', 'Live deployment signals')} />
        </section>
      </div>
    </PageShell>
  );
}
