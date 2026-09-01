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
`;

export const WIKI_CSS_VARS = `
${WIKI_FONT_FACES}
:root {
  color-scheme: light;
  --font-sans: ${WIKI_FONT_STACK};
  /* Alias, not a real serif: the wiki reader/graph opted into one shared UI
     font and this keeps their var(--font-serif) call sites untouched. */
  --font-serif: ${WIKI_FONT_STACK};
  --font-mono: ${WIKI_MONO_STACK};
  --bg: #f6f7f9;
  --panel: #ffffff;
  --panel-soft: #eef3f7;
  --text: #17202a;
  --muted: #657184;
  --border: #d8dee7;
  --accent: #176b87;
  --accent-soft: #e1f1f5;
  --ok: #1a8a5a;
  --link: #0f5f7a;
  --shadow: 0 10px 28px rgba(23, 32, 42, 0.08);
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --bg: #101418;
    --panel: #171d23;
    --panel-soft: #202a32;
    --text: #e7edf3;
    --muted: #a6b2bf;
    --border: #2e3842;
    --accent: #65b8cf;
    --accent-soft: #18303a;
    --ok: #2dd4a0;
    --link: #7bd0e8;
    --shadow: none;
  }
}
:root.theme-light {
  color-scheme: light; --bg:#f6f7f9; --panel:#fff; --panel-soft:#eef3f7;
  --text:#17202a; --muted:#657184; --border:#d8dee7; --accent:#176b87;
  --accent-soft:#e1f1f5; --ok:#1a8a5a; --link:#0f5f7a; --shadow:0 10px 28px rgba(23,32,42,.08);
}
:root.theme-dark {
  color-scheme: dark; --bg:#101418; --panel:#171d23; --panel-soft:#202a32;
  --text:#e7edf3; --muted:#a6b2bf; --border:#2e3842; --accent:#65b8cf;
  --accent-soft:#18303a; --ok:#2dd4a0; --link:#7bd0e8; --shadow:none;
}`;
