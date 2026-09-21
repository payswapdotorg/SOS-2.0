/**
 * The shell root layout — the html/body scaffold. The keyboard skip link
 * and the page structure (rail, header, main, footer) are composed per
 * page by PageShell so every surface is fully server-rendered with its own
 * active navigation state (zero client components in the shell).
 */

import type { ReactNode } from 'react';

export function ShellRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-paper font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
