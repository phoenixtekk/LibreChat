/** Analytikul skin/accent state — persisted to localStorage, applied as data attributes. */

export const SKINS = ['aurora', 'ember', 'verdant', 'slate'] as const;
export const ACCENTS = ['indigo', 'amber', 'emerald', 'rose', 'cyan', 'violet'] as const;

export type Skin = (typeof SKINS)[number];
export type Accent = (typeof ACCENTS)[number];

const SKIN_KEY = 'analytikul-skin';
const ACCENT_KEY = 'analytikul-accent';

export const DEFAULT_SKIN: Skin = 'aurora';
export const DEFAULT_ACCENT: Accent = 'indigo';

export function getSkin(): Skin {
  const stored = localStorage.getItem(SKIN_KEY) as Skin | null;
  return stored && (SKINS as readonly string[]).includes(stored) ? stored : DEFAULT_SKIN;
}

export function getAccent(): Accent {
  const stored = localStorage.getItem(ACCENT_KEY) as Accent | null;
  return stored && (ACCENTS as readonly string[]).includes(stored) ? stored : DEFAULT_ACCENT;
}

export function applySkin(skin: Skin) {
  document.documentElement.dataset.skin = skin;
  localStorage.setItem(SKIN_KEY, skin);
}

export function applyAccent(accent: Accent) {
  document.documentElement.dataset.accent = accent;
  localStorage.setItem(ACCENT_KEY, accent);
}

export function initTheme() {
  document.documentElement.dataset.skin = getSkin();
  document.documentElement.dataset.accent = getAccent();
}
