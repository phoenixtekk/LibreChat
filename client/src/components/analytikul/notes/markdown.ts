import TurndownService from 'turndown';
import { marked } from 'marked';
import { gfm } from 'turndown-plugin-gfm';

/**
 * Open WebUI-parity markdown conversion. OWUI's notes editor serializes via
 * Turndown with escaping DISABLED (so em-dash, $, ., etc. stay literal) and
 * single-newline paragraph spacing, and parses back with marked. Matching this
 * keeps text "holding" identically (same characters, same spacing) on round-trip.
 */
const NBSP = String.fromCharCode(0xa0);

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

turndown.escape = (value: string): string => value;
turndown.use(gfm);

turndown.addRule('singleNewlineParagraphs', {
  filter: 'p',
  replacement: (content: string): string => `\n${content}\n`,
});

export function htmlToMarkdown(html: string): string {
  const markdown = turndown.turndown(html.replace(/<p><\/p>/g, '<br/>'));
  return markdown.split(NBSP).join(' ');
}

export function markdownToHtml(markdown: string): string {
  return marked.parse(markdown, { async: false, gfm: true, breaks: false });
}
