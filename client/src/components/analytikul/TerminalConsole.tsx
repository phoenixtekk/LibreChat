import { useEffect, useMemo, useRef } from 'react';
import type { AgentStreamApi } from './useAgentStream';

/**
 * Analytikul Coder cockpit — a live build/terminal console. Renders the agent's
 * terminal + code_execution activity as a scrolling console so you can watch
 * `npm install` / `npm run build` / git commands happen in real time.
 */
export default function TerminalConsole({ stream }: { stream: AgentStreamApi }) {
  const endRef = useRef<HTMLDivElement | null>(null);

  const lines = useMemo(() => {
    const out: { kind: 'cmd' | 'out'; text: string }[] = [];
    for (const e of stream.events) {
      if (e.tool !== 'terminal' && e.tool !== 'code_execution') {
        continue;
      }
      if (e.type === 'tool_start' && e.args) {
        const cmd = (e.args.command ?? e.args.code ?? '') as string;
        if (cmd) {
          out.push({ kind: 'cmd', text: String(cmd) });
        }
      } else if (e.type === 'tool_complete' && e.output) {
        let text = e.output;
        try {
          const parsed = JSON.parse(e.output) as { output?: string; stdout?: string };
          text = parsed.output ?? parsed.stdout ?? e.output;
        } catch {
          /* not JSON — show raw */
        }
        if (text && String(text).trim()) {
          out.push({ kind: 'out', text: String(text) });
        }
      }
    }
    return out;
  }, [stream.events]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines.length]);

  if (lines.length === 0) {
    return (
      <div className="atk-empty-state">
        <strong>Build console</strong>
        <span>Terminal &amp; build output streams here while the agent runs.</span>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto rounded-md bg-[#0b0f10] p-2 font-mono text-[11px] leading-relaxed">
      {lines.map((l, i) =>
        l.kind === 'cmd' ? (
          <div key={i} className="text-cyan-300">
            <span className="select-none text-cyan-500">$ </span>
            {l.text}
          </div>
        ) : (
          <pre key={i} className="mb-1 whitespace-pre-wrap text-gray-300">
            {l.text}
          </pre>
        ),
      )}
      <div ref={endRef} />
    </div>
  );
}
