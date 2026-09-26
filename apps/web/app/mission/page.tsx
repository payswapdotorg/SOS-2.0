/**
 * The production Mission route (Work Order P18-B): the LIVE Mission
 * experience replaces the read-only fixture view
 * (../../shell/components/pages/mission-page — retired from this route).
 */

import { MissionLiveRoute } from './mission-live-route';

export const metadata = { title: 'Mission — live' };
export const dynamic = 'force-dynamic'; // live data — no static caching of live state

export default function Page() {
  return <MissionLiveRoute />;
}
