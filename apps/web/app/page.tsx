import { PageShell } from '../shell/components/page-shell';
import { OverviewBody, RootStartSurface } from './start-surface';

export default function Page() {
  return (
    <PageShell section="overview">
      <RootStartSurface />
      <OverviewBody />
    </PageShell>
  );
}
