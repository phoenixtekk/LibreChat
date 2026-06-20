import { useRecoilState } from 'recoil';
import { Bot, Eye, DollarSign, Brain, KeyRound, FileText } from 'lucide-react';
import { useLocalize } from '~/hooks';
import store from '~/store';
import { cn } from '~/utils';
import type { PreviewRailTab } from '~/store/misc';

type RailTabSpec = {
  tab: PreviewRailTab;
  labelKey: string;
  icon: typeof Bot;
};

const RAIL_TABS: RailTabSpec[] = [
  { tab: 'agent',   labelKey: 'com_atk_agent',   icon: Bot },
  { tab: 'preview', labelKey: 'com_atk_preview', icon: Eye },
  { tab: 'costs',   labelKey: 'com_atk_costs',   icon: DollarSign },
  { tab: 'memory',  labelKey: 'com_atk_memory',  icon: Brain },
  { tab: 'keys',    labelKey: 'com_atk_keys',    icon: KeyRound },
  { tab: 'files',   labelKey: 'com_atk_files',   icon: FileText },
];

/** Chat-header tab strip — six buttons that open (or refocus) the Preview Rail
 *  on a specific tab. Replaces the discoverability gap where users had to open
 *  the rail elsewhere (sidebar → API Keys, etc.) to reach Preview / Agent /
 *  Costs from a chat. Clicking the currently-active button closes the rail. */
export default function RailTabRow() {
  const localize = useLocalize();
  const [rail, setRail] = useRecoilState(store.previewRail);

  return (
    <div
      className="hidden items-center gap-0.5 rounded-lg border border-border-light bg-surface-secondary p-0.5 md:flex"
      role="tablist"
      aria-label={localize('com_atk_preview_rail')}
    >
      {RAIL_TABS.map(({ tab, labelKey, icon: Icon }) => {
        const active = rail.open && rail.tab === tab;
        const label = localize(labelKey);
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={label}
            title={label}
            onClick={() => {
              if (active) {
                setRail((prev) => ({ ...prev, open: false }));
              } else {
                setRail({ open: true, tab });
              }
            }}
            className={cn(
              'flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition',
              active
                ? 'bg-surface-active-alt text-text-primary'
                : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary',
            )}
          >
            <Icon size={14} aria-hidden="true" />
            <span className="hidden lg:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
