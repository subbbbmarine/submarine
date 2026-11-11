import Link from 'next/link';
import type { ReactNode } from 'react';
import { CopyButton } from './CopyButton';
import { GROUPS, entry, href, neighbours } from './pages';

/** One docs page: where it sits, its title and lead, what's on it, the page itself, and the pages either side. */
export function Doc({ slug, lead, toc, children }: { slug: string; lead: ReactNode; toc?: Array<[string, string]>; children: ReactNode }) {
  const me = entry(slug);
  const { prev, next } = neighbours(slug);
  const group = GROUPS.find((g) => g.id === me.group)!;
  return (
    <article className="panel min-w-0 px-4 py-6 sm:px-8 sm:py-8">
      <p className="text-[13px] text-faint">
        <Link href="/docs" className="hover:text-ink">
          Docs
        </Link>
        <span> · {group.title}</span>
      </p>
      <h1 className="mt-1.5 text-[26px] font-bold leading-tight tracking-tight sm:text-[30px]">{me.title}</h1>
      <div className="mt-3 max-w-[68ch] text-[15px] leading-relaxed text-ink/85">{lead}</div>

      {toc && toc.length > 1 && (
        <nav className="mt-6 rounded-xl bg-white/[.03] px-4 py-3.5" aria-label="On this page">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-faint">On this page</p>
          <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {toc.map(([id, title]) => (
              <li key={id} className="min-w-0">
                <a href={`#${id}`} className="block truncate text-[14px] text-muted hover:text-accent">
                  {title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <div className="mt-2">{children}</div>

      {(prev || next) && (
        <div className="mt-12 grid gap-2 border-t border-white/[.06] pt-6 sm:grid-cols-2">
          {prev ? (
            <Link href={href(prev.slug)} className="group rounded-xl bg-white/[.03] px-4 py-3 transition-colors hover:bg-white/[.06]">
              <span className="text-[12px] text-faint">Previous</span>
              <span className="mt-0.5 block font-semibold group-hover:text-accent">{prev.title}</span>
              <span className="mt-0.5 block text-[13px] leading-snug text-muted">{prev.blurb}</span>
            </Link>
          ) : (
            <span className="hidden sm:block" />
          )}
          {next && (
            <Link href={href(next.slug)} className="group rounded-xl bg-white/[.03] px-4 py-3 text-right transition-colors hover:bg-white/[.06]">
              <span className="text-[12px] text-faint">Next</span>
              <span className="mt-0.5 block font-semibold group-hover:text-accent">{next.title}</span>
              <span className="mt-0.5 block text-[13px] leading-snug text-muted">{next.blurb}</span>
            </Link>
          )}
        </div>
      )}
    </article>
  );
}

export function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="mt-10 scroll-mt-4 border-t border-white/[.06] pt-6 text-[19px] font-semibold tracking-tight">
      <a href={`#${id}`} className="hover:text-accent">
        {children}
      </a>
    </h2>
  );
}

export function H3({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h3 id={id} className="mt-6 scroll-mt-4 text-[15px] font-semibold">
      {children}
    </h3>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="mt-3 max-w-[72ch] text-[15px] leading-relaxed text-muted">{children}</p>;
}

/** A link to another docs page, by its slug, with an optional section. */
export function L({ to, at, children }: { to: string; at?: string; children: ReactNode }) {
  return (
    <Link href={`${href(to)}${at ? `#${at}` : ''}`} className="text-accent hover:underline">
      {children}
    </Link>
  );
}

/** A link to a page of Submarine itself. */
/** Built for submarine.live before launch, with no terminal beside the docs to open. */
const DOCS_ONLY = process.env.NEXT_PUBLIC_DOCS_ONLY === '1';

/** A link into the terminal. In the docs on their own, where the terminal isn't live yet, just its name. */
export function Go({ to, children }: { to: string; children: ReactNode }) {
  if (DOCS_ONLY) return <span className="font-medium text-ink">{children}</span>;
  return (
    <Link href={to} className="text-accent hover:underline">
      {children}
    </Link>
  );
}

export function Ext({ to, children }: { to: string; children: ReactNode }) {
  return (
    <a href={to} target="_blank" rel="noreferrer" className="text-accent hover:underline">
      {children}
    </a>
  );
}

export function C({ children }: { children: ReactNode }) {
  return <code className="num break-words rounded-md bg-white/[.06] px-1.5 py-0.5 text-[13px] text-ink">{children}</code>;
}

export function B({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-ink">{children}</strong>;
}

export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mt-3 max-w-[72ch] space-y-2">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2.5 text-[15px] leading-relaxed text-muted">
          <span className="mt-[10px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
          <span className="min-w-0">{it}</span>
        </li>
      ))}
    </ul>
  );
}

/** Steps in order, down one line: a mark on the line for each, and the line itself says which comes next. */
export function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="mt-4 max-w-[72ch]">
      {items.map((it, i) => (
        <li key={i} className="relative pb-3.5 pl-7 text-[15px] leading-relaxed text-muted last:pb-0">
          {i < items.length - 1 && <span className="absolute bottom-0 left-[5px] top-[18px] w-px bg-white/[.12]" aria-hidden="true" />}
          <span className="absolute left-0 top-[8px] h-[11px] w-[11px] rounded-[3px] border-2 border-accent bg-bg" aria-hidden="true" />
          {it}
        </li>
      ))}
    </ol>
  );
}

