import { useEffect, useState, useCallback } from 'react';
import type { RailTab } from './PreviewRail';
import CommandPalette from './CommandPalette';
import PreviewRail from './PreviewRail';
import useAgentStream from './useAgentStream';
import useComposerHistory from './useComposerHistory';
import { initTheme } from './theme';

/**
 * Single mount point for all Analytikul UI extensions (mounted once in Root.tsx).
 * Applies the persisted skin/accent, registers the command palette and composer
 * history, hosts the Preview Rail, and owns the agent stream state. The rail
 * auto-opens when an agent task starts so live output is always visible.
 */
export default function AnalytikulProvider() {
  const [railOpen, setRailOpen] = useState(false);
  const [railTab, setRailTab] = useState<RailTab>('agent');
  const stream = useAgentStream();

  useEffect(() => {
    initTheme();
  }, []);

  useComposerHistory();

  useEffect(() => {
    if (stream.state === 'running') {
      setRailOpen(true);
    }
  }, [stream.state]);

  const toggleRail = useCallback(() => setRailOpen((prev) => !prev), []);
  const openCosts = useCallback(() => {
    setRailTab('costs');
    setRailOpen(true);
  }, []);

  return (
    <>
      <CommandPalette onTogglePreviewRail={toggleRail} onOpenCosts={openCosts} />
      <PreviewRail
        open={railOpen}
        onClose={() => setRailOpen(false)}
        stream={stream}
        tab={railTab}
        setTab={setRailTab}
      />
    </>
  );
}
