import TurndownService from 'turndown';
import { marked } from 'marked';
import { gfm } from 'turndown-plugin-gfm';

/**
 * Open WebUI-parity markdown conversion. Turndown serializes with escaping
 * DISABLED (so em-dash, $, ., etc. stay literal) and parses back with marked.
 *
 * Paragraphs MUST be separated by a blank line (`\n\n`): marked runs with
 * `breaks: false` (standard markdown), where a single newline is a soft space —
 * so single-newline-separated paragraphs collapse into one on reload. Emitting
 * the standard double-newline keeps a hard Enter (a new <p>) holding across the
 * save → reload round-trip.
 */
const NBSP = String.fromCharCode(0xa0);

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

turndown.escape = (value: string): string => value;
turndown.use(gfm);

turndown.addRule('blankLineParagraphs', {
  filter: 'p',
  replacement: (content: string): string => `\n\n${content}\n\n`,
});

export function htmlToMarkdown(html: string): string {
  const markdown = turndown.turndown(html.replace(/<p><\/p>/g, '<br/>'));
  return markdown.split(NBSP).join(' ');
}

export function markdownToHtml(markdown: string): string {
  return marked.parse(markdown, { async: false, gfm: true, breaks: false });
}
