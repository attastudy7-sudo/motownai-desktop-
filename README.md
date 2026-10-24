# Motown AI desktop

Motown AI for laptops: the same Motown AI students use on motownai.com, as an app they install
on Windows or macOS. Every study pack they own, including ones they make, is kept on their
computer, so it opens and works without internet. There's no "download for offline" button;
packs save themselves.

## Download

Go to **[Releases](../../releases)** and download the installer from the newest release:

- **Windows:** the `.exe` file (or the `.msi`)
- **macOS:** the `.dmg` file

The installers aren't code-signed yet, so Windows shows a SmartScreen warning the first time:
click **More info**, then **Run anyway**.

## What students need to know

- Sign in once with internet. After that the app opens without internet, with every pack ready.
- Anything done offline (answers, finished sections, notes) syncs when the internet comes back.
- Making new packs, chat replies, Discover and payments still need internet, because the AI and
  the accounts live on motownai.com.

The rest of this page is for developers.

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
- **Ships with the site's files.** The installer carries the web app's CSS, JS, fonts and images
  (`bundle/static`), so screens draw straight from the install. On a computer that has never
  been online, the app opens on a welcome screen that asks to connect once to sign in, then
  moves on by itself when the connection appears.
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

## Updating the bundled site files

```bash
scripts/update-static.sh ../knowly     # copies knowly/app/static into bundle/static
```

Run it before a release when the website's CSS/JS has changed a lot. It only matters for fresh
installs: while online, the app refreshes these files from motownai.com by itself.

## Build installers

```bash
npm run build          # installers in target/release/bundle/
```

GitHub Actions builds the Windows installer (`.exe` and `.msi`) and the macOS `.dmg`. Every
merge to `main` updates a draft release named after the version in `src-tauri/tauri.conf.json`;
publish it from the Releases page to share the download link (motownai.com/download always
hands out the newest published one). A published release is never rebuilt, so bump the version
(in `tauri.conf.json`, both `Cargo.toml`s and `package.json`) before merging changes meant for a
new release. Pull requests keep their installers as build artifacts on the Actions run.


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
