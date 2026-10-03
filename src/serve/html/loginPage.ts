import { escapeHtml } from '../../utils/html.ts';

/*
 serve's TOTP login page — and the product's front door: what wikiLLM does,
 what opens after signing in, and a public status block. The manager runtime
 serves the same page for `wiki-manager login` (`llm-wiki-manager`
 `src/runtime/loginPage.js`); keep the two in step.

 The page is public, so the status block carries only what a visitor may know
 (`/login/status` of the runtime: version, start time, session lifetime,
 enrollment) plus whether the session service answers and whether this
 connection is encrypted. Never the workspace name, a run, an agent or a path.
 */

export type LoginAbout = {
  version?: string | null;
  startedAt?: number | null;
  sessionTtlHours?: number | null;
};

export type LoginPageOptions = {
  error?: string | null;
  tls?: boolean;
  /** null when the runtime did not answer `/login/status`. */
  about?: LoginAbout | null;
  reachable?: boolean;
  enrolled?: boolean | null;
};

function formatSince(startedAt: number | null | undefined): string | null {
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return null;
  return `${new Date(startedAt).toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}

function statusRows({ about = null, reachable = true, enrolled = null, tls = false }: LoginPageOptions): string {
  const since = formatSince(about?.startedAt);
  const ttl = about?.sessionTtlHours;
  const rows: Array<[string, string]> = [
    ['Session service', reachable ? '<span class="dot ok"></span>Online' : '<span class="dot bad"></span>Not answering'],
    ...(about?.version ? [['Version', escapeHtml(about.version)] as [string, string]] : []),
    ...(since ? [['Up since', escapeHtml(since)] as [string, string]] : []),
    ...(enrolled === null ? [] : [['Two-step login', enrolled ? 'Authenticator enrolled' : '<span class="dot warn"></span>Awaiting enrollment'] as [string, string]]),
    ...(typeof ttl === 'number' && Number.isFinite(ttl) ? [['Session', `${escapeHtml(String(ttl))} h, extended while in use`] as [string, string]] : []),
    ['Connection', tls ? '<span class="dot ok"></span>Encrypted (TLS)' : '<span class="dot warn"></span>Not encrypted — trusted network only'],
  ];
  return rows.map(([label, value]) => `<div class="row"><span>${label}</span><span>${value}</span></div>`).join('');
}

export function loginPageHtml(options: LoginPageOptions = {}): string {
  const { error = null } = options;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>wikiLLM — sign in</title>
<style>
  :root { color-scheme: light dark; --bg: #f4f5f7; --fg: #1c1f26; --muted: #6b7280; --card: #fff; --line: #d9dce3; --accent: #2563eb; --accent-soft: #e8efff; --ok: #16a34a; --warn: #d97706; --bad: #dc2626; }
  @media (prefers-color-scheme: dark) { :root { --bg: #12141a; --fg: #e7e9ee; --muted: #9aa1ad; --card: #1b1e26; --line: #333843; --accent-soft: #1e2a47; } }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: var(--bg); color: var(--fg); }
  .wrap { max-width: 1040px; margin: 0 auto; padding: 2rem 1rem 1.5rem; min-height: 100vh; display: flex; flex-direction: column; }
  .brand { display: flex; align-items: center; gap: .55rem; margin-bottom: 2rem; }
  .brand-mark { width: 2rem; height: 2rem; border-radius: 8px; background: var(--accent); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-weight: 800; }
  .brand-name { font-weight: 700; font-size: 1.05rem; }
  .brand-tag { color: var(--muted); font-size: .85rem; }
  .grid { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(300px, .85fr); gap: 2.2rem; align-items: start; align-content: start; flex: 1; }
  @media (max-width: 820px) { .grid { grid-template-columns: minmax(0, 1fr); gap: 1.5rem; } .side { order: -1; } .brand-tag { display: none; } h1 { font-size: 1.35rem; } }
  h1 { font-size: 1.65rem; line-height: 1.25; margin: 0 0 .7rem; letter-spacing: -.01em; }
  .lead { color: var(--muted); font-size: .98rem; line-height: 1.55; margin: 0 0 1.6rem; max-width: 36rem; }
  h3 { font-size: .74rem; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); margin: 0 0 .7rem; }
  .steps { list-style: none; margin: 0 0 1.6rem; padding: 0; display: grid; gap: .75rem; }
  .steps li { display: grid; grid-template-columns: 1.9rem 1fr; gap: .7rem; align-items: start; }
  .num { width: 1.9rem; height: 1.9rem; border-radius: 50%; background: var(--accent-soft); color: var(--accent); font-weight: 800; font-size: .85rem; display: inline-flex; align-items: center; justify-content: center; }
  .steps strong { display: block; font-size: .92rem; margin-bottom: .15rem; }
  .steps span { color: var(--muted); font-size: .85rem; line-height: 1.5; }
  .chips { display: flex; flex-wrap: wrap; gap: .45rem; margin: 0 0 1.4rem; padding: 0; list-style: none; }
  .chips li { border: 1px solid var(--line); background: var(--card); border-radius: 999px; padding: .28rem .7rem; font-size: .8rem; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 1.1rem 1.2rem; margin-bottom: .9rem; box-shadow: 0 1px 3px rgba(0,0,0,.05); }
  h2 { margin: 0 0 .5rem; font-size: 1rem; }
  p { margin: 0 0 .8rem; font-size: .85rem; line-height: 1.45; }
  .card p:last-child { margin-bottom: 0; }
  .hint { color: var(--muted); font-size: .78rem; }
  form { display: flex; gap: .5rem; }
  input[type="text"] { flex: 1; min-width: 0; font: inherit; font-size: 1.15rem; letter-spacing: .35em; text-align: center; padding: .55rem .4rem; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: inherit; }
  input[type="text"]:focus { outline: 2px solid var(--accent); outline-offset: 1px; border-color: var(--accent); }
  button { font: inherit; font-weight: 700; padding: .55rem 1rem; border: 0; border-radius: 8px; background: var(--accent); color: #fff; cursor: pointer; }
  button:hover { filter: brightness(.93); }
  button:disabled { opacity: .55; cursor: default; }
  .error { color: var(--bad); font-size: .8rem; margin-top: .6rem; }
  .status .row { display: flex; justify-content: space-between; gap: 1rem; font-size: .82rem; padding: .38rem 0; border-top: 1px solid var(--line); }
  .status .row:first-of-type { border-top: 0; }
  .status .row span:first-child { color: var(--muted); }
  .status .row span:last-child { text-align: right; }
  .dot { display: inline-block; width: .5rem; height: .5rem; border-radius: 50%; margin-right: .4rem; vertical-align: middle; }
  .dot.ok { background: var(--ok); } .dot.warn { background: var(--warn); } .dot.bad { background: var(--bad); }
  footer { color: var(--muted); font-size: .76rem; margin-top: 2rem; line-height: 1.5; }
  code { font-family: ui-monospace, monospace; font-size: .92em; }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand"><span class="brand-mark">W</span><span class="brand-name">wikiLLM</span><span class="brand-tag">· workspace knowledge engine</span></div>
  <div class="grid">
    <main>
      <h1>Your documents, turned into a sourced wiki and ready-to-share deliverables.</h1>
      <p class="lead">wikiLLM reads the sources of a project, files them into a wiki where every statement points back to its exact passage, and regenerates your deliverables from templates — with Donna, the assistant, orchestrating the work.</p>
      <h3>What it does</h3>
      <ol class="steps">
        <li><span class="num">1</span><div><strong>Ingest</strong><span>Confluence exports, PDFs and notes are split into one fiche per section, tagged, and grouped into concept families.</span></div></li>
        <li><span class="num">2</span><div><strong>Prove</strong><span>Each fiche cites the exact lines of the archived original; a build freezes the evidence it used, so an export can always be traced.</span></div></li>
        <li><span class="num">3</span><div><strong>Produce</strong><span>Templates and build context become deliverables, then exported and polished with their sources resolved.</span></div></li>
        <li><span class="num">4</span><div><strong>Orchestrate</strong><span>Ask Donna in chat or agent mode: she plans, delegates to the connected agents, and the jobs that change the workspace wait for your approval.</span></div></li>
      </ol>
      <h3>After signing in</h3>
      <ul class="chips">
        <li>Chat &amp; agent mode</li><li>Wiki browser &amp; graph</li><li>Execution graph</li><li>Plan · Files · Logs</li><li>Curation reviews</li><li>Help</li>
      </ul>
    </main>
    <aside class="side">
      <section class="card">
        <h2>Sign in</h2>
        <p>Enter the 6-digit code from your authenticator app.</p>
        <form id="login-form" autocomplete="off">
          <input id="code" name="code" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="000000" aria-label="Verification code" autofocus required>
          <button type="submit" id="submit">Verify</button>
        </form>
        <p class="error" id="error"${error ? '' : ' hidden'}>${escapeHtml(error ?? '')}</p>
      </section>
      <section class="card status" aria-label="Service status">
        <h2>Status</h2>
        ${statusRows(options)}
      </section>
      <p class="hint">One session covers the ShellUI and the served wiki, and expires after its lifetime without use. First login? Run <code>wiki-manager login</code> on the machine that hosts the manager — it opens the enrollment page with the QR code.</p>
    </aside>
  </div>
  <footer>Local-first, single-user: sources, wiki, deliverables and history stay in your workspace folders; only model calls leave this machine, to the provider you configured.</footer>
</div>
<script>
(function () {
  // Session handoff from the ShellUI's /openui: the token rides in the URL
  // fragment, which the browser never sends to the server. Exchange it for the
  // cookie here, then drop it from the address bar before anything else runs.
  var handoff = (/(?:^|[#&])t=([^&]+)/.exec(window.location.hash || '') || [])[1];
  if (handoff) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
    fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: decodeURIComponent(handoff) })
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (payload) {
        if (response.ok && payload.ok) window.location.assign('/');
      });
    }).catch(function () {
      // Fall through to the manual code form below.
    });
  }
  var form = document.getElementById('login-form');
  var input = document.getElementById('code');
  var submit = document.getElementById('submit');
  var error = document.getElementById('error');
  input.addEventListener('input', function () {
    input.value = input.value.replace(/\\D/g, '').slice(0, 6);
  });
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    var code = input.value.replace(/\\D/g, '');
    if (code.length !== 6) return;
    submit.disabled = true;
    error.hidden = true;
    try {
      var response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code })
      });
      var payload = await response.json().catch(function () { return {}; });
      if (response.ok && payload.ok) {
        window.location.assign('/');
      } else {
        error.textContent = payload.error || 'Verification failed.';
        error.hidden = false;
        input.value = '';
        input.focus();
      }
    } catch (err) {
      error.textContent = 'The login service is not answering.';
      error.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });
})();
</script>
</body>
</html>`;
}
