// Vendored code (Hermes runtime fork) is pinned third-party source — linting or
// reformatting it would break the upstream pin, so it's filtered out here.
const VENDORED = /(^|[/\\])services[/\\]hermes-runtime[/\\]/;

const filterVendored = (files) => files.filter((file) => !VENDORED.test(file));

module.exports = {
  '*.{js,jsx,ts,tsx}': (files) => {
    const own = filterVendored(files);
    if (own.length === 0) {
      return [];
    }
    const list = own.map((f) => `"${f}"`).join(' ');
    return [
      `node scripts/sort-imports.mts ${list}`,
      `prettier --write ${list}`,
      `eslint --fix ${list}`,
      `eslint ${list}`,
    ];
  },
  '*.json': (files) => {
    const own = filterVendored(files);
    return own.length === 0 ? [] : [`prettier --write ${own.map((f) => `"${f}"`).join(' ')}`];
  },
};
