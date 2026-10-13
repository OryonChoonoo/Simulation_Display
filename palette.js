/* One source of truth for colour, shared by the stylesheet, the 2D canvases
   and the three WebGL scenes.

   The stylesheet owns the values. This module reads them back off the document
   with getComputedStyle, so a token can never be defined twice and drift: change
   it in style.css and the drawings follow. Switching theme re-reads them and
   tells everything that paints to paint again.

   Only the structural colours live here. The physics colours - magnets red,
   current green, the three phases - are deliberately fixed in both themes,
   because they mean something and that meaning should not depend on which
   background a visitor happens to be looking at. */

const TOKENS = [
  'bg', 'bg-2', 'panel', 'panel-2', 'line', 'line-strong',
  'text', 'muted', 'faint', 'accent', 'accent-soft', 'cyan',
  'magnet', 'current', 'warn', 'bad',
];

export const C = {};
const listeners = new Set();

/** Re-read every token from the document. */
export function refresh() {
  const style = getComputedStyle(document.documentElement);
  for (const token of TOKENS) {
    const value = style.getPropertyValue('--' + token).trim();
    if (value) C[token.replace('-', '')] = value;
  }
  // three.js wants numbers, not CSS strings.
  for (const token of Object.keys(C)) {
    if (typeof C[token] === 'string' && C[token].startsWith('#')) {
      C[token + 'Hex'] = parseInt(C[token].slice(1), 16);
    }
  }
  return C;
}

export function isDark() {
  return document.documentElement.dataset.theme === 'dark';
}

/** Run `fn` now and again whenever the theme changes. */
export function onTheme(fn) {
  listeners.add(fn);
  fn(C);
  return () => listeners.delete(fn);
}

/* The inline script in index.html owns the switch: it runs before the first
   paint and before this module exists, so the page can change theme whether or
   not the module graph ever loads. This module follows it. */
export function setTheme(name) {
  if (typeof window.toggleTheme === 'function'
      && document.documentElement.dataset.theme !== name) {
    window.toggleTheme();
  } else {
    document.documentElement.dataset.theme = name;
    announce();
  }
}

function announce() {
  refresh();
  for (const fn of listeners) {
    // One listener throwing must not stop the others repainting.
    try { fn(C); } catch (error) { console.error('theme listener failed', error); }
  }
}

window.addEventListener('themechange', announce);

refresh();
