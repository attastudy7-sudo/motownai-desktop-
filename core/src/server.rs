//! The local web server the app window talks to.
//!
//! Every request from the window is passed on to motownai.com with the student's sign-in
//! cookies (kept here, not in the window). Good replies are saved; when the server can't be
//! reached the saved copy is served instead, and progress the student makes offline is queued
//! (`store::Store::enqueue`) for `sync` to send later.

use std::net::SocketAddr;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use axum::body::{Body, Bytes};
use axum::extract::{Request, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Router;
use futures_util::TryStreamExt;
use regex::Regex;
use serde_json::json;

use crate::store::{now, Saved};
use crate::App;

const INJECT_JS: &str = include_str!("../assets/inject.js");
const INJECT_CSS: &str = include_str!("../assets/inject.css");
const OFFLINE_HTML: &str = include_str!("../assets/offline.html");
const WELCOME_HTML: &str = include_str!("../assets/welcome.html");
const GATE_COOKIE: &str = "motown_desktop";
const MAX_BODY: usize = 64 * 1024 * 1024;

pub struct Started {
    pub addr: SocketAddr,
    /// Open this in the window: it hands the window the secret, then goes to the dashboard.
    pub boot_url: String,
}

pub async fn serve(app: Arc<App>, port: u16) -> anyhow::Result<Started> {
    let listener = bind(&app, port).await?;
    let addr = listener.local_addr()?;
    let boot_url = match &app.secret {
        Some(s) => format!("http://{addr}/__desktop/boot?k={s}"),
        None => format!("http://{addr}/dashboard"),
    };
    let router = Router::new().fallback(handle).with_state(app);
    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, router).await {
            tracing::error!("local server stopped: {e}");
        }
    });
    tracing::info!("listening on http://{addr}");
    Ok(Started { addr, boot_url })
}

/// The window's storage (the site's settings, which tutorials were seen, the website's own
/// offline data) belongs to the page's address, port included. So the app keeps the same port
/// from one launch to the next: the one it used last time, or a free one picked once and
/// remembered. Only if that port is taken by something else does it move.
async fn bind(app: &App, port: u16) -> anyhow::Result<tokio::net::TcpListener> {
    if port != 0 {
        return Ok(tokio::net::TcpListener::bind(("127.0.0.1", port)).await?);
    }
    let file = app.data_dir.join("port");
    let remembered = std::fs::read_to_string(&file).ok().and_then(|s| s.trim().parse::<u16>().ok());
    if let Some(p) = remembered {
        if let Ok(l) = tokio::net::TcpListener::bind(("127.0.0.1", p)).await {
            return Ok(l);
        }
        tracing::warn!("port {p} is in use; picking another (site settings in the window start fresh)");
    }
    let l = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await?;
    let _ = std::fs::write(&file, l.local_addr()?.port().to_string());
    Ok(l)
}

async fn handle(State(app): State<Arc<App>>, req: Request) -> Response {
    let path = req.uri().path().to_string();
    let pq = req.uri().path_and_query().map(|p| p.as_str().to_string()).unwrap_or_else(|| path.clone());

    if path == "/__desktop/boot" {
        return boot(&app, req.uri().query().unwrap_or(""));
    }
    if !allowed(&app, req.headers()) {
        return (StatusCode::FORBIDDEN, "Open Motown AI from the desktop app.").into_response();
    }
    match path.as_str() {
        "/__desktop/inject.js" => return asset(INJECT_JS, "application/javascript; charset=utf-8"),
        "/__desktop/inject.css" => return asset(INJECT_CSS, "text/css; charset=utf-8"),
        "/__desktop/status" => return status(&app),
        "/__desktop/open" => return open_outside(req.uri().query().unwrap_or("")),
        // The website's service worker would cache pages on its own and fight this server's
        // copies; this replacement removes any that a page tries to register.
        "/sw.js" => {
            return asset(
                "self.addEventListener('install',()=>self.skipWaiting());\
                 self.addEventListener('activate',()=>self.registration.unregister());",
                "application/javascript",
            )
        }
        _ => {}
    }

    if path.starts_with("/__ext/") {
        return external(app, &pq).await;
    }
    if req.method() == Method::GET || req.method() == Method::HEAD {
        get(app, req, pq).await
    } else {
        send(app, req, path, pq).await
    }
}

