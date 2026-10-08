// The whole `serve` UI — chat, wiki reader, graph, skills and help pages —
// renders in one sans-serif: Geist (Vercel, OFL), self-hosted as woff2 and
// served by `wiki serve` from `/assets/geist-latin-wght-*.woff2` (no CDN, works
// offline). It stands in for ChatGPT's proprietary "OpenAI Sans"; the stack
// names OpenAI Sans / Söhne first so a machine that has either uses it.
// Reverting or reskinning is a one-line change to `WIKI_FONT_STACK`.
export const WIKI_FONT_STACK =
  '"Geist Variable", Geist, "OpenAI Sans", "Söhne", Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

export const WIKI_MONO_STACK =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';

// Display serif — page titles, the workspace brand, the run name. Body text
// never uses it (Cormorant's x-height is too small for paragraphs); it is the
// one "editorial" voice of the glass look. Self-hosted like Geist, from
// `@fontsource/cormorant-garamond` (OFL), weight 600 only (~23 KB per face).
export const WIKI_DISPLAY_STACK =
  '"Cormorant Garamond", "Cormorant", Garamond, "EB Garamond", Georgia, "Times New Roman", serif';

// Self-hosted Geist, weight axis 100–900, latin subset (covers French).
// `font-display: swap` so first paint never blocks on the ~29 KB download;
// system-ui is the fallback while it loads. The unicode-range is copied
// verbatim from @fontsource-variable/geist's `wght.css` latin face — keep it
// in sync if the package is bumped.
const GEIST_LATIN_RANGE =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';

export const WIKI_FONT_FACES = `
@font-face{font-family:'Geist Variable';font-style:normal;font-display:swap;font-weight:100 900;src:url(/assets/geist-latin-wght-normal.woff2) format('woff2-variations');unicode-range:${GEIST_LATIN_RANGE}}
@font-face{font-family:'Geist Variable';font-style:italic;font-display:swap;font-weight:100 900;src:url(/assets/geist-latin-wght-italic.woff2) format('woff2-variations');unicode-range:${GEIST_LATIN_RANGE}}
@font-face{font-family:'Cormorant Garamond';font-style:normal;font-display:swap;font-weight:600;src:url(/assets/cormorant-garamond-latin-600-normal.woff2) format('woff2');unicode-range:${GEIST_LATIN_RANGE}}
@font-face{font-family:'Cormorant Garamond';font-style:italic;font-display:swap;font-weight:600;src:url(/assets/cormorant-garamond-latin-600-italic.woff2) format('woff2');unicode-range:${GEIST_LATIN_RANGE}}
`;

// ── Glass look ─────────────────────────────────────────────────────────────
// Light keeps its frosted surfaces over a cool grey-blue ground. Dark uses
// flat warm charcoal surfaces and restrained neutral borders. Components
// read the same tokens, so the chosen theme reaches every shared surface.
//
// Token roles, beyond the historical ones:
//   --glass-blur   backdrop blur radius; components opt in via
//                  `backdrop-filter: blur(var(--glass-blur))` (floating and
//                  fixed surfaces only — never a full-page reading surface).
//   --line-hi      the brighter border that marks the active/primary surface.
//   --glow         box-shadow halo for the primary control (composer, send).
//   --card-grad    top-lit gradient laid over cards so they catch the light.
//   --bg-image     ground washes + grid; body paints `var(--bg)` under it.
//   --font-display the serif above.
// Shared with the PWA manifest and the <meta name="theme-color"> tags
// (`appIdentity.ts`): the installed-app window chrome and splash background
// must match the CSS ground color exactly, in both themes — one constant
// each instead of the same hex repeated in CSS, JSON and HTML.
export const WIKI_BG_LIGHT = '#e9eef5';
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

const GLASS_LIGHT = `
  color-scheme: light;
  --bg: ${WIKI_BG_LIGHT};
  --bg-image:
    radial-gradient(1100px 560px at 80% -12%, rgba(120, 190, 235, .34), transparent 62%),
    radial-gradient(760px 480px at 6% 108%, rgba(90, 150, 210, .22), transparent 62%),
    linear-gradient(rgba(20, 80, 130, .045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(20, 80, 130, .045) 1px, transparent 1px);
  /* Frosted, not see-through: at .66/.5 the animated gradient behind these
     surfaces showed through every panel, popup and modal and made their text
     hard to read. The blur stays; the ground under it is now opaque enough to
     carry text. */
  --panel: rgba(255, 255, 255, .9);
  --panel-soft: rgba(255, 255, 255, .82);
  --panel-solid: #f7f9fc;
  --dock-bg: rgba(255, 255, 255, .92);
  --text: #12202e;
  --muted: #5b6d82;
  --border: rgba(20, 110, 160, .2);
  --line-hi: rgba(14, 127, 168, .5);
  --accent: #0e7fa8;
  --accent-soft: rgba(14, 127, 168, .12);
  --glow: 0 0 0 4px rgba(14, 127, 168, .1);
  --card-grad: linear-gradient(180deg, rgba(255, 255, 255, .55), rgba(255, 255, 255, 0));
  --ok: #157a52;
  --link: #0b6a8e;
  --shadow: 0 10px 28px rgba(18, 32, 46, .1);
  --glass-blur: 18px;`;

const GLASS_DARK = `
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
  --bg-size: auto, auto, 48px 48px, 48px 48px;
${GLASS_LIGHT}
}
@media (prefers-color-scheme: dark) {
  :root {${GLASS_DARK}
  }
}
:root.theme-light {${GLASS_LIGHT}
}
:root.theme-dark {${GLASS_DARK}
}
/* Frosted surfaces become opaque when the OS asks for less transparency;
   --panel-solid is themed above, so one rule covers light and dark. */
@media (prefers-reduced-transparency: reduce) {
  :root, :root.theme-light, :root.theme-dark {
    --glass-blur: 0px; --panel: var(--panel-solid); --panel-soft: var(--panel-solid);
  }
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
