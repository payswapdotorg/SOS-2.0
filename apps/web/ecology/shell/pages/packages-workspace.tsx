/**
 * The Packages workspace (Work Order P10) — package discovery as a
 * COMPOSITION surface: the package repertoire with contextual
 * applicability, uncertainty, retained failures and assurance obligations
 * visible per package (never collapsed into a single score), the
 * first-class compositions with their OWN independent evidence, and the
 * honest state blocks for the surfaces that do not exist yet.
 *
 * Fully server-rendered from the P10 view models over the live-store
 * repository reads of the clearly-labelled DEMO dataset — no client
 * fetches, no hidden clocks.
 */

import Link from 'next/link';
import { gateNextAction, actionAvailabilityLabel } from '@sos-2/web-contracts';
import { PageShell, PageHeading } from '../../../shell/components/page-shell';
import { Card, Row } from '../../../shell/components/card';
import { StateBlockView } from '../../../shell/components/state-block';
import { ValueChip } from '../../../shell/components/chips';
import { ecologyViews } from '../../view-state/ecology-data';
import type { PackageEcologyVM } from '@sos-2/web-contracts/ecology';

/** One applicability estimate row: context, class, sample size and window — the whole estimate, verbatim. */
function ApplicabilityRows({ vm }: { vm: PackageEcologyVM }) {
  return (
    <ul className="space-y-2">
      {vm.applicability.map((estimate, index) => (
        <li key={index} className="rounded-lg border border-line bg-surface-warm p-3 text-sm">
          <p className="flex flex-wrap items-center gap-1.5">
            <ValueChip label="context" value={Object.entries(estimate.context).map(([key, value]) => `${key}=${String(value)}`).join(', ')} />
            <ValueChip
              label="uncertainty"
              value={estimate.kind === 'QUALITATIVE' ? estimate.uncertainty_class : 'calibrated'}
              title="The frozen qualitative uncertainty class of THIS estimate (imported from @sos-2/packages) — never collapsed into a score."
            />
            <ValueChip label="sample" value={String(estimate.sample_size)} />
          </p>
          <p className="mt-1 text-xs text-ink-soft">
            Observed window {estimate.window === null ? 'not declared' : `${estimate.window.start} to ${estimate.window.end}`}
          </p>
        </li>
      ))}
    </ul>
  );
}

