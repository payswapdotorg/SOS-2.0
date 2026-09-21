import { AdvancedImportSurface } from '../../../onboarding/src/components/advanced-import-surface';
import type { OnboardingSearchParams } from '../../../onboarding/src/view-state/onboarding-views';

export const metadata = { title: 'Advanced: import raw JSON' };

export default async function Page({ searchParams }: { searchParams: Promise<OnboardingSearchParams> }) {
  const params = await searchParams;
  return <AdvancedImportSurface params={params} />;
}
