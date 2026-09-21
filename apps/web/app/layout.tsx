import { ShellRootLayout } from '../shell/components/root-layout';

export const metadata = {
  title: { default: 'SOS Console', template: '%s — SOS Console' },
  description:
    'The SOS 2.0 production console: mission, system, changes, evidence, experiments and autonomous work — with the reasoning behind everything.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <ShellRootLayout>{children}</ShellRootLayout>;
}
