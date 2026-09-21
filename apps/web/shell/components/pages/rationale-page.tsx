/**
 * The Rationale page — the deep-link destination from every consequential
 * card. Answers the six product review questions for a spine subject
 * (path-safe kind + segment decomposition of the sos:// id). Unknown or
 * unlinked subjects render the honest UNKNOWN state block — never a blank
 * page, never a fabricated default.
 */

import { composeRationaleSubject, isWellFormedSubject } from '@sos-2/web-contracts';
import { PageShell, PageHeading } from '../page-shell';
import { RationaleView } from '../rationale';
import { StateBlockView } from '../state-block';
import { buildStateBlock } from '@sos-2/web-contracts';
import { views } from '../../view-state/demo-data';

export function RationalePage({ kind, segment }: { kind: string; segment: string }) {
  const subjectId = composeRationaleSubject(decodeURIComponent(kind), decodeURIComponent(segment));
  const vm = isWellFormedSubject(subjectId) ? views.rationaleOf(subjectId) : null;
  return (
    <PageShell section="overview">
      <PageHeading
        title="Rationale"
        intro={`The reasoning behind ${vm !== null ? vm.subject_label : 'this subject'} — the six questions every consequential surface must answer.`}
        demoRevision={views.source.kind === 'DEMO' ? views.source.fixture_revision : undefined}
      />
      {vm !== null ? (
        <RationaleView vm={vm} />
      ) : (
        <StateBlockView
          block={buildStateBlock({
            kind: 'UNKNOWN',
            surface: 'rationale-subject',
            statement: isWellFormedSubject(subjectId)
              ? 'This subject is not part of the current link web — no typed trace links mention it, so no rationale is rendered.'
              : 'The link does not name a well-formed SOS artifact id, so no rationale exists for it.',
            action: 'Return to the Overview and follow a Why? link from any consequential card.',
          })}
        />
      )}
    </PageShell>
  );
}
