import { LiveMissionPage } from '../../live-mission/src/components/live-mission-page';
import { getLiveMissionData } from './data-seam';

export const metadata = { title: 'Mission — live' };
export const dynamic = 'force-dynamic'; // live data — no static caching of live state

export default async function Page() {
  const data = await getLiveMissionData();
  return <LiveMissionPage data={data} />;
}
