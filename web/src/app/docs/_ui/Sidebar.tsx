'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { DOCS, GROUPS, href } from './pages';

function List({ path, onPick }: { path: string; onPick?: () => void }) {
  return (
    <nav className="space-y-5">
      {GROUPS.map((g) => (
        <div key={g.id}>
          <p className="px-2.5 text-[14px] font-semibold text-ink">{g.title}</p>
          {/* Pages sit in from their group, on a line of their own, so the two levels read apart. */}
          <ul className="ml-2.5 mt-1.5 space-y-0.5 border-l border-white/[.08] pl-2">
            {DOCS.filter((d) => d.group === g.id).map((d) => {
              const on = path === href(d.slug);
              return (
                <li key={d.slug}>
                  <Link
                    href={href(d.slug)}
                    onClick={onPick}
                    aria-current={on ? 'page' : undefined}
                    className={`relative block rounded-lg px-2.5 py-1.5 text-[13.5px] transition-colors ${on ? 'bg-accent/[.14] font-medium text-accent before:absolute before:-left-[9px] before:inset-y-1.5 before:w-[2px] before:rounded-full before:bg-accent' : 'text-muted hover:bg-white/[.05] hover:text-ink'}`}
                  >
                    {d.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** The docs' own way around: a column beside the page on a wide screen, a menu that folds away on a narrow one. */
export function Sidebar() {
  const path = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  const current = DOCS.find((d) => href(d.slug) === path);

  useEffect(() => {
    if (menu.current) menu.current.open = false;
  }, [path]);

  return (
    <>
      <details ref={menu} className="panel group lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 truncate">
            <span className="text-muted">Docs</span>
            {current && <span className="text-ink"> · {current.title}</span>}
          </span>
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </summary>
        <div className="border-t border-white/[.06] px-2 pb-4 pt-3">
          <List path={path} onPick={() => menu.current && (menu.current.open = false)} />
        </div>
      </details>
      <aside className="panel no-scrollbar sticky top-0 hidden max-h-[calc(100dvh-80px)] w-[232px] shrink-0 overflow-y-auto px-2 py-4 lg:block">
        <List path={path} />
      </aside>
    </>
  );
}
