/**
 * The live mission route body (Work Order P18-B — the operator's
 * structural fix): the production /mission route now mounts the P17-C
 * LIVE Mission experience (Start mission / Import system / Resume
 * existing mission + live observation + authority-gated consequential
 * actions), replacing the read-only fixture-backed mission view
 * (../../shell/components/pages/mission-page — retired FROM THIS ROUTE;
 * the shell module itself stays untouched for the frozen shell suite).
 *
 * Explanation strengths of the read-only view are preserved by the live
 * surface itself (the P17-C design): the six product review questions
 * are answered inline on every live card (what / why / evidence /
 * uncertainty / authority / next — the rationale presentation, kept
 * current with the observed state instead of a fixture revision),
 * retained uncertainty stays VISIBLE (honest UNKNOWN/NO_DATA +
 * ALIGNED/DIVERGED/UNVERIFIED/STALE findings), and every consequential
 * action receipt renders evidence and rationale deep links (/evidence,
 * /rationale on the receipt view).
 *
 * Fully server-rendered from the data seam — no client fetches; live
 * data enters through server-produced props only.
 */

import { LiveMissionPage } from '../../live-mission/src/components/live-mission-page';
import { getLiveMissionData } from '../live-mission/data-seam';

/** The live mission route module (mounted by the thin /mission route wrapper). */
export async function MissionLiveRoute() {
  // The SAME seam the /live-mission route consumes (one seam, one truth):
  // the honest 'unwired' empty state until the data plane lands (lane P18-A
  // swaps the seam body at the architect's integration pass). The
  // resumable-mission list stays honestly empty for the same reason (no
  // authoritative mission store is wired on this branch).
  const data = await getLiveMissionData();
  return <LiveMissionPage data={data} />;
}
