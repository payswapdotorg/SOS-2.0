import { RevisionDetail } from '../../../../../ecology/shell/pages/revision-detail';

export default async function Page({ params }: { params: Promise<{ kind: string; segment: string }> }) {
  const { kind, segment } = await params;
  return <RevisionDetail kind={kind} segment={segment} />;
}
