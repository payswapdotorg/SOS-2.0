import { BrownfieldFlow } from '../../../onboarding/src/components/brownfield-flow';
import type { OnboardingSearchParams } from '../../../onboarding/src/view-state/onboarding-views';

export const metadata = { title: 'Import an existing system' };

export default async function Page({ searchParams }: { searchParams: Promise<OnboardingSearchParams> }) {
  const params = await searchParams;
  return <BrownfieldFlow params={params} />;
}
