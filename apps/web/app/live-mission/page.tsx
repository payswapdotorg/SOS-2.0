/**
 * The live-mission route (Work Order P18-B — MOUNTING.md integration step 1:
 * the one file the architect adds; lane B executes it). Mounts the P17-C
 * LiveMissionPage over the live-mission data seam.
 */

import { LiveMissionPage } from '../../live-mission/src/components/live-mission-page';
import { getLiveMissionData } from './data-seam';

export const metadata = { title: 'Mission — live' };
export const dynamic = 'force-dynamic'; // live data — no static caching of live state

export default async function Page() {
  // The data seam (P18-B): the honest 'unwired' empty state until the
  // architect's integration pass swaps the seam body for the lane-A real
  // producer. Never fabricated live state.
  const data = await getLiveMissionData();
  return <LiveMissionPage data={data} />;
}
