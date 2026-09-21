/**
 * Shared test assembly — builds the demo world once per test file and
 * exposes the projection inputs exactly the way the production shell
 * assembles them (mirrors the W11 console test discipline).
 */

import type { EvidenceRecordW3 } from '@sos-2/evidence';
import { buildRationaleChain } from '@sos-2/ui-contracts';
import type { RationaleChain } from '@sos-2/ui-contracts';
import {
  buildDemoWebWorld,
  demoDataSource,
  DEMO_NOTE,
} from '../src/index.js';
import type { DemoWebWorld } from '../src/index.js';

export function world(): DemoWebWorld {
  return buildDemoWebWorld();
}

export function demoSource() {
  return demoDataSource(world().fixture_revision, DEMO_NOTE);
}

export function chainFor(subjectId: string, links: DemoWebWorld['links'], evidenceRefs: readonly string[] = []): RationaleChain {
  return buildRationaleChain({ subject_id: subjectId, links, evidence_refs: evidenceRefs });
}

/** The current (ACTIVE) artifact of a supersede chain. */
export function currentOf<T extends { envelope: { status: string } }>(artifacts: readonly T[]): T {
  const active = artifacts.find((artifact) => artifact.envelope.status === 'ACTIVE');
  if (!active) {
    throw new Error('no ACTIVE artifact in the chain');
  }
  return active;
}

/** Evidence records whose subject is one of the given spine ids. */
export function evidenceAbout(records: readonly EvidenceRecordW3[], subjectIds: readonly string[]): EvidenceRecordW3[] {
  return records.filter((record) => subjectIds.includes(record.subject_ref));
}