// ---------- the window's secret ----------

fn boot(app: &App, query: &str) -> Response {
    let k = url::form_urlencoded::parse(query.as_bytes()).find(|(k, _)| k == "k").map(|(_, v)| v.into_owned());
    match (&app.secret, k) {
        (Some(s), Some(k)) if *s == k => Response::builder()
            .status(StatusCode::FOUND)
            .header(header::LOCATION, "/dashboard")
            .header(header::SET_COOKIE, format!("{GATE_COOKIE}={s}; Path=/; HttpOnly; SameSite=Strict"))
            .body(Body::empty())
            .unwrap(),
        (None, _) => redirect_to("/dashboard"),
        _ => (StatusCode::FORBIDDEN, "Open Motown AI from the desktop app.").into_response(),
    }
}

fn allowed(app: &App, headers: &HeaderMap) -> bool {
    let Some(secret) = &app.secret else { return true };
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|c| c.trim().split_once('='))
        .any(|(k, v)| k == GATE_COOKIE && v == secret)
}

fn asset(body: &'static str, ct: &'static str) -> Response {
    ([(header::CONTENT_TYPE, ct), (header::CACHE_CONTROL, "no-store")], body).into_response()
}

fn redirect_to(to: &str) -> Response {
    Response::builder().status(StatusCode::FOUND).header(header::LOCATION, to).body(Body::empty()).unwrap()
}

fn status(app: &App) -> Response {
    use std::sync::atomic::Ordering::Relaxed;
    axum::Json(json!({
        "online": app.is_online(),
        "pending": app.store.pending(),
        "packs": app.store.pack_count(),
        "saving": app.saving.running.load(Relaxed),
        "saving_done": app.saving.done.load(Relaxed),
        "saving_total": app.saving.total.load(Relaxed),
    }))
    .into_response()
}

/// Links to other sites open in the student's normal browser.
fn open_outside(query: &str) -> Response {
    let target = url::form_urlencoded::parse(query.as_bytes()).find(|(k, _)| k == "url").map(|(_, v)| v.into_owned());
    if let Some(t) = target.filter(|t| t.starts_with("https://") || t.starts_with("http://") || t.starts_with("mailto:")) {
        let _ = open::that_detached(t);
    }
    StatusCode::NO_CONTENT.into_response()
}

// ---------- libraries from CDNs ----------

/// CDNs the web app loads icons, maths rendering and other libraries from. Their files are
/// saved like the site's own, so pages keep their icons offline. Pages are rewritten to load
/// them through `/__ext/<host>/...`.
const CDNS: &[&str] = &["cdn.jsdelivr.net", "cdnjs.cloudflare.com", "unpkg.com", "fonts.googleapis.com", "fonts.gstatic.com"];

async fn external(app: Arc<App>, pq: &str) -> Response {
    let rest = &pq["/__ext/".len()..];
    let (host, tail) = rest.split_once('/').unwrap_or((rest, ""));
    if !CDNS.contains(&host) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let key = format!("GET {pq}");
    // CDN files are versioned in their URL: once saved, they don't change.
    if let Some(saved) = app.store.get(&key) {
        return from_saved(saved, false);
    }
    let url = format!("https://{host}/{tail}");
    let res = match app.http_follow.get(&url).timeout(Duration::from_secs(30)).send().await {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => return r.status().as_u16().try_into().map(|s: StatusCode| s.into_response()).unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response()),
        Err(_) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
    };
    let ct = content_type(res.headers());
    let Ok(body) = res.bytes().await else { return StatusCode::BAD_GATEWAY.into_response() };
    // Google Fonts' CSS points at fonts.gstatic.com.
    let body = if host == "fonts.googleapis.com" {
        Bytes::from(String::from_utf8_lossy(&body).replace("https://fonts.gstatic.com/", "/__ext/fonts.gstatic.com/"))
    } else {
        body
    };
    app.store.put(&key, &Saved { status: 200, content_type: ct.clone(), location: None, body: body.to_vec(), fetched_at: now() });
    ([(header::CONTENT_TYPE, ct)], body).into_response()
}

