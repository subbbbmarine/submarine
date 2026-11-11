import { Sidebar } from './_ui/Sidebar';

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-stretch gap-2 lg:flex-row lg:items-start">
      <Sidebar />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