export async function PackagesWorkspace() {
  const views = await ecologyViews();
  const workspace = views.packagesWorkspace;
  const fixtureRevision = workspace.core.data_source.kind === 'DEMO' ? workspace.core.data_source.fixture_revision : undefined;
  const nextAction = workspace.core.next_allowed_action;
  const availability = gateNextAction({ action: nextAction, data_source: workspace.core.data_source, grant_held: true });

  return (
    <PageShell section="packages">
      <PageHeading
        title="Packages"
        intro="The composition workspace: validated, reusable capabilities with their context-conditioned applicability, retained failures and assurance obligations — and the first-class compositions built from them, each carrying its OWN evidence."
        demoRevision={fixtureRevision}
      />

      <div className="space-y-6">
        {/* The repertoire: diversity families (never collapsed) */}
        <section aria-labelledby="ecology-repertoire">
          <h2 id="ecology-repertoire" className="text-lg font-semibold text-ink">
            The repertoire
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-ink-soft">{workspace.diversity_note}</p>
          <p className="mt-2 flex flex-wrap gap-1.5">
            {workspace.families.map((family) => (
              <ValueChip key={family.family} label="family" value={`${family.family} · ${String(family.entries)} revision${family.entries === 1 ? '' : 's'}`} />
            ))}
            <ValueChip label="read from" value="live-store packages repository" title={`The package records were read through the @sos-2/live-store repositories of ${workspace.core.data_source.kind === 'DEMO' ? 'the DEMO-seeded reference store' : 'the live store'} (${views.read.store_ref}).`} />
          </p>
        </section>

        {/* The compositions (each with its OWN independent evidence) */}
        <section aria-labelledby="ecology-compositions" className="space-y-4">
          <h2 id="ecology-compositions" className="text-lg font-semibold text-ink">
            Compositions
          </h2>
          {workspace.compositions.map((composition) => (
            <Card
              key={composition.composition_id}
              id={`composition-${composition.composition_id.slice(-6)}`}
              title={composition.semantic_capability}
              chip={
                <span className="flex flex-wrap gap-1.5">
                  <ValueChip label="maturity" value={composition.maturity} title="Frozen maturity lifecycle (the package vocabulary — compositions are ecology citizens)." />
                  <ValueChip label="own evidence" value={composition.own_evidence.valid ? 'valid (about the composition)' : 'invalid'} title={composition.own_evidence.note} />
                </span>
              }
              demoRevision={fixtureRevision}
              rationaleHref={`/packages/composition/${composition.composition_id.slice('sos://PackageComposition/'.length)}`}
            >
              <dl>
                <Row label="Members (roles)">
                  <ul className="space-y-1">
                    {composition.members.map((member) => (
                      <li key={member.role} className="text-sm">
                        <span className="font-medium text-ink">{member.role}</span> —{' '}
                        <Link href={`/history/revision/Package/${member.package_id.slice('sos://Package/'.length)}`} className="font-mono text-xs text-epistemic underline-offset-2 hover:underline">
                          {member.package_id}
                        </Link>{' '}
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
                <Row label="Independence">
                  {composition.independence.length === 0 ? (
                    <span className="text-sm text-ink-soft">No combined probability is claimed yet (unjustified products never exist).</span>
                  ) : (
                    <ul className="space-y-1">
                      {composition.independence.map((assessment, index) => (
                        <li key={index} className="text-sm">
                          Combined {String(assessment.value)} — <span className="font-medium text-ink">{assessment.justification.basis}</span>: {assessment.justification.justification}
                        </li>
                      ))}
                    </ul>
                  )}
                </Row>
                <Row label="Composition OWN evidence">
                  <p className="text-sm text-ink">{composition.own_evidence.note}</p>
                  <p className="mt-1 flex flex-wrap gap-1.5">
                    {composition.core.evidence_refs.map((ref) => (
                      <Link key={ref} href={views.rationaleHref(ref)} className="inline-flex min-h-[44px] items-center font-mono text-xs text-epistemic underline-offset-2 hover:underline">
                        {ref}
                      </Link>
                    ))}
                  </p>
                  {composition.own_evidence.valid ? null : (
                    <p className="mt-1 text-xs text-stop">
                      Foreign/unresolved refs surfaced: {[...composition.own_evidence.foreign_refs, ...composition.own_evidence.unresolved_refs].join(', ')}
                    </p>
                  )}
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
              </dl>
            </Card>
          ))}
        </section>

        {/* The honest state blocks (what is not live yet) */}
        {workspace.state_blocks.map((block) => (
          <StateBlockView key={block.surface} block={block} />
        ))}

        {/* Package discovery (applicability, uncertainty, failures, assurance — all visible) */}
        <section aria-labelledby="ecology-discovery" className="space-y-4">
          <h2 id="ecology-discovery" className="text-lg font-semibold text-ink">
            Discovery
          </h2>
          {workspace.packages.map((pkg) => (
            <Card
              key={pkg.package_id}
              id={`package-${pkg.package_id.slice(-6)}`}
              title={pkg.semantic_capability}
              chip={
                <span className="flex flex-wrap gap-1.5">
                  <ValueChip label="maturity" value={pkg.maturity} title="Frozen maturity lifecycle: DISCOVERED, FORMING, VALIDATED, MATURE, CONTEXTUALIZED, SUPERSEDED/RETIRED." />
                  <ValueChip label="family" value={pkg.family} title="The declared diversity family — preserved, never collapsed." />
                  <ValueChip label="revision" value={`v${String(pkg.version)} ${pkg.status}`} />
                </span>
              }
              demoRevision={fixtureRevision}
              rationaleHref={pkg.core.next_allowed_action.href ?? undefined}
            >
              <dl>
                <Row label="Applicability (context-conditioned)">
                  <ApplicabilityRows vm={pkg} />
                  <p className="mt-1 text-xs text-ink-soft">{pkg.applicability_note}</p>
                </Row>
                <Row label="Diversity stance">
                  <ul className="list-inside list-disc">
                    {pkg.dimensions.map((dimension) => (
                      <li key={dimension.dimension}>
                        <span className="font-medium">{dimension.dimension}</span>: {dimension.stance}
                      </li>
                    ))}
                  </ul>
                </Row>
                <Row label="Preconditions">
                  <ul className="list-inside list-disc">
                    {pkg.preconditions.map((entry) => (
                      <li key={entry}>{entry}</li>
                    ))}
                  </ul>
                </Row>
                <Row label="Assurance obligations">
                  <ul className="list-inside list-disc">
                    {pkg.assurance_obligations.map((entry) => (
                      <li key={entry.obligation}>
                        <span className="font-medium">{entry.kind}</span>: {entry.obligation}
                      </li>
                    ))}
                  </ul>
                </Row>
                <Row label="Evidence and retained failures">
                  <p className="flex flex-wrap gap-1.5">
                    {pkg.evidence_refs.map((ref) => (
                      <Link key={ref} href={views.rationaleHref(ref)} className="inline-flex min-h-[44px] items-center font-mono text-xs text-epistemic underline-offset-2 hover:underline">
                        {ref}
                      </Link>
                    ))}
                  </p>
                  {pkg.failure_refs.length > 0 ? (
                    <p className="mt-1 text-xs text-stop">
                      Retained failure context (never hidden):{' '}
                      {pkg.failure_refs.map((ref, index) => (
                        <span key={ref}>
                          {index > 0 ? ', ' : ''}
                          <Link href={views.rationaleHref(ref)} className="font-mono underline-offset-2 hover:underline">
                            {ref}
                          </Link>
                        </span>
                      ))}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-ink-soft">No failure evidence recorded for this revision (the list is retained and shown either way).</p>
                  )}
                </Row>
                <Row label="Learned limitations">
                  <ul className="list-inside list-disc">
                    {pkg.learned_limitations.map((entry) => (
                      <li key={entry}>{entry}</li>
                    ))}
                  </ul>
                </Row>
                <Row label="Compositions">
                  {pkg.composition_refs.length === 0 ? (
                    <span className="text-sm text-ink-soft">Not part of a composition yet.</span>
                  ) : (
                    <p className="flex flex-wrap gap-1.5">
                      {pkg.composition_refs.map((ref) => (
                        <Link key={ref} href={`/packages/composition/${ref.slice('sos://PackageComposition/'.length)}`} className="inline-flex min-h-[44px] items-center font-mono text-xs text-epistemic underline-offset-2 hover:underline">
                          {ref}
                        </Link>
                      ))}
                    </p>
                  )}
                </Row>
              </dl>
              <details className="mt-3 rounded-lg border border-line bg-surface-warm p-3">
                <summary className="min-h-[44px] cursor-pointer list-none text-sm font-medium text-epistemic">
                  What changed in this revision, postconditions and realizations
                </summary>
                <dl className="mt-2">
                  <Row label="What changed">{pkg.changes}</Row>
                  <Row label="Postconditions">
                    <ul className="list-inside list-disc">
                      {pkg.postconditions.map((entry) => (
                        <li key={entry}>{entry}</li>
                      ))}
                    </ul>
                  </Row>
                  <Row label="Realizations">
                    <ul className="space-y-1">
                      {pkg.realizations.map((realization) => (
                        <li key={realization.ref} className="text-sm">
                          <span className="font-mono text-xs text-ink-soft">{realization.ref}</span> ({realization.revision ?? 'unversioned'}) — {realization.note}
                        </li>
                      ))}
                    </ul>
                  </Row>
                </dl>
              </details>
            </Card>
          ))}
        </section>

        {/* The gated composition-building action (never a fake button) */}
        <Card id="compose-next" title="Compose a new composition (gated)" demoRevision={fixtureRevision}>
          <p className="text-sm font-medium text-ink">{nextAction.label}</p>
          <p className="mt-1 text-sm text-ink-soft">{nextAction.description}</p>
          <p className="mt-2 flex flex-wrap gap-1.5">
            <ValueChip label="availability" value={actionAvailabilityLabel(availability)} title={availability.reason} />
            <ValueChip label="requires" value={nextAction.requires_authority ?? 'no permission'} />
          </p>
          {availability.kind === 'NOT_AVAILABLE_IN_DEMO' ? (
            <p className="mt-3 text-sm text-ink-soft">{availability.reason}</p>
          ) : null}
          <p className="mt-3 text-sm text-ink-soft">
            A new composition starts FORMING with no evidence; it can only be VALIDATED by its OWN composed-system evidence — member success never implies composition success.
          </p>
        </Card>
      </div>
    </PageShell>
  );
}
