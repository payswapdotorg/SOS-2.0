import { RationalePage } from '../../../../shell/components/pages/rationale-page';

export default async function Page({ params }: { params: Promise<{ kind: string; segment: string }> }) {
  const { kind, segment } = await params;
  return <RationalePage kind={kind} segment={segment} />;
}