// ---------- reading (GET) ----------

/// The saved-copy key for a request. HTMX and XHR requests can get a different reply from the
/// same URL (a fragment or JSON instead of a full page), so they're saved separately.
pub fn cache_key(pq: &str, headers: &HeaderMap) -> String {
    let mut key = format!("GET {}", normalize(pq));
    if headers.contains_key("hx-request") {
        key.push_str(" |hx");
    } else if headers.get("x-requested-with").and_then(|v| v.to_str().ok()) == Some("XMLHttpRequest") {
        key.push_str(" |xhr");
    }
    key
}

/// Drop cache-buster parameters (`_=1712…`) so a saved reply still matches next time.
fn normalize(pq: &str) -> String {
    let Some((path, q)) = pq.split_once('?') else { return pq.to_string() };
    let kept: Vec<&str> = q.split('&').filter(|p| !p.is_empty() && !p.starts_with("_=") && *p != "_").collect();
    if kept.is_empty() {
        path.to_string()
    } else {
        format!("{path}?{}", kept.join("&"))
    }
}

/// Pages and replies worth keeping. Sign-in, admin and payment pages are always live.
fn savable_path(path: &str) -> bool {
    !(path.starts_with("/auth/")
        || path.starts_with("/admin")
        || path.starts_with("/payments/")
        || path.starts_with("/checkout")
        || path.starts_with("/__desktop")
        || path.starts_with("/__ext/")
        || path == "/api/csrf-token"
        || path.starts_with("/api/m/"))
}

fn savable_type(ct: &str) -> bool {
    let ct = ct.to_ascii_lowercase();
    ct.starts_with("text/html")
        || ct.contains("json")
        || ct.starts_with("text/css")
        || ct.contains("javascript")
        || ct.starts_with("font/")
        || ct.contains("font")
        || ct.starts_with("image/")
        || ct.starts_with("text/plain")
}

/// How old a saved static file can get before it's refreshed in the background.
const STATIC_REFRESH_SECS: i64 = 5 * 60;

fn is_static(path: &str) -> bool {
    path.starts_with("/static/") || path == "/favicon.ico"
}

async fn get(app: Arc<App>, req: Request, pq: String) -> Response {
    let path = req.uri().path().to_string();
    let key = cache_key(&pq, req.headers());
    let wants_html = accepts_html(req.headers());

    // Static files: serve the saved copy at once, and refresh it in the background so an edit
    // to a file the site doesn't version (no ?v=) shows up by the next load, not hours later.
    if is_static(&path) {
        if let Some(saved) = app.store.get(&key) {
            if now() - saved.fetched_at > STATIC_REFRESH_SECS && app.is_online() {
                let (app, pq) = (app.clone(), pq.clone());
                tokio::spawn(async move {
                    let _ = fetch_and_save(&app, &pq).await;
                });
            }
            return from_saved(saved, false);
        }
        // Not saved yet. Online, ask the site: the installer's copy is matched by path alone, so
        // for a new ?v= it would be the old file. Offline, the installer's copy beats nothing
        // (offline_get falls back to it too, if the request below fails).
        if !app.is_online() {
            if let Some(r) = bundled(&app, &path) {
                return r;
            }
        }
    }

    let upstream = app.http.request(req.method().clone(), app.upstream_url(&pq));
    let upstream = forward_headers(&app, upstream, req.headers(), false);
    let res = match upstream.timeout(Duration::from_secs(45)).send().await {
        Ok(r) => r,
        Err(e) => {
            if e.is_connect() || e.is_timeout() || e.is_request() {
                app.set_online(false);
            }
            return offline_get(&app, &key, wants_html);
        }
    };
    app.set_online(true);
    let status = res.status();
    let ct = content_type(res.headers());

    // A server error with a good copy saved: show the copy.
    if status.is_server_error() {
        if let Some(saved) = app.store.get(&key) {
            return from_saved(saved, true);
        }
    }

    let streaming = ct.starts_with("text/event-stream")
        || ct.starts_with("audio/")
        || ct.starts_with("video/")
        || status == StatusCode::PARTIAL_CONTENT;
    if streaming {
        return stream_through(&app, res);
    }

    let headers = res.headers().clone();
    let body = match res.bytes().await {
        Ok(b) => b,
        Err(_) => return offline_get(&app, &key, wants_html),
    };
    let body = rewrite_text(&app, &ct, body);
    let location = headers.get(header::LOCATION).and_then(|v| v.to_str().ok()).map(|l| local_location(&app, l));

    let keep = savable_path(&path)
        && (status.is_success() || (status.is_redirection() && location.is_some()))
        && (savable_type(&ct) || status.is_redirection());
    if keep {
        let saved = Saved {
            status: status.as_u16(),
            content_type: ct.clone(),
            location: location.clone(),
            body: body.to_vec(),
            fetched_at: now(),
        };
        app.store.put(&key, &saved);
    }

    let mut out = Response::builder().status(status);
    copy_response_headers(&headers, out.headers_mut().unwrap());
    if let Some(l) = location {
        out = out.header(header::LOCATION, l);
    }
    out.body(Body::from(maybe_inject(&ct, body))).unwrap()
}

