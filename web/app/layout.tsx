import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from './providers';
import { Nav } from '../components/nav';
import { UserSwitcher } from '../components/user-switcher';

export const metadata = { title: 'SiteOps — Expense Claims' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="shell">
            <aside className="sidebar">
              <div className="brand">SiteOps</div>
              <Nav />
            </aside>
            <div className="content">
              <header className="topbar">
                <span className="muted">Acting as</span>
                <UserSwitcher />
              </header>
              <main className="page">{children}</main>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
