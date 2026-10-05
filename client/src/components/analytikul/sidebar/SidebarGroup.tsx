import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '~/utils';

/** Collapse state for a nav group, persisted per-group in localStorage (defaults open). */
export function usePersistedOpen(key: string) {
  const storageKey = `atk_nav_${key}`;
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(storageKey) !== '0';
    } catch {
      return true;
    }
  });
  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(storageKey, next ? '1' : '0');
      } catch {
        /* private mode / blocked storage — state still toggles for this session */
      }
      return next;
    });
  }, [storageKey]);
  return [open, toggle] as const;
}

/** The one category-header look shared by every group (Workspace, Knowledge, Favorites, Projects, Chats). */
export function SidebarGroupHeader({
  label,
  open,
  onToggle,
  trailing,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  trailing?: ReactNode;
}) {
  return (
    <div className="mt-1 flex items-center gap-0.5 pr-1">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center justify-between rounded-lg px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-text-tertiary transition hover:text-text-secondary"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="truncate">{label}</span>
        <ChevronDown
          size={13}
          className={cn('shrink-0 transition-transform', open ? '' : '-rotate-90')}
          aria-hidden="true"
        />
      </button>
      {trailing}
    </div>
  );
}

/** A self-contained collapsible category (persisted) wrapping its rows. */
export function SidebarGroup({
  id,
  label,
  children,
  trailing,
}: {
  id: string;
  label: string;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  const [open, toggle] = usePersistedOpen(id);
  return (
    <div>
      <SidebarGroupHeader label={label} open={open} onToggle={toggle} trailing={trailing} />
      {open && <div className="mt-px flex flex-col gap-px">{children}</div>}
    </div>
  );
}

/** One nav row — identical shape for every item so the rail reads as one system. */
export function NavRow({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-text-secondary transition hover:bg-surface-hover hover:text-text-primary',
        active ? 'bg-surface-active text-text-primary' : '',
      )}
    >
      <Icon size={16} strokeWidth={2} aria-hidden={true} />
      <span className="truncate">{label}</span>
    </button>
  );
}