/// Background helper for `sync`: fetch a URL the way the window would and save it, following
/// redirects one hop at a time so each hop is saved too (a pack's page sends you on to its first
/// video). Returns the final reply's type and body when it was saved.
pub async fn fetch_and_save(app: &App, pq: &str) -> anyhow::Result<Option<(String, Bytes)>> {
    let mut pq = pq.to_string();
    for _ in 0..6 {
        let key = cache_key(&pq, &HeaderMap::new());
        let req = forward_headers(app, app.http.get(app.upstream_url(&pq)), &HeaderMap::new(), false);
        let res = req.timeout(Duration::from_secs(60)).send().await?;
        app.set_online(true);
        let status = res.status();
        let ct = content_type(res.headers());
        let location = res.headers().get(header::LOCATION).and_then(|v| v.to_str().ok()).map(|l| local_location(app, l));
        if status == StatusCode::UNAUTHORIZED {
            anyhow::bail!("signed out");
        }
        if status.is_redirection() {
            let Some(next) = location else { return Ok(None) };
            if next.starts_with("/auth/login") || next.contains("login=1") {
                anyhow::bail!("signed out");
            }
            if !next.starts_with('/') {
                return Ok(None); // off to another site
            }
            let saved = Saved { status: status.as_u16(), content_type: ct, location: Some(next.clone()), body: vec![], fetched_at: now() };
            app.store.put(&key, &saved);
            pq = next;
            continue;
        }
        if !status.is_success() || !savable_type(&ct) {
            return Ok(None);
        }
        let body = rewrite_text(app, &ct, res.bytes().await?);
        let saved = Saved { status: 200, content_type: ct.clone(), location: None, body: body.to_vec(), fetched_at: now() };
        app.store.put(&key, &saved);
        return Ok(Some((ct, body)));
    }
    Ok(None)
}

fn offline_get(app: &App, key: &str, wants_html: bool) -> Response {
    if let Some(saved) = app.store.get(key) {
        return from_saved(saved, true);
    }
    if is_static(key.trim_start_matches("GET ")) {
        if let Some(r) = bundled(app, key.trim_start_matches("GET ")) {
            return r;
        }
    }
    if wants_html {
        // Never signed in on this computer (nothing saved yet): the welcome screen that asks
        // to connect once. Otherwise: "this page isn't saved yet".
        let page = if app.store.has("GET /dashboard") { OFFLINE_HTML } else { WELCOME_HTML };
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
            .header("x-motown-offline", "1")
            .body(Body::from(maybe_inject("text/html", Bytes::from_static(page.as_bytes()))))
            .unwrap();
    }
    offline_json("This isn't saved on this computer yet. Connect to the internet to load it.")
}

