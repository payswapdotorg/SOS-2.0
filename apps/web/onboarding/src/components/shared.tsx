/**
 * The shared onboarding surface pieces (Work Order P4): the stage
 * progress indicator, the typed validation list, the connection-state
 * card and the review-questions block — all composing the P1 shell
 * primitives (Card, Row, ValueChip, DemoBadge, StateBlockView) and the
 * P1 a11y standards (44px touch targets, sr-only context, landmarks).
 */

import Link from 'next/link';
import { Card, Row } from '../../../shell/components/card';
import type {
  OnboardingConnectionView,
  OnboardingVmCore,
} from '../../../../../packages/web-contracts/onboarding/src/index';

/** The structural validation-error shape shared by the three journeys' stage models (field is optional — some findings bind to the whole step). */
export interface OnboardingValidationErrorLike {
  field?: string | null;
  code: string;
  message: string;
}

/** The stage progress indicator (an ordered list; aria-current marks the active step). */
export function StageProgress({ steps, currentIndex }: { steps: string[]; currentIndex: number }) {
  return (
    <ol className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-ink-soft" aria-label="Journey progress">
      {steps.map((step, index) => {
        const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo';
        return (
          <li key={step} className="flex items-center gap-2">
            <span
              aria-current={state === 'current' ? 'step' : undefined}
              className={
                state === 'done'
                  ? 'rounded-full border border-ok/40 bg-ok-soft px-2.5 py-0.5 text-ok'
                  : state === 'current'
                    ? 'rounded-full border border-ink/40 bg-surface-warm px-2.5 py-0.5 text-ink'
                    : 'rounded-full border border-line px-2.5 py-0.5'
              }
            >
              {state === 'done' ? <span className="sr-only">Completed: </span> : null}
              {state === 'current' ? <span className="sr-only">Current step: </span> : null}
              {step}
            </span>
            {index < steps.length - 1 ? <span aria-hidden="true" className="text-line-strong">→</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

/** The typed validation list (each finding is actionable text, never just color). */
export function ValidationList({ errors, label }: { errors: OnboardingValidationErrorLike[]; label: string }) {
  if (errors.length === 0) {
    return null;
  }
  return (
    <div className="mt-3 rounded-lg border border-stop/30 bg-stop-soft p-3" role="alert" aria-label={label}>
      <p className="text-sm font-semibold text-stop">{errors.length === 1 ? 'One finding to resolve' : `${errors.length} findings to resolve`}</p>
      <ul className="mt-1.5 space-y-1">
        {errors.map((error) => (
          <li key={`${error.code}-${error.field ?? 'none'}`} className="text-sm text-ink">
            <span className="sr-only">{`Finding (${error.code}) at ${error.field ?? 'this step'}: `}</span>
            {error.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The guidance list of a stage. */
export function GuidanceList({ guidance }: { guidance: string[] }) {
  if (guidance.length === 0) {
    return null;
  }
  return (
    <ul className="mb-4 space-y-1 text-sm text-ink-soft">
      {guidance.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

/**
 * The connection-state card: the provider-neutral connection truth with
 * the honest label, the scopes, the DEMO badge and the provider's own
 * note. A simulated connection can never render as a real one.
 */
export function ConnectionCard({ connection }: { connection: OnboardingConnectionView }) {
  const fixtureRevision = connection.data_source.kind === 'DEMO' ? connection.data_source.fixture_revision : undefined;
  return (
    <Card
      id="onboarding-connection"
      title="GitHub connection"
      demoRevision={fixtureRevision}
    >
      <Row label="State">
        <strong className="font-semibold" data-connection-state={connection.state}>
          {connection.state === 'CONNECTED_SIMULATED'
            ? 'Connected — SIMULATED (reference provider)'
            : connection.state === 'CONNECTED_REAL'
              ? 'Connected — real GitHub'
              : connection.state === 'NOT_YET_CONNECTED'
                ? 'Not connected yet'
                : connection.state}
        </strong>
      </Row>
      <Row label="Requested scope">
        {connection.requested_scopes.length > 0 ? connection.requested_scopes.join(', ') : '—'}
      </Row>
      <Row label="Provider note">{connection.provider_note}</Row>
      <p className="mt-3 text-xs text-ink-soft">
        The real-system connection is honestly NOT_YET_CONNECTED in this Work Order (validation GitHub account pending); the reference provider above is simulated and clearly labelled.
      </p>
    </Card>
  );
}

/** The six product review questions, answered from an onboarding view core. */
export function ReviewQuestionsBlock({ core }: { core: OnboardingVmCore }) {
  return (
    <div className="mt-4 space-y-2 rounded-lg border border-line bg-surface-warm p-4 text-sm" aria-label="Product review questions">
      <p className="font-semibold text-ink">What is happening?</p>
      <p className="text-ink-soft">{core.what}</p>
      <p className="font-semibold text-ink">Why does SOS believe this?</p>
      <p className="text-ink-soft">{core.why.basis}</p>
      <p className="font-semibold text-ink">What evidence supports it?</p>
      <p className="text-ink-soft">
        {core.evidence_refs.length > 0 ? core.evidence_refs.join(', ') : 'No spine evidence exists yet — this is honestly empty at this step, never fabricated.'}
      </p>
      <p className="font-semibold text-ink">What uncertainty remains?</p>
      <p className="text-ink-soft">{`${core.uncertainty.uncertainty_class}: ${core.uncertainty.statement}`}</p>
      <p className="font-semibold text-ink">What authority is required?</p>
      <p className="text-ink-soft">{core.authority.note}</p>
      <p className="font-semibold text-ink">What can happen next?</p>
      <p className="text-ink-soft">{`${core.next_allowed_action.label} — ${core.next_allowed_action.description}`}</p>
    </div>
  );
}

/** A primary action button (native submit, 44px touch target). */
export function PrimaryAction({ label, name, value }: { label: string; name?: string; value?: string }) {
  return (
    <button
      type="submit"
      name={name}
      value={value}
      className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-ink px-4 py-2 text-sm font-semibold text-paper hover:opacity-90"
    >
      {label}
    </button>
  );
}

/** A secondary in-app link (44px touch target). */
export function SecondaryLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-[44px] items-center rounded-md border border-line-strong px-4 py-2 text-sm font-medium text-ink hover:bg-surface-warm"
    >
      {label}
    </Link>
  );
}
