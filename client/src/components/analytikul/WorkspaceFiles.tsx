import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Folder, RefreshCw } from 'lucide-react';
import { useAuthContext } from '~/hooks';
import { cn } from '~/utils';

interface TreeEntry {
  path: string;
  type: 'dir' | 'file';
}

/**
 * Analytikul Coder cockpit — a live browser for the agent's project workspace.
 * Lists project folders under the host workspace root, renders the file tree, and
 * shows file contents. Refresh to see files the agent just created. Read-only.
 */
export default function WorkspaceFiles() {
  const { token } = useAuthContext();
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState('');
  const [entries, setEntries] = useState<TreeEntry[]>([]);
  const [loadingTree, setLoadingTree] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string>('');
  const [fileError, setFileError] = useState<string | null>(null);

  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  // Load the list of projects once.
  useEffect(() => {
    fetch('/api/analytikul/agent/workspaces', { headers: authHeaders })
      .then((r) => (r.ok ? r.json() : { projects: [] }))
      .then((d: { projects?: string[] }) => {
        const list = Array.isArray(d.projects) ? d.projects : [];
        setProjects(list);
        setProject((cur) => cur || list[0] || 'default');
      })
      .catch(() => undefined);
  }, [authHeaders]);

  const loadTree = useCallback(() => {
    if (!project) {
      return;
    }
    setLoadingTree(true);
    fetch(`/api/analytikul/agent/workspace/tree?project=${encodeURIComponent(project)}`, {
      headers: authHeaders,
    })
      .then((r) => (r.ok ? r.json() : { entries: [] }))
      .then((d: { entries?: TreeEntry[] }) => setEntries(Array.isArray(d.entries) ? d.entries : []))
      .catch(() => setEntries([]))
      .finally(() => setLoadingTree(false));
  }, [project, authHeaders]);

  useEffect(() => {
    loadTree();
    setSelected(null);
    setContent('');
    setFileError(null);
  }, [loadTree]);

  const openFile = useCallback(
    (path: string) => {
      setSelected(path);
      setFileError(null);
      setContent('');
      fetch(
        `/api/analytikul/agent/workspace/file?project=${encodeURIComponent(
          project,
        )}&path=${encodeURIComponent(path)}`,
        { headers: authHeaders },
      )
        .then(async (r) => {
          if (!r.ok) {
            const body = (await r.json().catch(() => null)) as { message?: string } | null;
            throw new Error(body?.message ?? `error ${r.status}`);
          }
          return r.json();
        })
        .then((d: { content?: string }) => setContent(d.content ?? ''))
        .catch((e: Error) => setFileError(e.message));
    },
    [project, authHeaders],
  );

  const depthOf = (p: string) => (p.match(/\//g)?.length ?? 0);
  const nameOf = (p: string) => p.split('/').pop() ?? p;

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-2">
        <select
          aria-label="Project"
          className="min-w-0 flex-1 rounded-md border border-border-light bg-surface-secondary px-2 py-1 text-xs text-text-primary focus:outline-none"
          value={project}
          onChange={(e) => setProject(e.target.value)}
        >
          {projects.length === 0 && <option value="default">default</option>}
          {projects.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button
          type="button"
          title="Refresh"
          aria-label="Refresh files"
          className="rounded-md border border-border-medium p-1.5 text-text-secondary hover:text-text-primary"
          onClick={loadTree}
        >
          <RefreshCw size={13} className={cn(loadingTree && 'animate-spin')} aria-hidden="true" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 gap-2">
        {/* File tree */}
        <div className="w-1/2 min-w-0 overflow-auto rounded-md border border-border-light bg-surface-primary p-1">
          {entries.length === 0 ? (
            <div className="p-2 text-[11px] text-text-tertiary">
              {loadingTree ? 'Loading…' : 'No files yet — run the agent to build something.'}
            </div>
          ) : (
            entries.map((e) => (
              <button
                key={e.path}
                type="button"
                onClick={() => e.type === 'file' && openFile(e.path)}
                className={cn(
                  'flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px]',
                  e.type === 'file'
                    ? 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                    : 'font-medium text-text-primary',
                  selected === e.path && 'bg-surface-hover text-text-primary',
                )}
                style={{ paddingLeft: `${4 + depthOf(e.path) * 12}px` }}
              >
                {e.type === 'dir' ? (
                  <Folder size={11} aria-hidden="true" />
                ) : (
                  <FileText size={11} aria-hidden="true" />
                )}
                <span className="truncate">{nameOf(e.path)}</span>
              </button>
            ))
          )}
        </div>

        {/* File viewer */}
        <div className="w-1/2 min-w-0 overflow-auto rounded-md border border-border-light bg-surface-primary">
          {selected == null ? (
            <div className="p-2 text-[11px] text-text-tertiary">Select a file to view.</div>
          ) : fileError ? (
            <div className="p-2 text-[11px] text-text-destructive">{fileError}</div>
          ) : (
            <>
              <div className="sticky top-0 border-b border-border-light bg-surface-secondary px-2 py-1 font-mono text-[10px] text-text-secondary">
                {selected}
              </div>
              <pre className="whitespace-pre-wrap p-2 font-mono text-[11px] leading-snug text-text-primary">
                {content}
              </pre>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