fn offline_json(msg: &str) -> Response {
    let mut r = (
        StatusCode::SERVICE_UNAVAILABLE,
        axum::Json(json!({"ok": false, "offline": true, "error": msg})),
    )
        .into_response();
    r.headers_mut().insert("x-motown-offline", HeaderValue::from_static("1"));
    r
}

/// A static file from the installer's copy of the site (`bundle/static`).
fn bundled(app: &App, path_and_query: &str) -> Option<Response> {
    let dir = app.bundle_dir.as_ref()?;
    let path = path_and_query.split('?').next()?;
    let rel = path.strip_prefix("/static/")?;
    let rel = percent_decode(rel);
    // Stay inside the bundle folder.
    if rel.split('/').any(|seg| seg == ".." || seg.is_empty()) || rel.contains('\\') {
        return None;
    }
    let file = dir.join(&rel);
    let body = std::fs::read(&file).ok()?;
    Some(([(header::CONTENT_TYPE, mime_for(&rel))], body).into_response())
}

fn percent_decode(s: &str) -> String {
    percent_encoding::percent_decode_str(s).decode_utf8_lossy().into_owned()
}

fn mime_for(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "application/javascript; charset=utf-8",
        "json" => "application/json",
        "html" => "text/html; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "mp3" => "audio/mpeg",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

fn from_saved(saved: Saved, offline: bool) -> Response {
    let mut b = Response::builder()
        .status(StatusCode::from_u16(saved.status).unwrap_or(StatusCode::OK))
        .header(header::CONTENT_TYPE, saved.content_type.clone());
    if let Some(l) = &saved.location {
        b = b.header(header::LOCATION, l.clone());
    }
    if offline {
        b = b.header("x-motown-offline", "1");
    }
    b.body(Body::from(maybe_inject(&saved.content_type, Bytes::from(saved.body)))).unwrap()
}

fn stream_through(app: &App, res: reqwest::Response) -> Response {
    let _ = app;
    let status = res.status();
    let mut out = Response::builder().status(status);
    copy_response_headers(res.headers(), out.headers_mut().unwrap());
    for h in [header::CONTENT_LENGTH, header::CONTENT_RANGE, header::ACCEPT_RANGES] {
        if let Some(v) = res.headers().get(&h) {
            out = out.header(h, v.clone());
        }
    }
    let stream = res.bytes_stream().map_err(std::io::Error::other);
    out.body(Body::from_stream(stream)).unwrap()
}

// ---------- changes (POST, PATCH, PUT, DELETE) ----------

/// Changes that are safe to send later: the student's own progress and notes. Everything else
/// (making packs, chat, payments…) needs the server's answer right away.
fn queueable(method: &Method, path: &str) -> bool {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(concat!(
            r"^(?:/api/question-answer",
            r"|/api/sync/progress-batch",
            r"|/library/api/pack/\d+/section/\d+/complete",
            r"|/library/pack/\d+/save-(?:quiz|fillins)",
            r"|/library/pack/\d+/notes",
            r"|/library/pack/\d+/video-complete",
            r"|/library/pack/\d+/resource/\d+/complete",
            r"|/library/video/\d+/complete",
            r")/?$"
        ))
        .unwrap()
    });
    *method != Method::GET && re.is_match(path)
}

