import React, { memo, useMemo, useRef, useEffect } from 'react';
import { useRecoilValue } from 'recoil';
import { useToastContext } from '@librechat/client';
import { PermissionTypes, Permissions, apiBaseUrl } from 'librechat-data-provider';
import Mermaid, { MermaidErrorBoundary } from '~/components/Messages/Content/Mermaid';
import CodeBlock from '~/components/Messages/Content/CodeBlock';
import useHasAccess from '~/hooks/Roles/useHasAccess';
import { useFileDownload } from '~/data-provider';
import { useCodeBlockContext, useMessageContext } from '~/Providers';
import { handleDoubleClick, triggerDownload } from '~/utils';
import { useLocalize } from '~/hooks';
import store from '~/store';

type TCodeProps = {
  inline?: boolean;
  className?: string;
  children: React.ReactNode;
};

const isSingleLineCode = (children: React.ReactNode): boolean => {
  if (typeof children === 'string') {
    return !children.includes('\n');
  }
  if (Array.isArray(children)) {
    return children.every((child) => typeof child === 'string' && !child.includes('\n'));
  }
  return false;
};

export const code: React.ElementType = memo(function MarkdownCode({
  className,
  children,
}: TCodeProps) {
  const canRunCode = useHasAccess({
    permissionType: PermissionTypes.RUN_CODE,
    permission: Permissions.USE,
  });
  const match = /language-(\w+)/.exec(className ?? '');
  const lang = match && match[1];
  const isMath = lang === 'math';
  const isMermaid = lang === 'mermaid';
  const isSingleLine = isSingleLineCode(children);

  const { getNextIndex, resetCounter } = useCodeBlockContext();
  const blockIndex = useRef(getNextIndex(isMath || isMermaid || isSingleLine)).current;

  useEffect(() => {
    resetCounter();
  }, [children, resetCounter]);

  if (isMath) {
    return <>{children}</>;
  } else if (isMermaid) {
    const content = typeof children === 'string' ? children : String(children);
    return (
      <MermaidErrorBoundary code={content}>
        <Mermaid id={`mermaid-${blockIndex}`}>{content}</Mermaid>
      </MermaidErrorBoundary>
    );
  } else if (isSingleLine) {
    return (
      <code onDoubleClick={handleDoubleClick} className={className}>
        {children}
      </code>
    );
  } else {
    return (
      <CodeBlock
        lang={lang ?? 'text'}
        codeChildren={children}
        blockIndex={blockIndex}
        allowExecution={canRunCode}
      />
    );
  }
});
code.displayName = 'MarkdownCode';

export const codeNoExecution: React.ElementType = memo(function MarkdownCodeNoExecution({
  className,
  children,
}: TCodeProps) {
  const match = /language-(\w+)/.exec(className ?? '');
  const lang = match && match[1];

  if (lang === 'math') {
    return children;
  } else if (lang === 'mermaid') {
    const content = typeof children === 'string' ? children : String(children);
    return <Mermaid>{content}</Mermaid>;
  } else if (isSingleLineCode(children)) {
    return (
      <code onDoubleClick={handleDoubleClick} className={className}>
        {children}
      </code>
    );
  } else {
    return <CodeBlock lang={lang ?? 'text'} codeChildren={children} allowExecution={false} />;
  }
});
codeNoExecution.displayName = 'MarkdownCodeNoExecution';

type TAnchorProps = {
  href: string;
  children: React.ReactNode;
};

