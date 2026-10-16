import type { ReactNode } from 'react';

export const metadata = { title: '紅塵客棧後台' };

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
