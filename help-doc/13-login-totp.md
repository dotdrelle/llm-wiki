# Two-step login (TOTP)

The manager can require a **one-time code from your authenticator app** before
anyone enters the interactive surfaces — the ShellUI and `serve`. One login
covers **both**: the session is shared.

- Valid for a session: **12 hours of inactivity**, then you log in again
  (sliding — normal use keeps it alive).
- One session at a time: a new login replaces the previous one.
- `--headless`/CI runs and a standalone `serve` without the manager runtime
  are not affected.

## First login: enroll your authenticator

Enrollment happens on the machine that runs the manager:

1. Run `wiki-manager login`. It starts the runtime if needed and **opens the
   login page in your browser** (`http://localhost:7788/login`).
2. The page shows a **QR code** — scan it with your authenticator app
   (Google Authenticator, Aegis, 2FAS, 1Password…) — plus the base32 secret
   and the `otpauth://` URI, for manual entry.
3. Enter the 6-digit code shown by the app and click **Verify**. That first
   successful code enrolls the secret and opens the session.

If the shell was waiting on the login (it opens the page by itself at
startup), it picks the session up automatically and reports how long it is
valid.

## Then, every login

- **ShellUI** — starting the shell with an expired session prompts the same
  flow; or run `wiki-manager login` yourself. `wiki-manager logout` revokes
  the session.
- **serve** — `/openui` from the ShellUI opens the web UI with the ShellUI
  session already in place, so you type no second code. Opening serve another
  way without a session redirects to the `/login` page: enter the current
  code, you get the session cookie and land back on the app. The **logout**
  button (or `/api/logout`) drops the cookie and revokes the session.

The session is shared by **host**: the login page sets the cookie on the
manager's host and serve on that same host (any port) reuses it — one login for
the ShellUI and `/openui`, in the same browser. A different browser still asks
once; it then lasts the same 12 hours. `/openui` hands the token over through
the URL fragment (never sent to a server, so it stays out of logs) and serve
exchanges it for its cookie.

Codes are checked with a ±30 s tolerance (the current and the neighbouring
periods). Too many wrong attempts in a row are refused for a while.

## Troubleshooting

- **"Session check is blocked"** on serve: the runtime answered 401/403 to
  the session check. That endpoint is public, so this is a proxy or URL
  misconfiguration in front of the runtime — check `WIKI_MANAGER_RUNTIME_URL`
  and any reverse proxy in between. It is shown instead of a silent redirect
  loop.
- **Enrollment refused from another machine**: enrollment is local-only; run
  `wiki-manager login` on the host that runs the manager.

## Re-enrolling (lost authenticator, new phone…)

Run, on the machine that hosts the manager:

```
wiki-manager login --reset
```

It asks for confirmation, wipes the enrolled secret **and** revokes the
active session, then reopens the login page with a **fresh QR code** — enroll
the new authenticator exactly like the first login. The old authenticator's
codes stop working immediately.

Manual fallback: delete `totp.json` and `session.json` in the manager runtime
state directory (`.wiki/runtime/`), then `wiki-manager login` again.

The reset is deliberately **local only**: it is a host-side command, never a
web page — TOTP protects remote access, so re-enrollment must prove the
machine, not a browser.

## Where the pieces live

- The **TOTP secret** never leaves the manager runtime (`totp.json` in the
  manager state directory, mode 0600).
- The **session** lives next to it (`session.json`): the runtime is the
  single authority — `serve` validates every request against it, so a logout
  takes effect there too.
- Disabling: `WIKI_MANAGER_TOTP=off` on the manager. The session length:
  `WIKI_MANAGER_SESSION_TTL_HOURS` (default 12).

## What this does not protect

The service-to-service tokens (runtime bearer, MCP tokens) are unchanged:
TOTP is the **human** lock in front of the interactive surfaces, not a
replacement for those. An already-issued session token stays valid until it
expires even after a logout — the logout clears the browser cookie and the
shell session, the copy an attacker could hold expires with the TTL.