/** A bold first sentence carrying the point, and the rest of the note after it. */
export function Note({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="mt-4 max-w-[72ch] rounded-r-xl border-l-2 border-accent bg-accent/[.05] px-4 py-3 text-[15px] leading-relaxed text-muted">
      <B>{title}</B> {children}
    </div>
  );
}

/** A table that scrolls sideways inside itself on a narrow screen, so the page never does. */
export function Table({ cols, rows, caption, numeric }: { cols: ReactNode[]; rows: ReactNode[][]; caption?: ReactNode; numeric?: number[] }) {
  const right = new Set(numeric ?? []);
  return (
    <figure className="mt-4">
      <div className="max-w-full overflow-x-auto rounded-xl border border-white/[.06]">
        <table className="w-full min-w-[420px] border-collapse text-left text-[14px]">
          <thead>
            <tr className="bg-white/[.03]">
              {cols.map((c, i) => (
                <th key={i} className={`whitespace-nowrap px-3.5 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-faint ${right.has(i) ? 'text-right' : ''}`}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-white/[.06] align-top">
                {r.map((cell, j) => (
                  <td key={j} className={`px-3.5 py-2.5 leading-snug ${j === 0 ? 'text-ink' : 'text-muted'} ${right.has(j) ? 'num whitespace-nowrap text-right' : ''}`}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {caption && <figcaption className="mt-2 text-[13px] text-faint">{caption}</figcaption>}
    </figure>
  );
}

export function Code({ code, lang, title }: { code: string; lang?: string; title?: string }) {
  return (
    <figure className="mt-4 overflow-hidden rounded-xl border border-white/[.06] bg-black/40">
      <div className="flex items-center justify-between gap-3 border-b border-white/[.06] px-3.5 py-1.5">
        <span className="min-w-0 truncate text-[12px] text-faint">{title ?? lang ?? 'code'}</span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto px-3.5 py-3 text-[13px] leading-relaxed text-ink/90">
        <code>{code}</code>
      </pre>
    </figure>
  );
}

/** Label, value and a line under it, side by side on a wide screen. */
export function Stats({ items }: { items: Array<[string, string, string]> }) {
  return (
    <div className="mt-5 grid grid-cols-1 gap-2 min-[440px]:grid-cols-2 md:grid-cols-3">
      {items.map(([label, value, note]) => (
        <div key={label} className="rounded-xl bg-white/[.03] px-4 py-3">
          <p className="text-[12px] text-faint">{label}</p>
          <p className="num mt-0.5 text-[18px] text-ink">{value}</p>
          <p className="mt-0.5 text-[13px] leading-snug text-muted">{note}</p>
        </div>
      ))}
    </div>
  );
}

export function Terms({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="mt-4 max-w-[72ch] space-y-3.5">
      {items.map(([term, def]) => (
        <div key={term}>
          <dt className="font-semibold text-ink">{term}</dt>
          <dd className="mt-0.5 text-[15px] leading-relaxed text-muted">{def}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Faq({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <div className="mt-4 max-w-[72ch] divide-y divide-white/[.06] rounded-xl border border-white/[.06]">
      {items.map(([q, a]) => (
        <details key={q} className="group px-4 py-3">
          <summary className="flex cursor-pointer list-none items-start justify-between gap-3 font-medium text-ink [&::-webkit-details-marker]:hidden">
            <span>{q}</span>
            <span className="num mt-px shrink-0 text-muted transition-transform group-open:rotate-45">+</span>
          </summary>
          <div className="mt-2 text-[15px] leading-relaxed text-muted">{a}</div>
        </details>
      ))}
    </div>
  );
}

/** Where money goes, as a tree: each line an amount and what it is, with its parts under it. */
export interface Flow {
  amount: string;
  label: ReactNode;
  parts?: Flow[];
}

function FlowRows({ items, depth }: { items: Flow[]; depth: number }) {
  return (
    <ul className={depth ? 'ml-3 mt-1 space-y-1 border-l border-white/10 pl-3 sm:ml-4 sm:pl-4' : 'space-y-1'}>
      {items.map((f, i) => (
        <li key={i}>
          <div className="flex gap-3 text-[14px] leading-snug">
            <span className={`num w-[86px] shrink-0 text-right ${depth === 0 ? 'text-accent' : 'text-ink'}`}>{f.amount}</span>
            <span className="min-w-0 text-muted">{f.label}</span>
          </div>
          {f.parts && <FlowRows items={f.parts} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

export function FlowTree({ items, caption }: { items: Flow[]; caption?: ReactNode }) {
  return (
    <figure className="mt-4 max-w-[72ch] rounded-xl bg-white/[.03] px-3 py-3.5 sm:px-4">
      <FlowRows items={items} depth={0} />
      {caption && <figcaption className="mt-3 text-[13px] text-faint">{caption}</figcaption>}
    </figure>
  );
}

/** Cards that lead to other pages, for an index or the end of a page. */
export function Cards({ slugs }: { slugs: string[] }) {
  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-2">
      {slugs.map((s) => {
        const d = entry(s);
        return (
          <Link key={s} href={href(s)} className="group rounded-xl bg-white/[.03] px-4 py-3 transition-colors hover:bg-white/[.06]">
            <span className="block font-semibold group-hover:text-accent">{d.title}</span>
            <span className="mt-0.5 block text-[13px] leading-snug text-muted">{d.blurb}</span>
          </Link>
        );
      })}
    </div>
  );
}
