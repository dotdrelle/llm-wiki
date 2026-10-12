# Talking to Donna from Tchap

The Tchap bridge lets you talk to Donna **from your phone**, in a Tchap forum,
while the workspace keeps running on your workstation. You ask questions, start
actions, approve them, and follow their progress — the same Donna as in the
chat, in a conversation of her own.

The bridge is **outbound only**: your workstation fetches the messages from
Tchap, nothing on the Internet ever connects to it. It works behind a VPN and a
corporate proxy, as long as the workstation can reach Tchap.

## What you need

- the connectors agent enabled on the workstation (`CONNECTORS_ENABLED=true`,
  the default set-up for Gmail);
- wikiLLM running on that workstation (the runtime and the agents);
- a Tchap account, and a **forum** you create for this purpose.

Nothing else is configured by hand. An administrator can forbid the bridge for
a whole deployment with `CONNECTORS_BRIDGE_ENABLED=false`; the Tchap tools then
disappear.

## Setting it up

1. **Create a forum** in Tchap, for example `Donna-demo` — one per workspace. Use a *forum*: Tchap encrypts every private room, and
   the bridge does not read encrypted rooms. Copy the forum's address
   (`#…:agent.<ministry>.tchap.gouv.fr`, in the forum's settings).
2. **In Donna's chat, agent mode**, on that workspace, ask: *"connect Tchap to
   the forum #Donna-demo:…"* — or just *"connect Tchap"*: Donna can list your
   forums and offer them by name.
3. **The first time only**, Donna shows a **link and a code**: open the link on
   your phone, sign in to Tchap as usual and confirm the code. That sign-in
   serves **every workspace** of the workstation; the next ones get their forum
   at once, without a code. The bridge then checks the forum and closes it: it
   is removed from the directory, and nobody who is not a member can read it.
4. **In the forum, type `/activate`.** Nothing is relayed before that — and
   only you, the owner, can do it.

From then on, what you write in the forum reaches Donna.

The same set-up is available without Donna: in the ShellUI,
`/connector auth tchap` lists your forums and `/connector auth tchap
#forum:server` attaches one; `/connector list` shows the state. In Serve, the
**Connectors** view shows a **Tchap** card once you are signed in — account,
this workspace's forum, its state, and buttons to attach, change or detach the
forum (each one is a request to Donna). Before the first sign-in there is no
card; a bridge stopped by an ended session keeps its card, with the error and
a button to sign in again.

## Using it

| You type | What happens |
| --- | --- |
| any text | a request to Donna, as in agent mode |
| `/chat <question>` | a read-only question |
| `/approve` | approve what is waiting |
| `/cancel` | stop the current run |
| `/status` | the workspace status |
| `/stop`, `/start` | pause and resume the bridge |
| `/who` | who may speak here |
| `/allow @user:server`, `/deny @user:server` | owner only: let a second person speak, or stop |
| `/help` | the list of commands |

Skills work as in the chat (`/wiki-ingest`, `/wiki-build`…). A run you start
gets one progress message that updates itself, then its outcome. An approval
requested by any surface of the workspace is announced in the forum too, so you
can approve it from your phone.

To add a second person: type `/allow @their.id:server` in the forum, **then**
invite them to the forum from Tchap. The order matters — the bridge removes
anyone who joins without being allowed.

## What protects the forum

A Tchap forum stays joinable by anyone who knows its address — Tchap refuses
to turn a forum into an invitation-only room. The bridge makes up for it:

- it only listens to the people allowed (you, and whoever you `/allow`);
- it **publishes nothing while someone else is in the forum**, bans them, then
  tells you who it removed;
- who may speak is changed **from the forum, by the owner only** — never from
  the chat, so a document read by Donna cannot add a listener;
- every action that changes the workspace still waits for your `/approve`.

Messages in a forum are **not end-to-end encrypted**. Your organisation's
network equipment may be able to read them. Do not write secrets there.

The bridge posts as **your own account**, from a separate device named
"wikiLLM Donna bridge" in your Tchap sessions. Removing that session from your
account stops the bridge at once.

## When the workstation is off

Nothing answers. Messages sent while the workstation was off are **not**
relayed when it comes back if they are older than 10 minutes — the bridge says
how many it dropped. Send them again if they still matter.

You sign in once. The bridge renews its Tchap access on its own; a new link and
code are only needed after you remove its session, after a long inactivity the
Tchap server does not tolerate, or if the agent's data was deleted.

## Stopping it

- `/stop` in the forum: a pause, `/start` resumes.
- *"disconnect Tchap"* in Donna's chat: this workspace's bridge stops and its
  forum is forgotten. The other workspaces keep theirs.
- *"sign out of Tchap"*: every bridge stops and the shared Tchap session is
  revoked. Each workspace keeps its forum; one new sign-in brings them all back.
- Remove the "wikiLLM Donna bridge" session from your Tchap account: immediate,
  for every workspace.

Each workspace has **its own forum** — a forum already used by one workspace is
refused to another — and its own allowed people, so what is said in one forum
never reaches another workspace.

## If something goes wrong

Ask Donna *"what is the state of the Tchap bridge?"* — she reads the bridge's
status: connected or not, which forum, awaiting `/activate`, active or paused,
a pending code, and the last error.

| Error | Meaning |
| --- | --- |
| `tchap_room_encrypted` | the room is encrypted: use a forum |
| `tchap_room_not_owned` | you do not administer that forum: create your own |
| `tchap_room_has_other_members` | the forum already has other members: use a new one |
| `tchap_room_used_by_workspace` | that forum already belongs to another workspace |
| `tchap_room_lost` | the bridge was removed from the forum, or the forum was deleted: attach another one |
| `workspace_missing` | the workspace was deleted: its bridge stays off, and its forum can be attached to another workspace |
| `tchap_reauthorization_required` | the Tchap session ended: connect again |
| `runtime_not_configured` | the agent cannot reach wikiLLM on the workstation — ask your administrator |
| `bridge_disabled` | the bridge is forbidden in this deployment |
