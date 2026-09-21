/**
 * Render smoke tests for the P10 surfaces — every workspace renders its
 * cards, state blocks, DEMO labelling and the six-question structure from
 * the fixed fixture dataset through the live-store repository reads
 * (server render to string via the app's own toolchain; next/link is
 * stubbed to a plain anchor because the Next router is not mounted outside
 * the app). Same fixtures -> same markup, byte for byte.
 */

import { createElement } from 'react';
import { renderToReadableStream } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';

// The Next App Router is not mounted in these tests; a Link is an anchor.
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) =>
    createElement('a', { href, ...props }, children),
}));

import { PackagesWorkspace } from '../shell/pages/packages-workspace';
import { HistoryWorkspace } from '../shell/pages/history-workspace';
import { EvolutionWorkspace } from '../shell/pages/evolution-workspace';
import { CompositionDetail } from '../shell/pages/composition-detail';
import { RevisionDetail } from '../shell/pages/revision-detail';
import { ecologyViews } from '../view-state/ecology-data';

const DEMO_LABEL = 'DEMO — SIMULATED DATA';

// The P10 surfaces are async server components (they await the live-store
// reads), so the smoke tests render through the streaming renderer and
// await the completed tree (no Suspense boundaries: the shell completes
// only after every view model resolves — same fixtures, same markup).
async function render(element: React.ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element);
  const reader = stream.getReader();
  let html = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    html += Buffer.from(value).toString('utf8');
  }
  return html.replace(/<!--\s*-->|<!--\$-->|<!--\/-->/g, '');
}

describe('the Packages workspace (discovery as a composition surface)', async () => {
  const html = await render(createElement(PackagesWorkspace));

  test('renders the repertoire with its diversity families (never collapsed)', () => {
    expect(html).toContain('The repertoire');
    expect(html).toContain('cost-optimized');
    expect(html).toContain('latency-optimized');
    expect(html).toContain('exploration-tuning');
    expect(html).toContain('resilient-delivery');
  });

  test('renders the composition with its OWN evidence verdict and independence', () => {
    expect(html).toContain('Compositions');
    expect(html).toContain('own evidence');
    expect(html).toContain('DESIGNED_ISOLATION');
    expect(html).toContain('Member success never implies composition success');
  });

  test('renders contextual applicability with per-estimate uncertainty (no single score)', () => {
    expect(html).toContain('Applicability (context-conditioned)');
    expect(html).toContain('uncertainty');
    expect(html).toContain('sample');
    expect(html).toContain('universal score');
  });

  test('renders retained failures and assurance obligations per package', () => {
    expect(html).toContain('Retained failure context (never hidden)');
    expect(html).toContain('Assurance obligations');
    expect(html).toContain('Canary every adoption');
  });

  test('renders the live-store read provenance and the honest UNAVAILABLE state block', () => {
    expect(html).toContain('live-store packages repository');
    expect(html).toContain('data-state-block="UNAVAILABLE"');
    expect(html).toContain('not yet a live-store repository family');
  });

  test('renders the gated composition-building action (never a fake button)', () => {
    expect(html).toContain('Compose a new composition');
    expect(html).toContain('Explained, not executable in the demo');
  });

  test('labels every fixture-backed surface with the DEMO badge', () => {
    const badges = html.match(/data-demo-badge="true"/g) ?? [];
    expect(badges.length).toBeGreaterThanOrEqual(5);
    expect(html).toContain(DEMO_LABEL);
  });
});

describe('the History workspace (timeline + revision diff navigation)', async () => {
  const html = await render(createElement(HistoryWorkspace));

  test('renders every revision-bearing kind from the live read', () => {
    for (const kind of ['Mission chain', 'SystemState chain', 'Package chain', 'ArchitectureMemory chain', 'CausalHypothesis chain', 'Experiment chain', 'AuthorityGrant chain']) {
      expect(html).toContain(kind);
    }
  });

  test('renders the fixture-only kinds with their honest labels', () => {
    expect(html).toContain('PackageComposition chain');
    expect(html).toContain('MetaProcess chain');
    expect(html).toContain('DEMO fixture (not a live-store family yet)');
  });

  test('every entry carries what changed, why and the deep diff link', () => {
    expect(html).toContain('Why (provenance)');
    expect(html).toContain('open the revision diff');
    expect(html).toContain('data-state-block="UNAVAILABLE"');
  });
});

