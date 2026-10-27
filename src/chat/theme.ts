// The whole `serve` UI — chat, wiki reader, graph, skills and help pages —
// renders in one sans-serif: Inter (Rasmus Andersson, OFL), self-hosted as
// woff2 and served by `wiki serve` from `/assets/inter-latin-wght-*.woff2` (no
// CDN, works offline). Reskinning is a one-line change to `WIKI_FONT_STACK`.
export const WIKI_FONT_STACK =
  '"Inter Variable", Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

export const WIKI_MONO_STACK =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';

// Titles (page titles, the workspace brand, the run name) use the same face as
// the body, heavier and tighter — the token stays so a display face can come
// back without touching its call sites.
export const WIKI_DISPLAY_STACK = WIKI_FONT_STACK;

// Self-hosted Inter, weight axis 100–900, latin subset (covers French).
// `font-display: swap` so first paint never blocks on the download; system-ui
// is the fallback while it loads. The unicode-range is copied verbatim from
// @fontsource-variable/inter's latin face — keep it in sync if the package is
// bumped.
const INTER_LATIN_RANGE =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';

export const WIKI_FONT_FACES = `
@font-face{font-family:'Inter Variable';font-style:normal;font-display:swap;font-weight:100 900;src:url(/assets/inter-latin-wght-normal.woff2) format('woff2-variations');unicode-range:${INTER_LATIN_RANGE}}
@font-face{font-family:'Inter Variable';font-style:italic;font-display:swap;font-weight:100 900;src:url(/assets/inter-latin-wght-italic.woff2) format('woff2-variations');unicode-range:${INTER_LATIN_RANGE}}
`;

// ── Paper look ─────────────────────────────────────────────────────────────
// Matte, flat surfaces. Light is warm paper: a cream ground, slightly darker
// panels, near-black ink and a near-black accent. Dark is warm charcoal with
// the mirrored off-white accent. Components read the same tokens, so the
// chosen theme reaches every shared surface.
//
// Token roles, beyond the historical ones:
//   --glass-blur   backdrop blur radius (0 in both themes — kept so the
//                  components that opt in need no change).
//   --line-hi      the brighter border that marks the active/primary surface.
//   --glow         box-shadow halo for the primary control (composer, send).
//   --card-grad    overlay laid on cards (flat in both themes).
//   --bg-image     ground decoration; body paints `var(--bg)` under it.
//   --font-display the title face above.
// Shared with the PWA manifest and the <meta name="theme-color"> tags
// (`appIdentity.ts`): the installed-app window chrome and splash background
// must match the CSS ground color exactly, in both themes — one constant
// each instead of the same hex repeated in CSS, JSON and HTML.
export const WIKI_LIGHT_COLORS = {
  bg: '#f4f1ea',
  panel: '#efebe3',
  soft: '#e8e4db',
  raised: '#fbfaf6',
  text: '#1c1b19',
  muted: '#86827a',
  border: 'rgba(28, 27, 25, .1)',
  borderStrong: 'rgba(28, 27, 25, .24)',
  accent: '#1c1b19',
  accentSoft: 'rgba(28, 27, 25, .07)',
  link: '#7a5634',
};
export const WIKI_BG_LIGHT = WIKI_LIGHT_COLORS.bg;
export const WIKI_DARK_COLORS = {
  bg: '#141414',
  panel: '#202020',
  soft: '#252525',
  raised: '#303030',
  text: '#e8e5df',
  muted: '#a6a39b',
  border: '#383838',
  borderStrong: '#585854',
  accent: '#d6d2c9',
  accentSoft: 'rgba(214, 210, 201, .1)',
  link: '#c7bbb0',
};
export const WIKI_BG_DARK = WIKI_DARK_COLORS.bg;

