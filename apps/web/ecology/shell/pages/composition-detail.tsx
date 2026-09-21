/**
 * The composition detail (Work Order P10) — the deep view of ONE
 * first-class package composition: the members and their roles, the typed
 * wiring, the independence justifications, the composition's OWN evidence
 * verdict (evaluated by the owning @sos-2/composition authority), its
 * assurance obligations, applicability and revision story — plus the
 * six-question rationale. Unknown compositions render the honest UNKNOWN
 * state block.
 */

import { buildStateBlock } from '@sos-2/web-contracts';
import { PageShell, PageHeading } from '../../../shell/components/page-shell';
import { Card, Row } from '../../../shell/components/card';
import { StateBlockView } from '../../../shell/components/state-block';
import { ValueChip } from '../../../shell/components/chips';
import { ecologyViews } from '../../view-state/ecology-data';
import { EcologyRationale } from '../../components/ecology-rationale';

export async function CompositionDetail({ segment }: { segment: string }) {
  const views = await ecologyViews();
  const composition = views.compositionDetail(segment);
  const fixtureRevision = views.packagesWorkspace.core.data_source.kind === 'DEMO' ? views.packagesWorkspace.core.data_source.fixture_revision : undefined;

  if (composition === null) {
    return (
      <PageShell section="packages">
        <PageHeading title="Composition detail" intro="The deep view of one package composition." demoRevision={fixtureRevision} />
        <StateBlockView
          block={buildStateBlock({
            kind: 'UNKNOWN',
            surface: 'composition-detail',
            statement: `No composition with id sos://PackageComposition/${decodeURIComponent(segment)} is known in this dataset.`,
            action: 'Return to the Packages workspace and open a composition from the list.',
          })}
        />
      </PageShell>
    );
  }

  const rationale = views.rationaleOf(composition.composition_id);

  return (
    <PageShell section="packages">
      <PageHeading
        title={composition.semantic_capability}
        intro="A first-class composition: member packages bound into roles with typed wiring, carrying its OWN evidence — member evidence never substitutes for composition evidence."
        demoRevision={fixtureRevision}
      />
      <div className="space-y-4">
        <Card
          id="composition-summary"
          title="Summary"
          chip={
            <span className="flex flex-wrap gap-1.5">
              <ValueChip label="maturity" value={composition.maturity} />
              <ValueChip label="revision" value={`v${String(composition.version)} ${composition.status}`} />
              <ValueChip label="family" value={composition.family} />
            </span>
          }
          demoRevision={fixtureRevision}
        >
          <dl>
            <Row label="What changed">{composition.changes}</Row>
            <Row label="Contracts">{composition.contracts.join(', ')}</Row>
            <Row label="Members (roles)">
              <ul className="space-y-1">
                {composition.members.map((member) => (
                  <li key={member.role} className="text-sm">
                    <span className="font-medium text-ink">{member.role}</span> —{' '}
                    <span className="font-mono text-xs text-ink-soft">{member.package_id}</span>{' '}
                    <span className="text-ink-soft">(binds {member.bound_contracts.join(', ')})</span>
                  </li>
                ))}
              </ul>
            </Row>
            <Row label="Typed wiring">
              <ul className="space-y-1">
                {composition.bindings.map((binding, index) => (
                  <li key={index} className="text-sm">
                    <span className="font-medium text-ink">{binding.kind}</span>: {binding.source_role} → {binding.target_role} via {binding.contract}
                  </li>
                ))}
              </ul>
            </Row>
          </dl>
        </Card>

        <Card
          id="composition-own-evidence"
          title="The composition OWN evidence (independent)"
          chip={<ValueChip label="verdict" value={composition.own_evidence.valid ? 'valid' : 'invalid'} />}
          demoRevision={fixtureRevision}
        >
          <p className="text-sm text-ink">{composition.own_evidence.note}</p>
          <dl className="mt-3">
            <Row label="Own evidence refs">
              <p className="flex flex-wrap gap-1.5">
                {composition.core.evidence_refs.map((ref) => (
                  <span key={ref} className="font-mono text-xs text-epistemic">
                    {ref}
                  </span>
                ))}
              </p>
            </Row>
            <Row label="Independence assessments">
              {composition.independence.length === 0 ? (
                <span className="text-sm text-ink-soft">No combined probability is claimed yet (an unjustified product never exists).</span>
              ) : (
                <ul className="space-y-1">
                  {composition.independence.map((assessment, index) => (
                    <li key={index} className="text-sm">
                      <span className="font-medium text-ink">{assessment.justification.basis}</span>: {assessment.justification.justification} (combined {String(assessment.value)})
                    </li>
                  ))}
                </ul>
              )}
            </Row>
            <Row label="Rejection reasons (surfaced, never hidden)">
              {composition.own_evidence.reasons.length === 0 ? (
                <span className="text-sm text-ok">None — every cited ref is evidence about this composition&apos;s own chain.</span>
              ) : (
                <ul className="list-inside list-disc text-sm text-stop">
                  {composition.own_evidence.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              )}
            </Row>
          </dl>
        </Card>

        <Card id="composition-applicability" title="Applicability and obligations" demoRevision={fixtureRevision}>
          <dl>
            <Row label="Applicability (context-conditioned)">
              <ul className="space-y-1">
                {composition.applicability.map((estimate, index) => (
                  <li key={index} className="text-sm">
                    <span className="font-medium text-ink">{Object.entries(estimate.context).map(([key, value]) => `${key}=${String(value)}`).join(', ')}</span>{' '}
                    — uncertainty {estimate.kind === 'QUALITATIVE' ? estimate.uncertainty_class : 'calibrated'}, sample {String(estimate.sample_size)}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-ink-soft">{composition.applicability_note}</p>
            </Row>
            <Row label="Assurance obligations">
              <ul className="list-inside list-disc">
                {composition.assurance_obligations.map((obligation) => (
                  <li key={obligation.obligation}>
                    <span className="font-medium">{obligation.kind}</span>: {obligation.obligation}
                  </li>
                ))}
              </ul>
            </Row>
            <Row label="Learned limitations">
              <ul className="list-inside list-disc">
                {composition.learned_limitations.map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
            </Row>
          </dl>
        </Card>

        {rationale !== null ? (
          <section aria-label="Rationale of the composition">
            <h2 className="mb-2 text-lg font-semibold text-ink">Why? — the six questions</h2>
            <EcologyRationale vm={rationale} />
          </section>
        ) : (
          <StateBlockView
            block={buildStateBlock({
              kind: 'UNKNOWN',
              surface: 'composition-rationale',
              statement: 'This composition has no typed trace links in the current link web.',
              action: 'Return to the Packages workspace.',
            })}
          />
        )}
      </div>
    </PageShell>
  );
}
