import { LiveMissionPage } from '../../live-mission/src/components/live-mission-page';
import { getLiveMissionData } from '../live-mission/data-seam';
// The P18-B structural fix: the read-only mission view (shell/components/pages/mission-page.tsx)
// is REPLACED by the P17-C live Mission experience — mounted here through the architect-defined
// data seam (apps/web/app/live-mission/data-seam.ts). See apps/web/live-mission/MOUNTING.md.
export const metadata = { title: 'Mission' };
export const dynamic = 'force-dynamic'; // live data — no static caching of live state

export default async function Page() {
  const data = await getLiveMissionData();
  return <LiveMissionPage data={data} />;
}
