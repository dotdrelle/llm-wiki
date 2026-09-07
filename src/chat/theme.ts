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
// Both themes share one construction: a deep ground with two soft radial
// washes and a faint 48 px grid, and translucent panels (`--panel`,
// `--panel-soft`) that blur what sits behind them. Light is not an inversion
// of dark — it is frosted white over a cool grey-blue ground — but every
// component reads the same tokens, so nothing is themed twice.
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
const GLASS_LIGHT = `
  color-scheme: light;
  --bg: #e9eef5;
  --bg-image:
    radial-gradient(1100px 560px at 80% -12%, rgba(120, 190, 235, .34), transparent 62%),
    radial-gradient(760px 480px at 6% 108%, rgba(90, 150, 210, .22), transparent 62%),
    linear-gradient(rgba(20, 80, 130, .045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(20, 80, 130, .045) 1px, transparent 1px);
  --panel: rgba(255, 255, 255, .66);
  --panel-soft: rgba(255, 255, 255, .5);
  --panel-solid: #f7f9fc;
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
  --bg: #070b12;
  --bg-image:
    radial-gradient(1200px 600px at 78% -10%, rgba(40, 110, 170, .28), transparent 60%),
    radial-gradient(800px 500px at 8% 110%, rgba(20, 70, 120, .25), transparent 60%),
    linear-gradient(rgba(120, 190, 230, .035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(120, 190, 230, .035) 1px, transparent 1px);
  --panel: rgba(14, 22, 36, .62);
  --panel-soft: rgba(20, 32, 50, .55);
  --panel-solid: #0e1624;
  --text: #e6eef7;
  --muted: #8fa3b8;
  --border: rgba(120, 190, 230, .18);
  --line-hi: rgba(95, 208, 255, .45);
  --accent: #5fd0ff;
  --accent-soft: rgba(95, 208, 255, .14);
  --glow: 0 0 0 4px rgba(95, 208, 255, .12), 0 0 24px rgba(95, 208, 255, .12);
  --card-grad: linear-gradient(180deg, rgba(95, 208, 255, .07), rgba(14, 22, 36, 0));
  --ok: #3ddc97;
  --link: #7bd0e8;
  --shadow: 0 20px 50px rgba(0, 0, 0, .35);
  --glass-blur: 18px;`;

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
