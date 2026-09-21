/**
 * The Packages page — validated, reusable capabilities with their diversity
 * families, context-conditioned applicability, retained limitations and
 * assurance obligations. The composition section renders the honest EMPTY
 * state block (no compositions in this dataset; the deep composition
 * workspace is a later wave).
 */

import Link from 'next/link';
import { PageShell, PageHeading } from '../page-shell';
import { Card, Row } from '../card';
import { ValueChip } from '../chips';
import { StateBlockView } from '../state-block';
import { emptySectionBlock } from '../../view-state/state-selection';
import { rationaleHref, views } from '../../view-state/demo-data';

export function PackagesPage() {
  const fixtureRevision = views.source.kind === 'DEMO' ? views.source.fixture_revision : undefined;
  return (
    <PageShell section="packages">
      <PageHeading
        title="Packages"
        intro="Validated, reusable capabilities. Applicability is context-conditioned; limitations and failures are retained, never hidden."
        demoRevision={fixtureRevision}
      />
      <div className="space-y-4">
        {views.packages.map((pkg) => {
          const artifact = pkg;
          return (
            <Card
              key={artifact.envelope.id}
              id={`package-${artifact.envelope.id.slice(-6)}`}
              title={artifact.content.semantic_capability}
              chip={<ValueChip label="maturity" value={artifact.content.maturity} title="Frozen maturity lifecycle: DISCOVERED, FORMING, VALIDATED, MATURE, CONTEXTUALIZED, SUPERSEDED/RETIRED." />}
              demoRevision={fixtureRevision}
              rationaleHref={rationaleHref(artifact.envelope.id)}
            >
              <dl>
                <Row label="Diversity family">
                  {artifact.content.diversity_profile.family} — the repertoire deliberately keeps materially different families.
                </Row>
                <Row label="Preconditions">
                  <ul className="list-inside list-disc">
                    {artifact.content.preconditions.map((entry) => (
                      <li key={entry}>{entry}</li>
                    ))}
                  </ul>
                </Row>
                <Row label="Assurance obligations">
                  <ul className="list-inside list-disc">
                    {artifact.content.assurance_obligations.map((entry) => (
                      <li key={entry.obligation}>
                        <span className="font-medium">{entry.kind}</span>: {entry.obligation}
                      </li>
                    ))}
                  </ul>
                </Row>
                <Row label="Learned limitations">
                  <ul className="list-inside list-disc">
                    {artifact.content.learned_limitations.map((entry) => (
                      <li key={entry}>{entry}</li>
                    ))}
                  </ul>
                </Row>
                <Row label="Evidence">
                  {artifact.content.evidence_refs.map((ref) => (
                    <Link key={ref} href={rationaleHref(ref)} className="mr-2 inline-flex min-h-[44px] items-center font-mono text-xs text-epistemic underline-offset-2 hover:underline">
                      {ref}
                    </Link>
                  ))}
                  {artifact.content.failure_refs.length > 0 ? (
                    <span className="block text-xs text-stop">
                      Plus retained failure context: {artifact.content.failure_refs.join(', ')}
                    </span>
                  ) : null}
                </Row>
              </dl>
            </Card>
          );
        })}

        <section aria-label="Compositions">
          <StateBlockView block={emptySectionBlock('package-compositions', 'Package compositions')} />
          <p className="mt-2 text-xs text-ink-soft">
            Compositions carry their own independent evidence; the composition workspace grows with package reuse.
          </p>
        </section>
      </div>
    </PageShell>
  );
}
