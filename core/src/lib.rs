//! The Motown AI desktop app's local server.
//!
//! The app window shows the real motownai.com web app (same HTML, CSS and JS), but it loads it
//! from this server on 127.0.0.1 instead of from the internet directly:
//!
//!   online   every request goes to motownai.com, and each page, API reply and static file that
//!            comes back is saved on this computer (`store`)
//!   offline  the saved copy is served instead; progress the student makes is queued and sent
//!            once they're back online (`server`, `sync`)
//!
//! In the background `sync` keeps every pack the student owns saved on this computer, whether
//! or not they've opened it here, so there's no "download for offline" button.

pub mod server;
pub mod store;
pub mod sync;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use reqwest_cookie_store::CookieStoreMutex;
use tokio::sync::Notify;
use url::Url;

pub use server::Started;

pub struct Config {
    /// Where the web app lives, e.g. https://www.motownai.com
    pub upstream: Url,
    /// The app's data folder: the database and the sign-in cookies go here.
    pub data_dir: PathBuf,
    /// The web app's static files shipped with the installer (`bundle/static`), so screens draw
    /// before the app has ever been online. None = fetch everything from the server.
    pub bundle_dir: Option<PathBuf>,
    /// Port to listen on; 0 picks a free one.
    pub port: u16,
    /// Shared secret the window must present (as a cookie) on every request, so other programs
    /// on this computer can't use the student's session through the local port. None = no check
    /// (the dev binary).
    pub secret: Option<String>,
}

impl Config {
    pub fn upstream_from_env() -> Url {
        let raw = std::env::var("MOTOWN_UPSTREAM").unwrap_or_else(|_| "https://www.motownai.com".into());
        Url::parse(raw.trim_end_matches('/')).expect("MOTOWN_UPSTREAM must be a URL")
    }
}

/// What the window's status strip shows.
#[derive(Default)]
pub struct Progress {
    pub total: AtomicI64,
    pub done: AtomicI64,
    pub running: AtomicBool,
}

pub struct App {
    pub upstream: Url,
    pub data_dir: PathBuf,
    pub store: store::Store,
    pub cookies: Arc<CookieStoreMutex>,
    /// For the window: never follows redirects, so the page sees them (sign-in, pack → video).
    pub http: reqwest::Client,
    /// For background work: follows redirects.
    pub http_follow: reqwest::Client,
    pub online: AtomicBool,
    /// Wakes the sync loop (signed in, back online, a pack was made).
    pub kick: Notify,
    pub saving: Progress,
    pub secret: Option<String>,
    pub bundle_dir: Option<PathBuf>,
}

impl App {
    pub fn new(cfg: &Config) -> anyhow::Result<Arc<Self>> {
        std::fs::create_dir_all(&cfg.data_dir)?;
        let store = store::Store::open(&cfg.data_dir.join("motown.db"))?;
        let cookies = Arc::new(CookieStoreMutex::new(load_cookies(&cfg.data_dir)));
        let ua = format!("MotownAI-Desktop/{} ({})", env!("CARGO_PKG_VERSION"), std::env::consts::OS);
        let build = |follow: bool| {
            reqwest::Client::builder()
                .cookie_provider(cookies.clone())
                .redirect(if follow { reqwest::redirect::Policy::limited(8) } else { reqwest::redirect::Policy::none() })
                .connect_timeout(Duration::from_secs(8))
                .user_agent(ua.clone())
                .build()
        };
        Ok(Arc::new(Self {
            upstream: cfg.upstream.clone(),
            data_dir: cfg.data_dir.clone(),
            store,
            http: build(false)?,
            http_follow: build(true)?,
            cookies,
            online: AtomicBool::new(true),
            kick: Notify::new(),
            saving: Progress::default(),
            secret: cfg.secret.clone(),
            bundle_dir: cfg.bundle_dir.clone(),
        }))
    }

    pub fn is_online(&self) -> bool {
        self.online.load(Ordering::Relaxed)
    }

    /// Record whether the server answered. Coming back online wakes the sync loop so queued
    /// progress goes up straight away.
    pub fn set_online(&self, on: bool) {
        let was = self.online.swap(on, Ordering::Relaxed);
        if on && !was {
            tracing::info!("back online");
            self.kick.notify_one();
        } else if !on && was {
            tracing::info!("offline");
        }
    }

    pub fn upstream_url(&self, path_and_query: &str) -> Url {
        self.upstream.join(path_and_query).unwrap_or_else(|_| self.upstream.clone())
    }

    pub fn save_cookies(&self) {
        let path = self.data_dir.join("cookies.json");
        let tmp = self.data_dir.join("cookies.json.tmp");
        let Ok(mut f) = std::fs::File::create(&tmp) else { return };
        let ok = {
            let jar = self.cookies.lock().unwrap_or_else(|e| e.into_inner());
            // The web app's sign-in lives in a browser-session cookie; keep it across restarts
            // the way a browser that "continues where you left off" does.
            cookie_store::serde::json::save_incl_expired_and_nonpersistent(&jar, &mut f).is_ok()
        };
        drop(f);
        if ok {
            let _ = std::fs::rename(&tmp, &path);
        }
    }

    pub fn clear_cookies(&self) {
        self.cookies.lock().unwrap_or_else(|e| e.into_inner()).clear();
        self.save_cookies();
    }
}

fn load_cookies(dir: &std::path::Path) -> cookie_store::CookieStore {
    std::fs::File::open(dir.join("cookies.json"))
        .ok()
        .and_then(|f| cookie_store::serde::json::load_all(std::io::BufReader::new(f)).ok())
        .unwrap_or_default()
}

/// Start everything: the local server and the background sync. Returns the address to open.
pub async fn start(cfg: Config) -> anyhow::Result<Started> {
    let app = App::new(&cfg)?;
    let started = server::serve(app.clone(), cfg.port).await?;
    tokio::spawn(sync::run(app.clone()));
    tokio::spawn(sync::watch_connection(app));
    Ok(started)
}

pub fn random_secret() -> String {
    use rand::Rng;
    let mut rng = rand::rng();
    (0..32).map(|_| format!("{:x}", rng.random_range(0..16u8))).collect()
}
