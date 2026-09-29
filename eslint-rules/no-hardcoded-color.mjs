/**
 * Analytikul ESLint rule: forbid hardcoded color literals (hex, rgb()/rgba(),
 * hsl()/hsla(), and Tailwind palette utilities like `bg-red-500`) in Analytikul
 * client components. All colors must come from CSS variables defined in
 * style.analytikul.css / style.css — this permanently prevents the class of
 * dark-mode bugs Hermes Desktop ships with (hardcoded colors that don't adapt
 * when the theme toggles).
 */

const HEX = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;
const FUNC = /\b(?:rgb|rgba|hsl|hsla)\(\s*\d/;
// Tailwind palette utilities with numeric shades (bg-red-500, text-zinc-100, border-blue-50…)
const TW_PALETTE =
  /\b(?:bg|text|border|ring|fill|stroke|from|via|to|shadow|outline|decoration|divide|accent|caret)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;

function check(context, node, raw) {
  if (typeof raw !== 'string') {
    return;
  }
  for (const [pattern, kind] of [
    [HEX, 'hex color'],
    [FUNC, 'rgb()/hsl() color'],
    [TW_PALETTE, 'Tailwind palette utility'],
  ]) {
    if (pattern.test(raw)) {
      context.report({
        node,
        message: `Hardcoded ${kind} "${raw.match(pattern)[0]}" — use a CSS variable (var(--…)) or a semantic Tailwind token (e.g. bg-surface-primary, text-text-primary) instead.`,
      });
      return;
    }
  }
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow hardcoded color values; use theme CSS variables',
    },
    schema: [],
  },
  create(context) {
    return {
      Literal(node) {
        check(context, node, node.value);
      },
      TemplateElement(node) {
        check(context, node, node.value?.raw);
      },
      JSXText(node) {
        check(context, node, node.value);
      },
    };
  },
};

export default {
  rules: {
    'no-hardcoded-color': rule,
  },
};
