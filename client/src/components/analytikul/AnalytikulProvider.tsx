import { useEffect, useCallback } from 'react';
import { useRecoilState, useSetRecoilState, useRecoilValue } from 'recoil';
import type { RailTab } from './PreviewRail';
import { CatalogPanel } from './catalog';
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
  const setCatalog = useSetRecoilState(store.catalogPanel);
  const activeSpec = useRecoilValue(store.conversationSpecByIndex(0));
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

  // The "Hermes Agent" spec is the default experience — when it's the active
  // model, surface the agent console (open the rail on its Agent tab).
  useEffect(() => {
    if (activeSpec === 'hermes-agent') {
      setRail((prev) => ({ ...prev, open: true, tab: 'agent' }));
    }
  }, [activeSpec, setRail]);

  // Global Ctrl/Cmd+K opens the Discover catalog. Replaces the old
  // hand-rolled CommandPalette (the catalog supersedes its commands).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        const isEditable =
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          target?.isContentEditable === true;
        if (isEditable) {
          return;
        }
        e.preventDefault();
        setCatalog((prev) => ({ open: !prev.open }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setCatalog]);

  const setTab = useCallback(
    (tab: RailTab) => setRail((prev) => ({ ...prev, tab })),
    [setRail],
  );

  return (
    <>
      <CatalogPanel />
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
