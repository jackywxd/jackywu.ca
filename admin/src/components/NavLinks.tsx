'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/tales', label: '文章' },
  { href: '/media', label: '媒體' },
  { href: '/system', label: '系統' },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <>
      {ITEMS.map((i) => (
        <Link key={i.href} href={i.href} aria-current={path === i.href || path.startsWith(`${i.href}/`) ? 'page' : undefined}>
          {i.label}
        </Link>
      ))}
    </>
  );
}