async fn send(app: Arc<App>, req: Request, path: String, pq: String) -> Response {
    let method = req.method().clone();
    let headers = req.headers().clone();
    let ct = headers.get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).map(str::to_string);
    let body = match axum::body::to_bytes(req.into_body(), MAX_BODY).await {
        Ok(b) => b,
        Err(_) => return (StatusCode::PAYLOAD_TOO_LARGE, "Too large").into_response(),
    };
    let login_name = if path == "/auth/login" { login_identifier(ct.as_deref(), &body) } else { None };

    let upstream = app.http.request(method.clone(), app.upstream_url(&pq)).body(body.clone());
    let upstream = forward_headers(&app, upstream, &headers, true);
    let res = match upstream.timeout(Duration::from_secs(300)).send().await {
        Ok(r) => r,
        Err(e) => {
            if e.is_connect() || e.is_timeout() || e.is_request() {
                app.set_online(false);
            }
            if path == "/auth/logout" {
                // Signing out works offline too: forget everything here.
                sign_out(&app);
                return redirect_to("/");
            }
            if queueable(&method, &path) {
                app.store.enqueue(method.as_str(), &pq, ct.as_deref(), &body);
                return axum::Json(json!({"ok": true, "queued": true, "offline": true})).into_response();
            }
            if accepts_html(&headers) && !is_xhr(&headers) {
                return offline_get(&app, "", true);
            }
            return offline_json("You're offline. This needs the internet; try again when you're connected.");
        }
    };
    app.set_online(true);
    app.save_cookies();
    let status = res.status();
    let rct = content_type(res.headers());
    let location = res.headers().get(header::LOCATION).and_then(|v| v.to_str().ok()).map(|l| local_location(&app, l));

    if path == "/auth/logout" {
        sign_out(&app);
    } else if let Some(name) = login_name {
        if signed_in(status, location.as_deref(), &rct) {
            // A different student on this computer: start from a clean slate.
            if app.store.kv_get("login").is_some_and(|prev| prev != name) {
                app.store.wipe();
            }
            app.store.kv_set("login", &name);
        }
    }
    if status.is_success() || status.is_redirection() {
        // A new pack, a renamed folder…: let the background sync pick it up.
        app.kick.notify_one();
    }

    if rct.starts_with("text/event-stream") {
        return stream_through(&app, res);
    }
    let rheaders = res.headers().clone();
    let rbody = res.bytes().await.unwrap_or_default();
    let rbody = rewrite_text(&app, &rct, rbody);
    let mut out = Response::builder().status(status);
    copy_response_headers(&rheaders, out.headers_mut().unwrap());
    if let Some(l) = location {
        out = out.header(header::LOCATION, l);
    }
    out.body(Body::from(maybe_inject(&rct, rbody))).unwrap()
}

fn sign_out(app: &App) {
    app.store.wipe();
    app.clear_cookies();
}

/// The username or email typed into the sign-in form.
fn login_identifier(ct: Option<&str>, body: &[u8]) -> Option<String> {
    let ct = ct.unwrap_or("");
    let name = if ct.contains("json") {
        let v: serde_json::Value = serde_json::from_slice(body).ok()?;
        v.get("username").or_else(|| v.get("login")).or_else(|| v.get("email"))?.as_str()?.to_string()
    } else {
        url::form_urlencoded::parse(body)
            .find(|(k, _)| k == "username" || k == "login" || k == "email")
            .map(|(_, v)| v.into_owned())?
    };
    Some(name.trim().to_lowercase())
}

/// The web app answers a good sign-in with a redirect away from the sign-in page (form post) or
/// a JSON `{redirect}` (XHR).
fn signed_in(status: StatusCode, location: Option<&str>, ct: &str) -> bool {
    if status.is_redirection() {
        return location.is_some_and(|l| !l.contains("login=1") && !l.starts_with("/auth/login"));
    }
    status.is_success() && ct.contains("json")
}

// ---------- headers and bodies ----------

fn accepts_html(h: &HeaderMap) -> bool {
    h.get(header::ACCEPT).and_then(|v| v.to_str().ok()).is_some_and(|a| a.contains("text/html"))
}

fn is_xhr(h: &HeaderMap) -> bool {
    h.contains_key("hx-request")
        || h.get("x-requested-with").and_then(|v| v.to_str().ok()) == Some("XMLHttpRequest")
}

fn content_type(h: &reqwest::header::HeaderMap) -> String {
    h.get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("application/octet-stream").to_string()
}

