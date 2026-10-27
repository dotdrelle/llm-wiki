import { escapeHtml } from './html.ts';

/*
 * What rendered Markdown may carry into a page.
 *
 * `marked` passes raw HTML and any link scheme through untouched, and what it
 * renders here is not ours: ingested e-mails and Confluence pages, converted
 * documents, model-written fiches and answers. Rendered on serve's origin, a
 * single `<img onerror>` in a pending e-mail ran with the reader's session.
 *
 * Three rules, shared by the wiki pages (server), the curation proposals
 * (server) and every Markdown bubble of the chat (browser, below):
 * - raw HTML is shown as text; `<br>` is the one element kept (table cells use
 *   it) and HTML comments are dropped (the index overview markers);
 * - a link is relative to the page, or an explicit http/https/mailto URL;
 * - an image is relative only: an external one is a tracking pixel.
 *
 * URLs are decided by the WHATWG parser, not a pattern: `//host`, `\\host`,
 * `/\host` leave the page's origin without naming a scheme and are refused,
 * and `java\tscript:` never reads as an allowed scheme.
 */

const LOCAL_BASE = 'http://local.invalid/';
const LOCAL_ORIGIN = 'http://local.invalid';
const EXTERNAL_SCHEMES = new Set(['http', 'https', 'mailto']);

export function safeHref(raw: string | null | undefined, { allowExternal = true } = {}): string | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value, LOCAL_BASE);
  } catch {
    return null;
  }
  if (url.origin === LOCAL_ORIGIN) return value;
  if (!allowExternal) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)?.[1]?.toLowerCase();
  return scheme && EXTERNAL_SCHEMES.has(scheme) ? value : null;
}

export function safeImageSrc(raw: string | null | undefined): string | null {
  return safeHref(raw, { allowExternal: false });
}

/** A raw HTML token of rendered Markdown, made inert. */
export function rawHtmlAsText(html: string): string {
  return String(html ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/(<br\s*\/?>)/gi)
    .map((part) => (/^<br\s*\/?>$/i.test(part) ? '<br>' : escapeHtml(part)))
    .join('');
}

/*
 * The same three rules for the chat page, which renders with the browser copy
 * of `marked` (`/assets/marked.min.js`). Plain browser JavaScript: it defines
 * `safeHref`, `safeImageSrc` and `rawHtmlAsText`, and installs them on `marked`
 * once. Keep it in step with the functions above —
 * tests/safe-markdown.test.ts runs both against the same cases.
 */
export const SAFE_MARKDOWN_SCRIPT = `
const SAFE_MD_BASE='${LOCAL_BASE}';
const SAFE_MD_ORIGIN='${LOCAL_ORIGIN}';
function safeHref(raw,options){
  const allowExternal=!options||options.allowExternal!==false;
  const value=String(raw==null?'':raw).trim();
  if(!value) return null;
  let url;
  try { url=new URL(value,SAFE_MD_BASE); } catch { return null; }
  if(url.origin===SAFE_MD_ORIGIN) return value;
  if(!allowExternal) return null;
  const match=/^([a-z][a-z0-9+.-]*):/i.exec(value);
  const scheme=match?match[1].toLowerCase():'';
  return scheme==='http'||scheme==='https'||scheme==='mailto'?value:null;
}
function safeImageSrc(raw){ return safeHref(raw,{allowExternal:false}); }
function safeMdEscape(value){
  return String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function rawHtmlAsText(html){
  return String(html==null?'':html)
    .replace(/<!--[\\s\\S]*?-->/g,'')
    .split(/(<br\\s*\\/?>)/gi)
    .map(part=>/^<br\\s*\\/?>$/i.test(part)?'<br>':safeMdEscape(part))
    .join('');
}
if(typeof marked!=='undefined'&&marked.use){
  marked.use({renderer:{
    html(token){ return rawHtmlAsText(token.text); },
    link(token){ return safeHref(token.href)?false:this.parser.parseInline(token.tokens); },
    image(token){ return safeImageSrc(token.href)?false:safeMdEscape(token.text); },
  }});
}
`;
