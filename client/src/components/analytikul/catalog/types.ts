/** Feature Catalog — data model for the in-app discovery panel.
 *  Voice rules for entries (enforced by review, not types):
 *    - Title: verb-first where possible, ≤60 chars, no marketing fluff.
 *    - Summary: 1 sentence, ≤140 chars, says WHAT + WHY in user's terms.
 *    - Body: optional, only when a real "how-to" is needed.
 *    - Action: literal label, literal slash/path/panel — no fake targets.
 *    - State: honest. "soon" means we plan to ship; "gated" means it works
 *      but a flag/permission is in the way.
 */

export type CatalogCategory =
  | 'start'
  | 'intelligence'
  | 'tools'
  | 'memory'
  | 'cost'
  | 'automation'
  | 'channels'
  | 'workspace';

export type CatalogState = 'live' | 'beta' | 'gated' | 'soon';

export type CatalogAction =
  | { kind: 'slash'; command: string; label: string }
  | { kind: 'navigate'; path: string; label: string }
  | { kind: 'panel'; tab: 'agent' | 'preview' | 'costs' | 'memory' | 'keys' | 'files'; label: string }
  | { kind: 'composer'; text: string; label: string }
  | { kind: 'external'; href: string; label: string }
  | { kind: 'none' };

export type CatalogEntry = {
  id: string;
  title: string;
  category: CatalogCategory;
  summary: string;
  body?: string;
  tags: string[];
  state: CatalogState;
  action: CatalogAction;
  /** Pinned in the "What's new" section with this date + 1-line note. */
  whatsNew?: { date: string; note: string };
};

export type CategoryMeta = {
  id: CatalogCategory;
  label: string;
  blurb: string;
};