/// Pass the window's request on as if the browser were on motownai.com itself. Cookies come
/// from this app's own jar, never from the window.
fn forward_headers(app: &App, mut rb: reqwest::RequestBuilder, h: &HeaderMap, change: bool) -> reqwest::RequestBuilder {
    const PASS: &[&str] = &[
        "accept", "accept-language", "content-type", "x-csrftoken", "x-csrf-token", "x-requested-with",
        "hx-request", "hx-target", "hx-trigger", "hx-trigger-name", "hx-current-url", "hx-boosted",
        "hx-history-restore-request", "hx-prompt", "range", "cache-control",
    ];
    for name in PASS {
        if let Some(v) = h.get(*name) {
            let v = if name.starts_with("hx-current-url") { upstream_equiv(app, v) } else { v.as_bytes().to_vec() };
            rb = rb.header(*name, v);
        }
    }
    // Flask-WTF checks that changes come from its own pages (strict Referer over HTTPS).
    let referer = h.get(header::REFERER).map(|v| upstream_equiv(app, v));
    if let Some(r) = referer {
        rb = rb.header(reqwest::header::REFERER, r);
    } else if change {
        rb = rb.header(reqwest::header::REFERER, app.upstream_url("/").to_string());
    }
    if change || h.contains_key(header::ORIGIN) {
        rb = rb.header(reqwest::header::ORIGIN, app.upstream.origin().ascii_serialization());
    }
    rb
}

/// `http://127.0.0.1:port/library?x` → `https://www.motownai.com/library?x`
fn upstream_equiv(app: &App, v: &HeaderValue) -> Vec<u8> {
    let s = v.to_str().unwrap_or("");
    match url::Url::parse(s) {
        Ok(u) if u.host_str() == Some("127.0.0.1") || u.host_str() == Some("localhost") => {
            let pq = match u.query() {
                Some(q) => format!("{}?{}", u.path(), q),
                None => u.path().to_string(),
            };
            app.upstream_url(&pq).to_string().into_bytes()
        }
        _ => s.as_bytes().to_vec(),
    }
}

fn copy_response_headers(from: &reqwest::header::HeaderMap, to: &mut HeaderMap) {
    const PASS: &[&str] = &[
        "content-type", "content-disposition", "cache-control", "hx-redirect", "hx-refresh", "hx-trigger",
        "hx-push-url", "hx-replace-url", "hx-reswap", "hx-retarget", "hx-location", "x-ratelimit-remaining",
        "retry-after",
    ];
    for name in PASS {
        for v in from.get_all(*name) {
            if let Ok(v) = HeaderValue::from_bytes(v.as_bytes()) {
                to.append(*name, v);
            }
        }
    }
}

/// The site's own absolute links (`https://www.motownai.com/library`) → local ones (`/library`).
fn local_location(app: &App, l: &str) -> String {
    for origin in origins(app) {
        if let Some(rest) = l.strip_prefix(origin.as_str()) {
            return if rest.is_empty() { "/".into() } else { rest.to_string() };
        }
    }
    l.to_string()
}

fn origins(app: &App) -> Vec<String> {
    let mut o = vec![app.upstream.origin().ascii_serialization()];
    for extra in ["https://www.motownai.com", "https://motownai.com"] {
        if !o.iter().any(|x| x == extra) {
            o.push(extra.to_string());
        }
    }
    o
}

fn rewrite_text(app: &App, ct: &str, body: Bytes) -> Bytes {
    let page = ct.starts_with("text/html") || ct.contains("json");
    if !(page || ct.contains("javascript") || ct.starts_with("text/css")) {
        return body;
    }
    let Ok(text) = std::str::from_utf8(&body) else { return body };
    let mut out = text.to_string();
    let mut changed = false;
    for host in CDNS {
        let from = format!("https://{host}/");
        if out.contains(&from) {
            out = out.replace(&from, &format!("/__ext/{host}/"));
            changed = true;
        }
    }
    if !page {
        return if changed { Bytes::from(out) } else { body };
    }
    for origin in origins(app) {
        // Keep canonical/OG tags pointing at the real site; rewrite links the student follows.
        for (from, to) in [
            (format!("href=\"{origin}/"), "href=\"/".to_string()),
            (format!("action=\"{origin}/"), "action=\"/".to_string()),
            (format!("src=\"{origin}/"), "src=\"/".to_string()),
            (format!("\"redirect\": \"{origin}/"), "\"redirect\": \"/".to_string()),
            (format!("\"redirect\":\"{origin}/"), "\"redirect\":\"/".to_string()),
        ] {
            if out.contains(&from) {
                out = out.replace(&from, &to);
                changed = true;
            }
        }
    }
    if changed { Bytes::from(out) } else { body }
}