const PAPER_LIGHT = `
  color-scheme: light;
  --bg: ${WIKI_LIGHT_COLORS.bg};
  --bg-image: none;
  --panel: ${WIKI_LIGHT_COLORS.panel};
  --panel-soft: ${WIKI_LIGHT_COLORS.soft};
  --panel-solid: ${WIKI_LIGHT_COLORS.panel};
  --dock-bg: ${WIKI_LIGHT_COLORS.raised};
  --text: ${WIKI_LIGHT_COLORS.text};
  --muted: ${WIKI_LIGHT_COLORS.muted};
  --border: ${WIKI_LIGHT_COLORS.border};
  --line-hi: ${WIKI_LIGHT_COLORS.borderStrong};
  --accent: ${WIKI_LIGHT_COLORS.accent};
  --accent-soft: ${WIKI_LIGHT_COLORS.accentSoft};
  --glow: 0 0 0 3px rgba(28, 27, 25, .07);
  --card-grad: linear-gradient(transparent, transparent);
  --ok: #3f7a52;
  --link: ${WIKI_LIGHT_COLORS.link};
  --shadow: 0 1px 2px rgba(40, 34, 24, .05), 0 10px 28px rgba(40, 34, 24, .07);
  --glass-blur: 0px;`;

const PAPER_DARK = `
  color-scheme: dark;
  --bg: ${WIKI_BG_DARK};
  --bg-image: none;
  --panel: ${WIKI_DARK_COLORS.panel};
  --panel-soft: ${WIKI_DARK_COLORS.soft};
  --panel-solid: ${WIKI_DARK_COLORS.panel};
  --dock-bg: ${WIKI_DARK_COLORS.raised};
  --text: ${WIKI_DARK_COLORS.text};
  --muted: ${WIKI_DARK_COLORS.muted};
  --border: ${WIKI_DARK_COLORS.border};
  --line-hi: ${WIKI_DARK_COLORS.borderStrong};
  --accent: ${WIKI_DARK_COLORS.accent};
  --accent-soft: ${WIKI_DARK_COLORS.accentSoft};
  --glow: 0 0 0 3px rgba(214, 210, 201, .08);
  --card-grad: linear-gradient(transparent, transparent);
  --ok: #8ac49e;
  --link: ${WIKI_DARK_COLORS.link};
  --shadow: 0 12px 32px rgba(0, 0, 0, .25);
  --glass-blur: 0px;`;

export const WIKI_CSS_VARS = `
${WIKI_FONT_FACES}
:root {
  --font-sans: ${WIKI_FONT_STACK};
  /* Alias, not a real serif: the wiki reader/graph opted into one shared UI
     font and this keeps their var(--font-serif) call sites untouched. */
  --font-serif: ${WIKI_FONT_STACK};
  --font-mono: ${WIKI_MONO_STACK};
  --font-display: ${WIKI_DISPLAY_STACK};
  --bg-size: auto;
  /* Inter's contextual alternates, tabular-friendly digits off by default. */
  font-feature-settings: "cv11", "ss01";
${PAPER_LIGHT}
}
@media (prefers-color-scheme: dark) {
  :root {${PAPER_DARK}
  }
}
:root.theme-light {${PAPER_LIGHT}
}
:root.theme-dark {${PAPER_DARK}
}`;

/*
 * The scrollbar policy, shared by the chat shell and the wiki reader.
 *
 * A custom ::-webkit-scrollbar opts out of the native dark appearance, so an
 * uncoloured track falls back to the system control colour — a full-height
 * white bar in dark mode. The track must be explicitly transparent;
 * scrollbar-color gives Firefox the same themed pair (Chromium ignores it,
 * having the ::-webkit rules). Size is a var so the shell keeps its slimmer
 * 4px bars while the reader uses the 8px default.
 */
export const SCROLLBAR_CSS = `
::-webkit-scrollbar{width:var(--scrollbar-size,8px);height:var(--scrollbar-size,8px);background:transparent}
::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:var(--scrollbar-radius,4px)}
::-webkit-scrollbar-thumb:hover{background:var(--muted)}
html{scrollbar-color:var(--border) transparent;scrollbar-width:thin}`;
