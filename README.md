# Motown AI desktop

Motown AI for laptops. The window shows the real web app (the same pages, styles and scripts as
motownai.com), and every study pack the student owns is saved on their computer, so it opens
and works offline. There is no "download for offline" button: packs save themselves in the
background, including new ones as soon as they're made.

## How it works

```
 app window ──▶ local server on 127.0.0.1 (core/) ──▶ www.motownai.com
                     │
                     └── motown.db (SQLite in the app's data folder)
```

- **Online**, each request from the window goes to motownai.com with the student's sign-in
  cookies (kept by the app, not the window). Every page, API reply and static file that comes
  back is saved.
- **Offline**, the saved copy is served instead. A slim strip at the top says
  "Offline · your saved packs still work".
- **Every pack, saved.** After sign-in, on start, every 10 minutes and after any change, the app
  asks the server which packs the student owns and which changed (`/api/packs/versions?all=1`)
  and saves each changed pack: its study room page, sections, checkpoints, flashcards, quiz,
  fill-ins, notes, final assessment, chat history and where the student is up to. Unchanged
  packs are saved again every 12 hours so progress and credits on the page stay current.
- **Progress made offline** (answers, finished sections, saved quizzes, notes) is queued and sent
  in order when the connection comes back. Things that need the server's answer (making packs,
  chat replies, Discover, payments) say "You're offline" instead.
- Libraries the site loads from CDNs (icons, maths rendering) are saved too, so pages keep
  their icons offline.
- Signing out deletes the student's saved data from the computer.

The window is [Tauri](https://tauri.app) (`src-tauri/`): about 10 MB, using the system's
WebView2 (Edge) on Windows. Links to other sites open in the normal browser.

## Develop

Needs Rust and Node 22.

```bash
npm install
npm run dev            # the app, against www.motownai.com
```

To work on the local server without the window, or against a local copy of the web app:

```bash
MOTOWN_UPSTREAM=http://127.0.0.1:5000 cargo run -p motown-core --bin motown-local
# open http://127.0.0.1:8787
```

`MOTOWN_UPSTREAM` also works with `npm run dev`. Tests: `cargo test --workspace`.

## Build installers

```bash
npm run build          # installers in target/release/bundle/
```

GitHub Actions builds the Windows installer (`.exe` and `.msi`) and the macOS `.dmg` on every
push. Pushing a tag like `v0.1.0` creates a draft GitHub release with them attached.

The installers aren't code-signed yet, so Windows SmartScreen will warn on first run
("More info" → "Run anyway") until a signing certificate is added.

## Known limits

- **Sign-up** shows a Cloudflare check that only works on motownai.com. New students sign up on
  the website, then sign in here.
- **Google sign-in** runs inside the window and comes back through the app. If Google refuses
  the embedded window, sign in with email and password instead (set one in Account settings).
- Podcast audio and YouTube videos stream and aren't saved offline.
- A page that was never opened and isn't part of a pack (pricing, a friend's profile) shows
  "This page isn't saved yet" offline.
- Progress made offline is sent on reconnect, but pages already saved show the old progress
  until they're saved again.
