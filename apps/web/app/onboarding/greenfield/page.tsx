import { GreenfieldWizard } from '../../../onboarding/src/components/greenfield-wizard';
import type { OnboardingSearchParams } from '../../../onboarding/src/view-state/onboarding-views';

export const metadata = { title: 'Start a mission' };

export default async function Page({ searchParams }: { searchParams: Promise<OnboardingSearchParams> }) {
  const params = await searchParams;
  return <GreenfieldWizard params={params} />;
}