describe('the Evolution workspace (experiments + self-evolution)', async () => {
  const html = await render(createElement(EvolutionWorkspace));

  test('renders the controlled experiment (the canary story is preserved)', () => {
    expect(html).toContain('Controlled experiment');
    expect(html).toContain('CANARY');
    expect(html).toContain('10% exposure');
    expect(html).toContain('data-simulated="true"');
    expect(html).toContain('seed 424242');
  });

  test('renders the self-evolution process chain with the exact restore visible', () => {
    expect(html).toContain('Self-evolution');
    expect(html).toContain('process revision chain');
    expect(html).toContain('byte-equal to the baseline parameters (the exact restore)');
    expect(html).toContain('exploration 0.25');
    expect(html).toContain('exploration 0.4');
  });

  test('renders the non-disableable guard with the retained typed rejection', () => {
    expect(html).toContain('The governance guard (non-disableable)');
    expect(html).toContain('ENFORCING');
    expect(html).toContain('data-guard-rejection="VALIDATED_ALTITUDE_ZEROED"');
    expect(html).toContain('AUTHORITY_GATES_NON_DISABLEABLE');
  });

  test('renders the retained failure memory and the learned rule', () => {
    expect(html).toContain('Retained failure memory (never deleted)');
    expect(html).toContain('data-memory-entry="FAILURE"');
    expect(html).toContain('data-memory-entry="ROLLBACK"');
    expect(html).toContain('data-memory-entry="LIABILITY"');
    expect(html).toContain('data-memory-entry="LEARNED_RULE"');
    expect(html).toContain('data-learned-rule=');
  });

  test('renders the machine state and the live-read provenance', () => {
    expect(html).toContain('Machine state');
    expect(html).toContain('SOS 2.0 Productization');
    expect(html).toContain('in-memory-reference://demo-ecology-seed');
    expect(html).toContain('history.memories');
  });

  test('is read-only (no steering control is rendered)', () => {
    expect(html).toContain('READ-ONLY projection');
    expect(html).toContain('never steer it');
  });
});

describe('the composition detail (deep sub-route)', () => {
  test('renders the known composition with members, wiring, own evidence and the six questions', async () => {
    const views = await ecologyViews();
    const composition = views.packagesWorkspace.compositions[views.packagesWorkspace.compositions.length - 1]!;
    const segment = composition.composition_id.slice('sos://PackageComposition/'.length);
    const html = await render(createElement(CompositionDetail, { segment }));
    expect(html).toContain('Members (roles)');
    expect(html).toContain('write-buffer');
    expect(html).toContain('render-edge');
    expect(html).toContain('DATA_FLOW');
    expect(html).toContain('What is happening?');
    expect(html).toContain('Why does SOS believe this?');
    expect(html).toContain('What evidence supports it?');
    expect(html).toContain('What uncertainty remains?');
    expect(html).toContain('What authority is required?');
    expect(html).toContain('What can happen next?');
  });

  test('renders the honest UNKNOWN state block for an unknown composition', async () => {
    const html = await render(createElement(CompositionDetail, { segment: 'f'.repeat(32) }));
    expect(html).toContain('data-state-block="UNKNOWN"');
    expect(html).toContain('Not known yet');
  });
});

describe('the revision detail (deep sub-route)', () => {
  test('renders the known process chain with the restored-parameters diff', async () => {
    const views = await ecologyViews();
    const head = views.evolution.process_chain.current_head!;
    const segment = head.slice('sos://MetaProcess/'.length);
    const html = await render(createElement(RevisionDetail, { kind: 'MetaProcess', segment }));
    expect(html).toContain('MetaProcess revision chain');
    expect(html).toContain('Field changes');
    expect(html).toContain('restored to the v1 value — byte-equal');
    expect(html).toContain('parameters');
    expect(html).toContain('The chain (oldest to newest)');
  });

  test('renders the honest UNKNOWN state block for an unknown chain', async () => {
    const html = await render(createElement(RevisionDetail, { kind: 'Not%20A%20Kind', segment: 'zzz' }));
    expect(html).toContain('data-state-block="UNKNOWN"');
  });

  test('renders the honest EMPTY state block for a single-revision chain', async () => {
    const views = await ecologyViews();
    const hypothesis = views.world.hypothesis;
    const html = await render(createElement(RevisionDetail, { kind: 'CausalHypothesis', segment: hypothesis.envelope.id.slice('sos://CausalHypothesis/'.length) }));
    expect(html).toContain('data-state-block="EMPTY"');
    expect(html).toContain('single stored revision');
  });
});

describe('render determinism', async () => {
  test('the Packages workspace renders byte-identically twice', async () => {
    expect(await render(createElement(PackagesWorkspace))).toBe(await render(createElement(PackagesWorkspace)));
  });

  test('the History workspace renders byte-identically twice', async () => {
    expect(await render(createElement(HistoryWorkspace))).toBe(await render(createElement(HistoryWorkspace)));
  });

  test('the Evolution workspace renders byte-identically twice', async () => {
    expect(await render(createElement(EvolutionWorkspace))).toBe(await render(createElement(EvolutionWorkspace)));
  });
});
