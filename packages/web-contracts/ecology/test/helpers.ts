/**
 * Shared test assembly — builds the demo ecology world once per test file,
 * seeds the demo live store through the repositories and exposes the
 * projection inputs exactly the way the product surfaces assemble them.
 */

import { buildRationaleChain } from '@sos-2/ui-contracts';
import type { RationaleChain } from '@sos-2/ui-contracts';
import type { TraceLink } from '@sos-2/semantic-spine';
import { demoDataSource, DEMO_NOTE } from '@sos-2/web-contracts';
import {
  buildDemoEcologyWorld,
  createDemoEcologyLiveStore,
  DEMO_ECOLOGY_STORE_REF,
  readEcologyLiveState,
} from '../src/index.js';
import type { DemoEcologyWorld, EcologyLiveReadResult } from '../src/index.js';

export function world(): DemoEcologyWorld {
  return buildDemoEcologyWorld();
}

export function demoSource() {
  return demoDataSource(world().fixture_revision, DEMO_NOTE);
}

/** All trace links: the base P1 web + the P10 ecology additions. */
export function allLinks(w: DemoEcologyWorld): TraceLink[] {
  return [...w.base.links, ...w.links];
}

export function chainFor(subjectId: string, links: readonly TraceLink[], evidenceRefs: readonly string[] = []): RationaleChain {
  return buildRationaleChain({ subject_id: subjectId, links, evidence_refs: evidenceRefs });
}

/** The demo live store, seeded through the repositories (async, once per call). */
export async function liveRead(w: DemoEcologyWorld): Promise<EcologyLiveReadResult> {
  const store = await createDemoEcologyLiveStore(w);
  return readEcologyLiveState(store, { store_ref: DEMO_ECOLOGY_STORE_REF, as_of: w.now });
}
