/**
 * P18-INT deterministic integrated suite (1/3): THE SEAM — the swap
 * itself, proven end-to-end with a SCRIPTED producer.
 *
 * The seam's module-scope composition is exercised for real: this suite
 * injects a scripted producer by mocking the producer MODULE
 * (apps/web/live-data/src/producer) — the app files themselves are never
 * touched — and then imports the REAL data seam + BOTH mounted mission
 * routes. The seam composes createLiveMissionDataProducer exactly ONCE at
 * module scope and every getLiveMissionData() call delegates to it; the
 * routes render whatever the (scripted) data plane honestly produced:
 *
 *   - a DRAINED observation renders the LIVE observed state through the
 *     real route modules (observed branch head, honest source states,
 *     the LIVE badge with the real provenance);
 *   - the HONEST EMPTY observation (the producer's incomplete-env shape:
 *     the explicit reference-store marker, a real probe instant, no
 *     drain) renders UNKNOWN/NO_DATA — never a fabricated snapshot;
 *   - the seam is a one-function one-file seam (the swap's shape: ONE
 *     composition, delegation per call — never a producer construction
 *     per request).
 */

import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

// The scripted producer state (hoisted so the vi.mock factory can close
// over it — the factory runs before any import in this file).
const script = vi.hoisted(() => {
  const state: {
    observation: unknown;
    composeCalls: number;
    produceCalls: number;
  } = { observation: null, composeCalls: 0, produceCalls: 0 };
  return state;
});

vi.mock('@integration/producer', () => ({
  createLiveMissionDataProducer: (): (() => Promise<unknown>) => {
    script.composeCalls += 1;
    return async (): Promise<unknown> => {
      script.produceCalls += 1;
      return script.observation;
    };
  },
}));

import type { LiveObservationData } from '@live-mission/dto';
import { getLiveMissionData, LIVE_MISSION_REPOSITORY_SUBJECT } from '@integration/seam';
import LiveMissionRoute from '@integration/live-mission-route';
import MissionRoute from '@integration/mission-route';
import { h, render, renderPage, drainedObservation, honestEmptyObservation, OBSERVED_HEAD, SCRIPTED_STORE_REF } from './helpers/fixtures';

/** Set the scripted producer's next answer, then read the seam (the composition under test). */
async function seamData(observation: LiveObservationData): Promise<LiveObservationData> {
  script.observation = observation;
  return getLiveMissionData();
}

describe('the seam swap (the architect-defined binding, module-scope composition)', () => {
  it('composes the producer EXACTLY ONCE at module scope and delegates every call (never a construction per request)', async () => {
    const before = script.composeCalls;
    await seamData(drainedObservation());
    await seamData(drainedObservation());
    await seamData(honestEmptyObservation());
    expect(script.composeCalls).toBe(before); // module scope — no new compositions
    expect(script.produceCalls).toBeGreaterThanOrEqual(3); // every call delegates
  });

  it('returns exactly the producer\u2019s honest answer (the seam adds nothing, removes nothing)', async () => {
    const scripted = drainedObservation();
    const data = await seamData(scripted);
    expect(data).toBe(scripted);
  });

  it('carries the repository subject binding (the observed repository is this deployment\u2019s subject)', () => {
    expect(LIVE_MISSION_REPOSITORY_SUBJECT).toBe('github:repo:payswapdotorg/SOS-2.0');
  });
});

describe('the mounted /live-mission route renders through the real seam (scripted drained observation)', () => {
  it('renders the LIVE observed state: the badge, the observed branch head, the honest source states', async () => {
    script.observation = drainedObservation();
    const html = await renderPage(LiveMissionRoute);
    expect(html).toContain('data-live-badge="true"');
    expect(html).toContain(SCRIPTED_STORE_REF);
    expect(html).toContain(OBSERVED_HEAD);
    expect(html).toContain('github:rest-events:payswapdotorg/SOS-2.0');
    // honest mixed source states render verbatim (UNAVAILABLE/DEGRADED never folded into CONNECTED)
    expect(html).toContain('UNAVAILABLE');
    expect(html).toContain('DEGRADED');
    expect(html).toContain('What is happening?');
    expect(html).toContain('Why does SOS believe this?');
  });

  it('renders the actions enabled against the EXACT observed head (the forms carry the real revision)', async () => {
    script.observation = drainedObservation();
    const html = await renderPage(LiveMissionRoute);
    const summonForm = html.slice(html.indexOf('data-action-form="summon-body"'));
    expect(summonForm.slice(0, summonForm.indexOf('</form>'))).toContain(OBSERVED_HEAD);
    expect(html).toContain('action="/api/live-mission/actions"');
  });
});

describe('the mounted /mission route renders through the SAME seam (one seam, one truth)', () => {
  it('renders the same scripted observation as /live-mission (the production mission surface)', async () => {
    script.observation = drainedObservation();
    const html = await renderPage(MissionRoute);
    expect(html).toContain('Mission — live');
    expect(html).toContain(OBSERVED_HEAD);
    expect(html).toContain(SCRIPTED_STORE_REF);
    expect(html).toContain('action="/api/live-mission/actions"');
  });
});

describe('the honest degraded path (the producer\u2019s incomplete-environment shape)', () => {
  it('renders the honest UNKNOWN/NO_DATA empty state with the EXPLICIT reference-store marker (never fabricated)', async () => {
    script.observation = honestEmptyObservation();
    const html = await renderPage(LiveMissionRoute);
    expect(html).toContain('No live observation drain has run yet');
    expect(html).toContain('No branch head observed yet');
    expect(html).toContain('No deployment observed yet');
    expect(html).toContain('SOS is watching');
    expect(html).toContain(SCRIPTED_STORE_REF);
    expect(html).not.toContain(OBSERVED_HEAD); // nothing from a drained state leaks into the empty state
  });

  it('the honest empty state disables the consequential actions (no fabricated sha to act on)', async () => {
    script.observation = honestEmptyObservation();
    const html = await renderPage(LiveMissionRoute);
    expect(html).toContain('No observed repository head yet');
    expect(html).toContain('disabled');
  });
});
