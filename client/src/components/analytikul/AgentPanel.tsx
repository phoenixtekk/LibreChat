import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useLocalize } from '~/hooks';
import TraceViewer from './TraceViewer';
import type { AgentStreamApi } from './useAgentStream';

/** Agent tab in the Preview Rail: launch tasks, watch the live trace, cancel. */
export default function AgentPanel({ stream }: { stream: AgentStreamApi }) {
  const localize = useLocalize();
  const { conversationId } = useParams();
  const [message, setMessage] = useState('');

  const busy = stream.state === 'starting' || stream.state === 'running';

  const submit = () => {
    const trimmed = message.trim();
    if (!trimmed || busy) {
      return;
    }
    void stream.run(trimmed, conversationId ?? 'standalone');
  };

  return (
    <div className="flex h-full flex-col gap-2">
      <textarea
        value={message}
        rows={3}
        placeholder={localize('com_atk_agent_placeholder')}
        className="w-full resize-none rounded-md border border-border-medium bg-surface-primary p-2 text-sm text-text-primary outline-none focus:border-border-heavy"
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-md bg-surface-submit px-3 py-1 text-sm text-white hover:bg-surface-submit-hover disabled:opacity-50"
          onClick={submit}
          disabled={busy || message.trim() === ''}
        >
          {busy ? localize('com_atk_running') : localize('com_atk_run_agent')}
        </button>
        {busy && (
          <button
            type="button"
            className="rounded-md bg-surface-destructive px-3 py-1 text-sm text-white hover:bg-surface-destructive-hover"
            onClick={() => void stream.cancel()}
          >
            {localize('com_atk_cancel')}
          </button>
        )}
        {stream.state !== 'idle' && !busy && (
          <button
            type="button"
            className="rounded-md border border-border-medium px-3 py-1 text-sm text-text-secondary hover:bg-surface-hover"
            onClick={stream.reset}
          >
            {localize('com_atk_clear')}
          </button>
        )}
      </div>

      {stream.errorMessage != null && (
        <div className="rounded-md border border-border-destructive px-2 py-1 text-xs text-text-destructive">
          {stream.errorMessage}
        </div>
      )}

      {(stream.responseText || stream.finalResponse) && (
        <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border border-border-light bg-surface-primary p-2 text-sm text-text-primary">
          {stream.finalResponse ?? stream.responseText}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <TraceViewer
          events={stream.events}
          totalCostUsd={stream.totalCostUsd}
          totalTokens={stream.totalTokens}
        />
      </div>
    </div>
  );
}
