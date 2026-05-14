export const WIKI_FONT_STACK =
  'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export const WIKI_MONO_STACK =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';

export const WIKI_CSS_VARS = `
:root {
  color-scheme: light;
  --bg: #f6f7f9;
  --panel: #ffffff;
  --panel-soft: #eef3f7;
  --text: #17202a;
  --muted: #657184;
  --border: #d8dee7;
  --accent: #176b87;
  --accent-soft: #e1f1f5;
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
    --link: #7bd0e8;
    --shadow: none;
  }
}`;
