/**
 * Render smoke tests — every key route renders its hero, cards, state
 * blocks and DEMO labelling from the fixed fixture dataset (server render
 * to string via the app's own dev toolchain; next/link is stubbed to a
 * plain anchor because the Next router is not mounted outside the app).
 * Same fixtures -> same markup, byte for byte.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';

// The Next App Router is not mounted in these tests; a Link is an anchor.
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) =>
    createElement('a', { href, ...props }, children),
}));

import { OverviewPage } from '../components/pages/overview-page';
import { MissionPage } from '../components/pages/mission-page';
import { SystemPage } from '../components/pages/system-page';
import { ChangesPage } from '../components/pages/changes-page';
import { EvidencePage } from '../components/pages/evidence-page';
import { ExperimentsPage } from '../components/pages/experiments-page';
import { PackagesPage } from '../components/pages/packages-page';
import { HistoryPage } from '../components/pages/history-page';
import { AskPage } from '../components/pages/ask-page';
import { MorePage } from '../components/pages/more-page';
import { RationalePage } from '../components/pages/rationale-page';
import { StateBlockView } from '../components/state-block';
import { buildStateBlock } from '@sos-2/web-contracts';
import { views, rationaleHref } from '../view-state/demo-data';

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

const DEMO_LABEL = 'DEMO — SIMULATED DATA';

describe('the Overview page (the dominant surface)', () => {
  const html = render(createElement(OverviewPage));

  test('renders the hero with the mission purpose and the four hero entries', () => {
    expect(html).toContain(views.hero.purpose);
    expect(html).toContain('Mission outcome health');
    expect(html).toContain('Current system condition');
    expect(html).toContain('Current shortfall');
    expect(html).toContain('Next allowed action');
    expect(html).toContain(views.nextAction.action.label);
  });

  test('renders the mission outcome health chip with a label, not just a color', () => {
    expect(html).toContain('Needs attention');
    expect(html).toContain(views.hero.outcome_basis);
  });

  test('renders the below-hero cards', () => {
    expect(html).toContain('Current change');
    expect(html).toContain('Evidence quality');
    expect(html).toContain('Experiment status');
    expect(html).toContain('Package reuse');
    expect(html).toContain('Recent learning');
  });

  test('renders the autonomous work surface with watching separate from body work', () => {
    expect(html).toContain('Active tasks');
    expect(html).toContain('Body leases');
    expect(html).toContain('SOS is watching');
    expect(html).toContain('does not use a working body');
  });

  test('labels every fixture-backed surface with the DEMO badge', () => {
    const badges = html.match(/data-demo-badge="true"/g) ?? [];
    expect(badges.length).toBeGreaterThanOrEqual(9);
    expect(html).toContain(DEMO_LABEL);
  });

  test('renders navigation landmarks, the skip link and the active rail state', () => {
    expect(html).toContain('aria-label="Primary"');
    expect(html).toContain('aria-label="Bottom"');
    expect(html).toContain('id="main-content"');
    expect(html).toContain('Skip to main content');
    expect(html).toContain('aria-current="page"');
  });

  test('renders the evidence counts with the distinct truth-state labels', () => {
    expect(html).toContain('Unknown');
    expect(html).toContain('Unavailable');
    expect(html).toContain('Unsupported');
    expect(html).toContain('Partial');
    expect(html).toContain('Failure');
    expect(html).toContain('Success');
  });

  test('renders state blocks with their named kinds', () => {
    expect(html).toContain('data-state-block="PARTIAL"');
    expect(html).toContain('Partially available');
  });

  test('renders rationale deep-links from the consequential cards', () => {
    expect(html).toContain('href="/rationale/');
    expect(html).toContain(rationaleHref(views.mission.envelope.id));
  });
});

describe('the section pages', () => {
  test('Mission renders goals, measures, constraints and the open ambiguity resolution', () => {
    const html = render(createElement(MissionPage));
    expect(html).toContain('Purpose');
    expect(html).toContain('Goals and measures');
    expect(html).toContain('Reduce checkout p95 latency below 250ms in the EU region');
    expect(html).toContain('EU first (this revision)');
    expect(html).toContain(DEMO_LABEL);
  });

  test('System renders exact revisions and the honest live-signals UNAVAILABLE block', () => {
    const html = render(createElement(SystemPage));
    expect(html).toContain('deploy:checkout-prod-2025-06-01');
    expect(html).toContain('data-state-block="UNAVAILABLE"');
    expect(html).toContain('DEMO');
  });

  test('Changes renders the change story, rollback rehearsal and the gated next step', () => {
    const html = render(createElement(ChangesPage));
    expect(html).toContain('Durable-queue checkout buffering');
    expect(html).toContain('Rollback rehearsal');
    expect(html).toContain('Advance the canary to 25% exposure');
    expect(html).toContain('Explained, not executable in the demo');
  });

  test('Evidence renders all six truth-state groups with their records', () => {
    const html = render(createElement(EvidencePage));
    for (const group of views.evidenceGroups) {
      expect(html).toContain(`evidence-group-${group.state.toLowerCase()}`);
    }
    expect(html).toContain('model output — never authoritative');
    expect(html).toContain('data-state-block="PARTIAL"');
  });

  test('Experiments renders the stage, guardrails and the honest simulated marker', () => {
    const html = render(createElement(ExperimentsPage));
    expect(html).toContain('CANARY');
    expect(html).toContain('10% exposure');
    expect(html).toContain('data-simulated="true"');
    expect(html).toContain('seed 424242');
  });

  test('Packages renders capabilities, families, limitations and the EMPTY compositions block', () => {
    const html = render(createElement(PackagesPage));
    expect(html).toContain('Durable checkout write buffering');
    expect(html).toContain('cost-optimized');
    expect(html).toContain('latency-optimized');
    expect(html).toContain('data-state-block="EMPTY"');
  });

  test('History renders the revision timeline with statuses', () => {
    const html = render(createElement(HistoryPage));
    expect(html).toContain('Timeline');
    expect(html).toContain('Mission revision');
    expect(html).toContain('System state revision');
    expect(html).toContain('SUPERSEDED');
    expect(html).toContain('ACTIVE');
  });

  test('ASK renders the open question, alternatives and the authority insufficiency', () => {
    const html = render(createElement(AskPage));
    expect(html).toContain(views.askView.request.content.decision);
    expect(html).toContain('Alternatives');
    expect(html).toContain(views.askView.request.content.authority_insufficiency);
    expect(html).toContain('data-state-block="UNAVAILABLE"');
  });

  test('More renders the full section index (a fresh user finds everything)', () => {
    const html = render(createElement(MorePage));
    for (const label of ['Overview', 'Mission', 'System', 'Changes', 'Evidence', 'Experiments', 'Packages', 'History', 'ASK', 'More']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('Autonomous — asks when uncertain');
  });
});

describe('the rationale deep-link view', () => {
  test('answers the six product review questions for a known subject', () => {
    const { kind, segment } = decompose(views.mission.envelope.id);
    const html = render(createElement(RationalePage, { kind, segment }));
    expect(html).toContain('What is happening?');
    expect(html).toContain('Why does SOS believe this?');
    expect(html).toContain('What evidence supports it?');
    expect(html).toContain('What uncertainty remains?');
    expect(html).toContain('What authority is required?');
    expect(html).toContain('What can happen next?');
    expect(html).toContain(views.mission.envelope.id);
  });

  test('renders the UNKNOWN state block for an unknown subject (never a blank page)', () => {
    const html = render(createElement(RationalePage, { kind: 'Mission', segment: 'f'.repeat(32) }));
    expect(html).toContain('data-state-block="UNKNOWN"');
    expect(html).toContain('Not known yet');
  });

  test('renders the UNKNOWN state block for a malformed subject id', () => {
    const html = render(createElement(RationalePage, { kind: 'Not%20A%20Kind', segment: 'zzz' }));
    expect(html).toContain('data-state-block="UNKNOWN"');
  });
});

describe('the six first-class state blocks render as named blocks', () => {
  const kinds = ['LOADING', 'EMPTY', 'UNKNOWN', 'UNAVAILABLE', 'PARTIAL', 'ERROR'] as const;
  const labels = ['Loading', 'Nothing here yet', 'Not known yet', 'Unavailable', 'Partially available', 'Something went wrong'];

  test.each(kinds.map((kind, index) => [kind, labels[index]] as const))('%s renders its distinct label', (kind, label) => {
    const html = render(
      createElement(StateBlockView, {
        block: buildStateBlock({
          kind,
          surface: `surface-${kind.toLowerCase()}`,
          statement: `The ${kind.toLowerCase()} statement.`,
          present: kind === 'PARTIAL' ? ['a'] : undefined,
          missing: kind === 'PARTIAL' ? ['b'] : undefined,
          action: kind === 'ERROR' || kind === 'UNAVAILABLE' ? 'The honest next step.' : null,
        }),
      }),
    );
    expect(html).toContain(`data-state-block="${kind}"`);
    expect(html).toContain(label);
    expect(html).toContain(`The ${kind.toLowerCase()} statement.`);
  });

  test('PARTIAL renders the present/missing lists', () => {
    const html = render(
      createElement(StateBlockView, {
        block: buildStateBlock({
          kind: 'PARTIAL',
          surface: 's',
          statement: 'Partial.',
          present: ['uptime telemetry'],
          missing: ['model collector'],
        }),
      }),
    );
    expect(html).toContain('uptime telemetry');
    expect(html).toContain('model collector');
  });
});

describe('render determinism', () => {
  test('the Overview page renders byte-identically twice', () => {
    expect(render(createElement(OverviewPage))).toBe(render(createElement(OverviewPage)));
  });

  test('the rationale page renders byte-identically twice', () => {
    const { kind, segment } = decompose(views.mission.envelope.id);
    expect(render(createElement(RationalePage, { kind, segment }))).toBe(
      render(createElement(RationalePage, { kind, segment })),
    );
  });
});

function decompose(subjectId: string): { kind: string; segment: string } {
  const withoutScheme = subjectId.slice('sos://'.length);
  const separator = withoutScheme.lastIndexOf('/');
  return { kind: withoutScheme.slice(0, separator), segment: withoutScheme.slice(separator + 1) };
}
