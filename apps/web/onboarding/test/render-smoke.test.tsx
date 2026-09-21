/**
 * Onboarding render smoke tests (Work Order P4) — every onboarding
 * surface renders from the fixed fixture dataset (server render to
 * string via the app's own toolchain; next/link is stubbed to a plain
 * anchor because the Next router is not mounted outside the app). Same
 * inputs -> same markup, byte for byte. DEMO labelling, the honest
 * connection states, the authority gate and the typed validation
 * findings are all pinned.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) =>
    createElement('a', { href, ...props }, children),
}));

import { OnboardingHub } from '../src/components/onboarding-hub';
import { GreenfieldWizard } from '../src/components/greenfield-wizard';
import { BrownfieldFlow } from '../src/components/brownfield-flow';
import { AdvancedImportSurface } from '../src/components/advanced-import-surface';
import { ONBOARDING_FIXTURE_REVISION } from '../../../../packages/web-contracts/onboarding/src/index';

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

const DEMO_LABEL = 'DEMO — SIMULATED DATA';

describe('the onboarding hub', () => {
  const html = render(createElement(OnboardingHub));

  it('renders the two guided journeys and the advanced mode', () => {
    expect(html).toContain('Start a mission');
    expect(html).toContain('Import an existing system');
    expect(html).toContain('Advanced: raw JSON import');
    expect(html).toContain('purpose → outcomes → stakeholders → measures → constraints');
  });

  it('links the three journeys', () => {
    expect(html).toContain('href="/onboarding/greenfield"');
    expect(html).toContain('href="/onboarding/brownfield"');
    expect(html).toContain('href="/onboarding/advanced"');
  });

  it('labels every fixture-backed surface with the DEMO badge', () => {
    const badges = html.match(/data-demo-badge="true"/g) ?? [];
    expect(badges.length).toBeGreaterThanOrEqual(4);
    expect(html).toContain(DEMO_LABEL);
  });

  it('shows the honest connection state (SIMULATED reference provider; real system NOT_YET_CONNECTED)', () => {
    expect(html).toContain('data-connection-state="CONNECTED_SIMULATED"');
    expect(html).toContain('Connected — SIMULATED (reference provider)');
    expect(html).toContain('NOT_YET_CONNECTED in this Work Order');
  });

  it('renders the shell landmarks and the fixture revision', () => {
    expect(html).toContain('aria-label="Primary"');
    expect(html).toContain('id="main-content"');
    expect(html).toContain('Skip to main content');
    expect(html).toContain(ONBOARDING_FIXTURE_REVISION);
  });
});

describe('the greenfield wizard', () => {
  it('renders the purpose step for a fresh journey with guidance and a labelled input', () => {
    const html = render(createElement(GreenfieldWizard, { params: {} }));
    expect(html).toContain('Purpose');
    expect(html).toContain('why does this mission exist?');
    expect(html).toContain('name="purpose"');
    expect(html).toContain('Journey progress');
    expect(html).toContain('aria-current="step"');
  });

  it('renders the typed validation finding when the purpose is missing or blank', () => {
    const html = render(createElement(GreenfieldWizard, { params: { od0: 'An outcome without a purpose' } }));
    expect(html).toContain('role="alert"');
    expect(html).toContain('MISSING_INPUT');
    expect(html).toContain('State the purpose in one sentence');
  });

  it('accumulates state in the form (hidden inputs) so the journey is resumable by URL', () => {
    const html = render(createElement(GreenfieldWizard, {
      params: { purpose: 'A purpose', sn0: 'Shoppers' },
    }));
    expect(html).toContain('name="sn0"');
    expect(html).toContain('value="Shoppers"');
    expect(html).toContain('Stakeholders');
  });

  it('renders the authority confirmation as an explicit gate naming the REVISE permission', () => {
    const html = render(createElement(GreenfieldWizard, {
      params: {
        purpose: 'A purpose',
        od0: 'An outcome',
        og0: 'A goal',
        sn0: 'Shoppers',
        md0: 'A measure',
      },
    }));
    expect(html).toContain('Authority confirmation');
    expect(html).toContain('name="authority"');
    expect(html).toContain('REVISE');
    expect(html).toContain('the gate never closes itself');
  });

  it('renders the review step with the domain-validated mission content', () => {
    const html = render(createElement(GreenfieldWizard, {
      params: {
        purpose: 'A purpose',
        od0: 'An outcome',
        og0: 'A goal',
        sn0: 'Shoppers',
        md0: 'A measure',
        stage: 'review',
      },
    }));
    expect(html).toContain('Review');
    expect(html).toContain('A purpose');
    expect(html).toContain('domain validator');
  });

  it('renders the GitHub connection step with the provider-neutral connection state honestly', () => {
    const html = render(createElement(GreenfieldWizard, {
      params: {
        purpose: 'A purpose',
        od0: 'An outcome',
        og0: 'A goal',
        sn0: 'Shoppers',
        md0: 'A measure',
        authority: 'true',
      },
    }));
    expect(html).toContain('GitHub connection');
    expect(html).toContain('name="repo"');
    expect(html).toContain('acme/empty-repo');
    expect(html).toContain('least-privilege');
  });

  it('renders the persisted step with the exact spine ids and linked revision under the DEMO badge', () => {
    const html = render(createElement(GreenfieldWizard, {
      params: {
        purpose: 'A purpose',
        od0: 'An outcome',
        og0: 'A goal',
        sn0: 'Shoppers',
        md0: 'A measure',
        authority: 'true',
        repo: 'acme/empty-repo',
      },
    }));
    expect(html).toContain('Mission persisted');
    expect(html).toContain('sos://Mission/');
    expect(html).toContain('sos://SystemState/');
    expect(html).toContain('sos://ImplementationModel/');
    expect(html).toContain('git-sha');
    expect(html).toContain(DEMO_LABEL);
    expect(html).toContain('the durable live-store write is exercised end-to-end by the deterministic journey tests');
  });

  it('answers the six product review questions on every step', () => {
    const html = render(createElement(GreenfieldWizard, { params: {} }));
    expect(html).toContain('What is happening?');
    expect(html).toContain('Why does SOS believe this?');
    expect(html).toContain('What evidence supports it?');
    expect(html).toContain('What uncertainty remains?');
    expect(html).toContain('What authority is required?');
    expect(html).toContain('What can happen next?');
    expect(html).toContain('never fabricated');
  });
});

describe('the brownfield flow', () => {
  it('renders the repository import step with the fixture discovery list (DEMO)', () => {
    const html = render(createElement(BrownfieldFlow, { params: {} }));
    expect(html).toContain('Repository import');
    expect(html).toContain('acme/legacy-checkout');
    expect(html).toContain(DEMO_LABEL);
  });

  it('renders the evidence scan with the distinct truth states and the PARTIAL coverage block', () => {
    const html = render(createElement(BrownfieldFlow, { params: { repo: 'acme/legacy-checkout', stage: 'EVIDENCE_SCAN' } }));
    expect(html).toContain('Evidence scan');
    expect(html).toContain('SUCCESS');
    expect(html).toContain('PARTIAL');
    expect(html).toContain('UNKNOWN');
    expect(html).toContain('data-state-block="PARTIAL"');
    expect(html).toContain('Partially available');
    expect(html).toContain('component-inventory');
  });

  it('renders the competing hypotheses as a set with their uncertainty (never collapsed)', () => {
    const html = render(createElement(BrownfieldFlow, { params: { repo: 'acme/legacy-checkout', stage: 'COMPETING_HYPOTHESES' } }));
    expect(html).toContain('Competing architecture hypotheses');
    expect(html).toContain('Service-oriented reading');
    expect(html).toContain('Library-first reading');
    expect(html).toContain('Split-services reading');
    expect(html).toContain('sos://ArchitectureGraph/');
    expect(html).toContain('never a single collapsed winner');
  });

  it('renders the confirmation gate naming the REVISE permission', () => {
    const html = render(createElement(BrownfieldFlow, {
      params: {
        repo: 'acme/legacy-checkout',
        hypothesis: 'sos://ArchitectureGraph/00000000000000000000000000000000',
      },
    }));
    expect(html).toContain('Confirmation');
    expect(html).toContain('name="confirmed"');
    expect(html).toContain('REVISE');
  });
});

describe('the advanced import surface', () => {
  it('renders as clearly secondary with the raw JSON textarea and the authority gate', () => {
    const html = render(createElement(AdvancedImportSurface, { params: {} }));
    expect(html).toContain('Advanced: import raw JSON');
    expect(html).toContain('clearly secondary');
    expect(html).toContain('name="raw"');
    expect(html).toContain('name="authority"');
  });

  it('renders the typed findings for invalid JSON', () => {
    const html = render(createElement(AdvancedImportSurface, { params: { raw: '{nope' } }));
    expect(html).toContain('role="alert"');
    expect(html).toContain('NOT_JSON');
  });
});

describe('render determinism', () => {
  it('the hub renders byte-identically twice', () => {
    expect(render(createElement(OnboardingHub))).toBe(render(createElement(OnboardingHub)));
  });

  it('a wizard step renders byte-identically twice for the same inputs', () => {
    const params = { purpose: 'A purpose', od0: 'An outcome', sn0: 'Shoppers' };
    expect(render(createElement(GreenfieldWizard, { params }))).toBe(render(createElement(GreenfieldWizard, { params })));
  });

  it('the brownfield flow renders byte-identically twice for the same inputs', () => {
    const params = { repo: 'acme/legacy-checkout', stage: 'EVIDENCE_SCAN' };
    expect(render(createElement(BrownfieldFlow, { params }))).toBe(render(createElement(BrownfieldFlow, { params })));
  });
});
