# Motown AI desktop

Motown AI for laptops: the same Motown AI students use on motownai.com, as an app they install
on Windows or macOS. Every study pack they own, including ones they make, is kept on their
computer, so it opens and works without internet. There's no "download for offline" button;
packs save themselves.

## Download

Students download it from **[motownai.com/download](https://www.motownai.com/download)**, which
always hands out the newest published release. The files are also on **[Releases](../../releases)**:

- **Windows:** the `.exe` file (or the `.msi`)
- **macOS:** the `.dmg` file

Until the installers are code-signed (see "Signing the installers" below), Windows shows a
SmartScreen warning the first time: click **More info**, then **Run anyway**.

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
  (`bundle/static`), used when a file isn't saved yet and the app is offline. Online, a file
  not saved yet comes from motownai.com (the bundled copy is matched by path, so for a new
  `?v=` it would be stale), and saved files are re-checked in the background every 5 minutes,
  so an edit to an unversioned file shows up by the next load. On a computer that has never
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

Run it before a release when the website's CSS/JS has changed a lot. It only matters for
computers that open the app offline before it has saved those files: while online, the app gets
them from motownai.com by itself.

## Build installers

```bash
npm run build          # installers in target/release/bundle/
```

GitHub Actions builds the Windows installer (`.exe` and `.msi`) and the macOS `.dmg`. Every
merge to `main` updates a draft release named after the version in `src-tauri/tauri.conf.json`;
publish it from the Releases page to share the download link. Bump the version for a new
release. Pull requests keep their installers as build artifacts on the Actions run.

The installers carry the Motown AI name, logo and colours, and show a page with links to the
Privacy Policy and Terms (`src-tauri/installer/terms.txt`) before installing. To redraw the
installer pictures after a logo change:

```bash
python3 scripts/make-installer-art.py ../knowly ../motownai-mobile   # needs Pillow
```

## Signing the installers

Windows SmartScreen and macOS Gatekeeper decide whether to warn by checking who signed the
installer. The publisher name in the installer isn't enough on its own: the files have to be
signed with a certificate issued to Motown AI. The build signs them as soon as these secrets
are added under the repo's **Settings → Secrets and variables → Actions**; until then it builds
unsigned installers and says so in a warning.

**Windows**, one of:

- *Azure Trusted Signing* (cheapest, about $10 a month, verifies the business or person):
  `AZURE_SIGNING_ENDPOINT` (e.g. `https://eus.codesigning.azure.net`), `AZURE_SIGNING_ACCOUNT`,
  `AZURE_SIGNING_PROFILE`, plus an app registration allowed to sign: `AZURE_CLIENT_ID`,
  `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`.
- *A code-signing certificate* (OV or EV) from a certificate authority, exported as `.pfx`:
  `WINDOWS_CERTIFICATE` (the `.pfx` file, base64-encoded) and `WINDOWS_CERTIFICATE_PASSWORD`.
  Certificates issued since 2023 come on a hardware token or cloud HSM; ask the authority for
  one you can export, or use their cloud signing service.

Signed installers stop the "unknown publisher" message straight away. SmartScreen may still
show its warning for a short while until enough people have installed the signed app.

**macOS** (needs an Apple Developer account, $99 a year): `APPLE_CERTIFICATE` (the
"Developer ID Application" certificate as a base64 `.p12`), `APPLE_CERTIFICATE_PASSWORD`,
`APPLE_SIGNING_IDENTITY` (e.g. `Developer ID Application: Motown AI (TEAMID)`), and for
notarization `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password) and `APPLE_TEAM_ID`.


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