/// Every page gets the desktop helper: offline strip, background-save status, outside links.
fn maybe_inject(ct: &str, body: Bytes) -> Bytes {
    if !ct.starts_with("text/html") {
        return body;
    }
    let Ok(text) = std::str::from_utf8(&body) else { return body };
    let tag = "<link rel=\"stylesheet\" href=\"/__desktop/inject.css\"><script src=\"/__desktop/inject.js\"></script>";
    match text.find("</head>").or_else(|| text.find("</HEAD>")) {
        Some(i) => {
            let mut s = String::with_capacity(text.len() + tag.len());
            s.push_str(&text[..i]);
            s.push_str(tag);
            s.push_str(&text[i..]);
            Bytes::from(s)
        }
        None if text.trim_start().starts_with("<!") || text.contains("<html") => {
            Bytes::from(format!("{tag}{text}"))
        }
        None => body, // an HTMX fragment: the page around it already has the helper
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_ignore_cache_busters() {
        let h = HeaderMap::new();
        assert_eq!(cache_key("/library?_=123", &h), "GET /library");
        assert_eq!(cache_key("/a?type=quiz&_=9&group=0", &h), "GET /a?type=quiz&group=0");
        let mut hx = HeaderMap::new();
        hx.insert("hx-request", HeaderValue::from_static("true"));
        assert_eq!(cache_key("/library", &hx), "GET /library |hx");
    }

    #[test]
    fn only_progress_is_queued() {
        assert!(queueable(&Method::POST, "/api/question-answer"));
        assert!(queueable(&Method::POST, "/library/api/pack/4/section/9/complete"));
        assert!(queueable(&Method::POST, "/library/pack/4/save-quiz"));
        assert!(!queueable(&Method::POST, "/library/pack/4/generate-quiz"));
        assert!(!queueable(&Method::POST, "/api/ai/chat"));
        assert!(!queueable(&Method::GET, "/api/question-answer"));
    }

    #[test]
    fn injects_before_head_end() {
        let b = maybe_inject("text/html; charset=utf-8", Bytes::from_static(b"<html><head><title>x</title></head><body></body></html>"));
        let s = std::str::from_utf8(&b).unwrap();
        assert!(s.contains("inject.js\"></script></head>"));
        let frag = maybe_inject("text/html", Bytes::from_static(b"<div>row</div>"));
        assert_eq!(&frag[..], b"<div>row</div>");
    }

    #[test]
    fn decodes_bundled_paths() {
        assert_eq!(percent_decode("images/ChatGPT%20Image.png"), "images/ChatGPT Image.png");
        assert_eq!(percent_decode("css/style.css"), "css/style.css");
        assert_eq!(mime_for("fonts/a.woff2"), "font/woff2");
    }

    #[test]
    fn reads_login_names() {
        assert_eq!(login_identifier(Some("application/x-www-form-urlencoded"), b"csrf_token=x&username=Ama%40ug.edu.gh&password=p"), Some("ama@ug.edu.gh".into()));
        assert_eq!(login_identifier(Some("application/json"), br#"{"username":"Kofi"}"#), Some("kofi".into()));
    }

    #[test]
    fn detects_sign_in() {
        assert!(signed_in(StatusCode::FOUND, Some("/dashboard"), "text/html"));
        assert!(!signed_in(StatusCode::FOUND, Some("/?login=1"), "text/html"));
        assert!(signed_in(StatusCode::OK, None, "application/json"));
        assert!(!signed_in(StatusCode::UNAUTHORIZED, None, "application/json"));
    }
}
