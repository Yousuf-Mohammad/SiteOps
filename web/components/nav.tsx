'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const items = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/claims', label: 'Expense Claims' },
  { href: '/dockets', label: 'Plant Dockets' },
  { href: '/projects', label: 'Projects' },
  { href: '/equipment', label: 'Equipment' },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav>
      {items.map((item) => (
        <Link key={item.href} href={item.href} className={pathname.startsWith(item.href) ? 'active' : ''}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
