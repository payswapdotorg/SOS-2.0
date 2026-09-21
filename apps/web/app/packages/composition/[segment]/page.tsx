import { CompositionDetail } from '../../../../ecology/shell/pages/composition-detail';

export default async function Page({ params }: { params: Promise<{ segment: string }> }) {
  const { segment } = await params;
  return <CompositionDetail segment={segment} />;
}
