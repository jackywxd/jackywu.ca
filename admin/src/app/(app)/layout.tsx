import type { ReactNode } from 'react';
import Link from 'next/link';
import './globals.css';
import { NavLinks } from '../../components/NavLinks';

export const metadata = { title: '紅塵客棧後台', robots: { index: false, follow: false } };
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' as const, interactiveWidget: 'resizes-content' as const };

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>
        <div className="app">
          <header className="topbar">
            <Link className="brand" href="/tales">紅塵客棧<small>後台</small></Link>
            <nav className="topnav" aria-label="主選單"><NavLinks /></nav>
          </header>
          <main className="main">{children}</main>
          <nav className="tabbar" aria-label="主選單"><NavLinks /></nav>
        </div>
      </body>
    </html>
  );
}