export const a: React.ElementType = memo(function MarkdownAnchor({ href, children }: TAnchorProps) {
  const user = useRecoilValue(store.user);
  const { showToast } = useToastContext();
  const localize = useLocalize();

  const {
    file_id = '',
    filename = '',
    filepath,
  } = useMemo(() => {
    const pattern = new RegExp(`(?:files|outputs)/${user?.id}/([^\\s]+)`);
    const match = href.match(pattern);
    if (match && match[0]) {
      const path = match[0];
      const parts = path.split('/');
      const name = parts.pop();
      const file_id = parts.pop();
      return { file_id, filename: name, filepath: path };
    }
    return { file_id: '', filename: '', filepath: '' };
  }, [user?.id, href]);

  const { refetch: downloadFile } = useFileDownload(user?.id ?? '', file_id, { direct: false });
  const props: { target?: string; onClick?: React.MouseEventHandler } = { target: '_blank' };

  if (!file_id || !filename) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  }

  const handleDownload = async (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    try {
      const stream = await downloadFile();
      if (stream.data == null || stream.data === '') {
        console.error('Error downloading file: No data found');
        showToast({
          status: 'error',
          message: localize('com_ui_download_error'),
        });
        return;
      }
      triggerDownload(stream.data, filename);
    } catch (error) {
      console.error('Error downloading file:', error);
    }
  };

  props.onClick = handleDownload;
  props.target = '_blank';

  const domainServerBaseUrl = `${apiBaseUrl()}/api`;

  return (
    <a
      href={
        filepath?.startsWith('files/')
          ? `${domainServerBaseUrl}/${filepath}`
          : `${domainServerBaseUrl}/files/${filepath}`
      }
      {...props}
    >
      {children}
    </a>
  );
});
a.displayName = 'MarkdownAnchor';

type TParagraphProps = {
  children: React.ReactNode;
};

