import { useMemo, useState } from 'react';
import { useLocalize } from '~/hooks';
import type { AgentEvent } from './useAgentStream';

/**
 * PreviewRail renderer registry — picks a renderer for a tool output by shape:
 * image data/URL → <img>, HTML documents → sandboxed iframe, JSON → tree,
 * anything else → terminal-style monospace block.
 */

export type RenderKind = 'image' | 'html' | 'json' | 'terminal';

export function detectRenderKind(output: string): RenderKind {
  const trimmed = output.trimStart();
  if (
    trimmed.startsWith('data:image/') ||
    /\.(png|jpe?g|gif|webp)(\?|$)/i.test(trimmed.slice(0, 2000))
  ) {
    return 'image';
  }
  if (/^<!doctype html|^<html/i.test(trimmed)) {
    return 'html';
  }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      /* fall through to terminal */
    }
  }
  return 'terminal';
}

export function OutputRenderer({ output }: { output: string }) {
  const kind = useMemo(() => detectRenderKind(output), [output]);
  if (kind === 'image') {
    return <ImageRenderer src={output.trim()} />;
  }
  if (kind === 'html') {
    return <HtmlRenderer html={output} />;
  }
  if (kind === 'json') {
    return <JsonTree data={JSON.parse(output)} />;
  }
  return <TerminalBlock text={output} />;
}

function ImageRenderer({ src }: { src: string }) {
  const localize = useLocalize();
  return (
    <img
      src={src}
      alt={localize('com_atk_tool_screenshot')}
      className="max-w-full rounded-md border border-border-light"
    />
  );
}

function HtmlRenderer({ html }: { html: string }) {
  const localize = useLocalize();
  return (
    <iframe
      sandbox=""
      srcDoc={html}
      title={localize('com_atk_tool_html_preview')}
      className="h-96 w-full rounded-md border border-border-light bg-surface-primary"
    />
  );
}

export function TerminalBlock({ text }: { text: string }) {
  return (
    <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border-light bg-surface-primary-alt p-3 font-mono text-xs text-text-primary">
      {stripAnsi(text)}
    </pre>
  );
}

const ANSI_PATTERN = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

export function JsonTree({ data, depth = 0 }: { data: unknown; depth?: number }) {
  if (data === null || typeof data !== 'object') {
    return <span className="font-mono text-xs text-text-secondary">{JSON.stringify(data)}</span>;
  }
  const entries = Array.isArray(data)
    ? data.map((value, index) => [String(index), value] as const)
    : Object.entries(data as Record<string, unknown>);
  return (
    <div className={depth > 0 ? 'ml-3 border-l border-border-light pl-2' : undefined}>
      {entries.slice(0, 100).map(([key, value]) => (
        <JsonNode key={key} name={key} value={value} depth={depth} />
      ))}
    </div>
  );
}

function JsonNode({ name, value, depth }: { name: string; value: unknown; depth: number }) {
  const isBranch = value !== null && typeof value === 'object';
  const [open, setOpen] = useState(depth < 2);
  if (!isBranch) {
    return (
      <div className="font-mono text-xs">
        <span className="text-text-primary">{name}</span>
        <span className="text-text-tertiary">: </span>
        <span className="text-text-secondary">{JSON.stringify(value)}</span>
      </div>
    );
  }
  return (
    <div>
      <button
        type="button"
        className="font-mono text-xs text-text-primary hover:underline"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        {open ? '▾ ' : '▸ '}
        {name}
        <span className="text-text-tertiary">
          {Array.isArray(value) ? ` [${value.length}]` : ' {…}'}
        </span>
      </button>
      {open && <JsonTree data={value} depth={depth + 1} />}
    </div>
  );
}

export function latestRenderableOutput(events: AgentEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === 'tool_complete' && event.output) {
      return event.output;
    }
  }
  return null;
}
