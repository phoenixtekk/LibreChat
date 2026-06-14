import { useEffect, useCallback } from 'react';
import { useRecoilState } from 'recoil';
import type { RailTab } from './PreviewRail';
import CommandPalette from './CommandPalette';
import PreviewRail from './PreviewRail';
import useAgentStream from './useAgentStream';
import useComposerHistory from './useComposerHistory';
import { initTheme } from './theme';
import store from '~/store';

/**
 * Single mount point for all Analytikul UI extensions (mounted once in Root.tsx).
 * Applies the persisted skin/accent, registers the command palette and composer
 * history, hosts the Preview Rail, and owns the agent stream state. The rail
 * auto-opens when an agent task starts so live output is always visible.
 */
export default function AnalytikulProvider() {
  const [rail, setRail] = useRecoilState(store.previewRail);
  const stream = useAgentStream();

  useEffect(() => {
    initTheme();
  }, []);

  useComposerHistory();

  useEffect(() => {
    if (stream.state === 'running') {
      setRail((prev) => ({ ...prev, open: true }));
    }
  }, [stream.state, setRail]);

  const toggleRail = useCallback(() => setRail((prev) => ({ ...prev, open: !prev.open })), [setRail]);
  const openCosts = useCallback(() => setRail({ tab: 'costs', open: true }), [setRail]);
  const setTab = useCallback(
    (tab: RailTab) => setRail((prev) => ({ ...prev, tab })),
    [setRail],
  );

  return (
    <>
      <CommandPalette onTogglePreviewRail={toggleRail} onOpenCosts={openCosts} />
      <PreviewRail
        open={rail.open}
        onClose={() => setRail((prev) => ({ ...prev, open: false }))}
        stream={stream}
        tab={rail.tab}
        setTab={setTab}
      />
    </>
  );
}