/** Find candidate text nodes inside an element, in document order. */
function collectTextNodes(root: HTMLElement): Text[] {
  const out: Text[] = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      // Skip text already inside an existing annotation, a code block, or a link.
      let el: HTMLElement | null = n.parentElement;
      while (el && el !== root) {
        const tag = el.tagName;
        if (
          tag === 'MARK' ||
          tag === 'PRE' ||
          tag === 'CODE' ||
          tag === 'A' ||
          el.classList?.contains('hljs')
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        el = el.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let n = w.nextNode();
  while (n) {
    out.push(n as Text);
    n = w.nextNode();
  }
  return out;
}

/** Wrap the first occurrence of `needle` inside `nodes` (a sequence of text
 *  nodes from `collectTextNodes`) in a <mark> with the given attributes.
 *  Returns true if a wrap happened. The match must lie within one text node;
 *  cross-node matches are skipped (rare for short highlight strings). */
function wrapFirstMatch(nodes: Text[], needle: string, attrs: Record<string, string>): boolean {
  if (!needle) {
    return false;
  }
  for (const node of nodes) {
    const text = node.data;
    const idx = text.indexOf(needle);
    if (idx < 0) {
      continue;
    }
    const before = text.slice(0, idx);
    const match = text.slice(idx, idx + needle.length);
    const after = text.slice(idx + needle.length);
    const parent = node.parentNode;
    if (!parent) {
      return false;
    }
    const beforeNode = before ? document.createTextNode(before) : null;
    const mark = document.createElement('mark');
    for (const [k, v] of Object.entries(attrs)) {
      mark.setAttribute(k, v);
    }
    mark.textContent = match;
    const afterNode = after ? document.createTextNode(after) : null;
    if (beforeNode) {
      parent.insertBefore(beforeNode, node);
    }
    parent.insertBefore(mark, node);
    if (afterNode) {
      parent.insertBefore(afterNode, node);
    }
    parent.removeChild(node);
    return true;
  }
  return false;
}

export const p: React.ElementType = memo(function MarkdownParagraph({ children }: TParagraphProps) {
  const ref = useRef<HTMLParagraphElement | null>(null);
  const { messageId } = useMessageContext();
  const byMessage = useRecoilValue(store.annotationsByMessageId);
  const scrollTarget = useRecoilValue(store.annotationScrollTarget);
  const annotations = (messageId && byMessage[messageId]) || [];

  // Re-apply highlights whenever the paragraph (re-)renders or the annotation
  // list changes for this message. We wipe & re-wrap to stay idempotent —
  // unwrap any prior <mark> we added, then re-inject based on current state.
  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    // Unwrap our previous marks so re-rendered content doesn't accumulate.
    el.querySelectorAll('mark.atk-annotation').forEach((m) => {
      const parent = m.parentNode;
      if (!parent) {
        return;
      }
      while (m.firstChild) {
        parent.insertBefore(m.firstChild, m);
      }
      parent.removeChild(m);
    });
    if (!annotations.length) {
      return;
    }
    for (const a of annotations) {
      // Prefer context-anchored match; fall back to bare text on failure.
      const anchored = `${a.contextBefore}${a.highlightedText}${a.contextAfter}`;
      const nodes = collectTextNodes(el);
      let wrapped = false;
      if (anchored !== a.highlightedText) {
        // Try anchored first by wrapping only the highlightedText slice.
        for (const node of nodes) {
          const text = node.data;
          const idx = text.indexOf(anchored);
          if (idx < 0) {
            continue;
          }
          const matchStart = idx + a.contextBefore.length;
          const before = text.slice(0, matchStart);
          const match = text.slice(matchStart, matchStart + a.highlightedText.length);
          const after = text.slice(matchStart + a.highlightedText.length);
          const parent = node.parentNode;
          if (!parent) {
            break;
          }
          if (before) {
            parent.insertBefore(document.createTextNode(before), node);
          }
          const mark = document.createElement('mark');
          mark.className = 'atk-annotation';
          mark.setAttribute('data-annotation-id', a._id);
          if (a.note) {
            mark.title = a.note;
          }
          mark.textContent = match;
          parent.insertBefore(mark, node);
          if (after) {
            parent.insertBefore(document.createTextNode(after), node);
          }
          parent.removeChild(node);
          wrapped = true;
          break;
        }
      }
      if (!wrapped) {
        wrapFirstMatch(collectTextNodes(el), a.highlightedText, {
          class: 'atk-annotation',
          'data-annotation-id': a._id,
          ...(a.note ? { title: a.note } : {}),
        });
      }
    }
  }, [annotations, children]);

  // Pulse the scroll target after navigation.
  useEffect(() => {
    if (!scrollTarget || !ref.current) {
      return;
    }
    const match = ref.current.querySelector(
      `mark.atk-annotation[data-annotation-id="${scrollTarget}"]`,
    );
    if (match) {
      match.classList.add('pulse');
      const timer = setTimeout(() => match.classList.remove('pulse'), 2000);
      return () => clearTimeout(timer);
    }
  }, [scrollTarget, annotations]);

  return (
    <p ref={ref} className="mb-2 whitespace-pre-wrap">
      {children}
    </p>
  );
});
p.displayName = 'MarkdownParagraph';

type TTableProps = {
  children: React.ReactNode;
};

export const table: React.ElementType = memo(function MarkdownTable({ children }: TTableProps) {
  return (
    <div className="markdown-table-wrapper w-full max-w-full">
      <table>{children}</table>
    </div>
  );
});
table.displayName = 'MarkdownTable';

type TImageProps = {
  src?: string;
  alt?: string;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
};

export const img: React.ElementType = memo(function MarkdownImage({
  src,
  alt,
  title,
  className,
  style,
}: TImageProps) {
  // Get the base URL from the API endpoints
  const baseURL = apiBaseUrl();

  // If src starts with /images/, prepend the base URL
  const fixedSrc = useMemo(() => {
    if (!src) return src;

    // If it's already an absolute URL or doesn't start with /images/, return as is
    if (src.startsWith('http') || src.startsWith('data:') || !src.startsWith('/images/')) {
      return src;
    }

    // Prepend base URL to the image path
    return `${baseURL}${src}`;
  }, [src, baseURL]);

  return <img src={fixedSrc} alt={alt} title={title} className={className} style={style} />;
});
img.displayName = 'MarkdownImage';
