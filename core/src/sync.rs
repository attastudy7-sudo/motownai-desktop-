//! Background work while the app is open:
//!
//!   1. send progress made offline (the outbox), oldest first
//!   2. keep every pack the student owns saved on this computer: ask the server which packs
//!      changed (`/api/packs/versions`) and fetch each one's study room page and the data its
//!      tabs load, so it opens offline even if it was never opened here
//!
//! Runs when the app starts, when it comes back online, after the student changes something
//! (a new pack), and every few minutes.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::Ordering::Relaxed;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use futures_util::{stream, StreamExt};
use regex::Regex;
use serde::Deserialize;

use crate::server::fetch_and_save;
use crate::App;

const EVERY: Duration = Duration::from_secs(10 * 60);
/// A pack's page also shows the student's progress, credits and streak, so even an unchanged
/// pack is saved again this often.
const RESAVE_AFTER_SECS: i64 = 12 * 3600;
/// Packs fetched at once. Kept low: students are often on metered mobile data.
const PARALLEL: usize = 3;

pub async fn run(app: Arc<App>) {
    loop {
        if app.is_online() {
            replay_outbox(&app).await;
            if let Err(e) = save_library(&app).await {
                tracing::info!("library not saved this round: {e}");
            }
        }
        // Several kicks in a row (a burst of changes) collapse into one round.
        let _ = tokio::time::timeout(EVERY, app.kick.notified()).await;
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}

/// Notice when the connection comes back (or drops while the student is idle).
pub async fn watch_connection(app: Arc<App>) {
    loop {
        let wait = if app.is_online() { 60 } else { 15 };
        tokio::time::sleep(Duration::from_secs(wait)).await;
        let ok = app
            .http
            .head(app.upstream_url("/static/manifest.json"))
            .timeout(Duration::from_secs(8))
            .send()
            .await
            .is_ok();
        app.set_online(ok);
    }
}

// ---------- 1. the outbox ----------

async fn replay_outbox(app: &App) {
    let queued = app.store.queued();
    if queued.is_empty() {
        return;
    }
    let Some(token) = csrf_token(app).await else { return };
    tracing::info!("sending {} change(s) made offline", queued.len());
    for q in queued {
        let method = reqwest::Method::from_bytes(q.method.as_bytes()).unwrap_or(reqwest::Method::POST);
        let mut rb = app
            .http
            .request(method, app.upstream_url(&q.path))
            .header("X-CSRFToken", &token)
            .header("X-Requested-With", "XMLHttpRequest")
            .header(reqwest::header::REFERER, app.upstream_url("/dashboard").to_string())
            .header(reqwest::header::ORIGIN, app.upstream.origin().ascii_serialization())
            .body(q.body.clone());
        if let Some(ct) = &q.content_type {
            rb = rb.header(reqwest::header::CONTENT_TYPE, ct);
        }
        match rb.timeout(Duration::from_secs(30)).send().await {
            Ok(r) if r.status().is_success() || r.status().is_redirection() => app.store.dequeue(q.id),
            // The server turned it down for good (pack deleted, bad data): don't retry forever.
            Ok(r) if r.status().is_client_error() && r.status() != reqwest::StatusCode::TOO_MANY_REQUESTS
                && r.status() != reqwest::StatusCode::UNAUTHORIZED => {
                tracing::warn!("dropped queued {} {}: {}", q.method, q.path, r.status());
                app.store.dequeue(q.id);
            }
            // Signed out, rate limited, server trouble or offline again: keep it, try later in order.
            _ => return,
        }
    }
    app.save_cookies();
}

async fn csrf_token(app: &App) -> Option<String> {
    #[derive(Deserialize)]
    struct T {
        csrf_token: String,
    }
    let r = app.http.get(app.upstream_url("/api/csrf-token")).timeout(Duration::from_secs(15)).send().await.ok()?;
    r.json::<T>().await.ok().map(|t| t.csrf_token)
}

// ---------- 2. every pack, saved ----------

#[derive(Deserialize)]
struct Versions {
    ok: bool,
    #[serde(default)]
    packs: Vec<PackVersion>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackVersion {
    pack_id: i64,
    #[serde(default)]
    pack_version: Option<serde_json::Value>,
    #[serde(default)]
    deleted: bool,
}

fn version_str(v: &Option<serde_json::Value>) -> Option<String> {
    match v {
        Some(serde_json::Value::String(s)) => Some(s.clone()),
        Some(serde_json::Value::Null) | None => None,
        Some(other) => Some(other.to_string()),
    }
}

async fn save_library(app: &App) -> anyhow::Result<()> {
    // The pages that list packs, so the library opens offline with everything in it.
    let mut pages = Vec::new();
    for page in ["/dashboard", "/library", "/chat"] {
        if let Some((_, body)) = fetch_and_save(app, page).await? {
            pages.push(String::from_utf8_lossy(&body).into_owned());
        }
    }

    let saved = app.store.saved_packs();
    let local: HashMap<i64, Option<String>> = saved.iter().map(|(id, v, _)| (*id, v.clone())).collect();
    let stale: HashSet<i64> = saved.iter().filter(|(_, _, at)| crate::store::now() - at > RESAVE_AFTER_SECS).map(|(id, _, _)| *id).collect();
    let (owned, complete) = owned_packs(app, &pages, &local).await?;

    // Packs deleted on the website or another device.
    if complete {
        for id in local.keys().filter(|id| !owned.contains_key(id)) {
            app.store.forget_pack(*id);
        }
    }
    let changed: Vec<(i64, Option<String>)> = owned
        .into_iter()
        .filter(|(id, v)| match local.get(id) {
            Some(have) => have != v || v.is_none() || stale.contains(id),
            None => true,
        })
        .collect();

    // Files the pages need (CSS, JS, fonts, icons), so they render offline too.
    let mut statics: HashSet<String> = pages.iter().flat_map(|p| static_refs(p)).collect();

    if !changed.is_empty() {
        tracing::info!("saving {} pack(s) for offline", changed.len());
        app.saving.total.store(changed.len() as i64, Relaxed);
        app.saving.done.store(0, Relaxed);
        app.saving.running.store(true, Relaxed);
        let results: Vec<anyhow::Result<Vec<String>>> = stream::iter(changed)
            .map(|(id, version)| async move {
                let r = save_pack(app, id).await;
                if r.is_ok() {
                    app.store.set_pack_version(id, version.as_deref());
                }
                app.saving.done.fetch_add(1, Relaxed);
                r
            })
            .buffer_unordered(PARALLEL)
            .collect()
            .await;
        app.saving.running.store(false, Relaxed);
        for r in results {
            match r {
                Ok(refs) => statics.extend(refs),
                Err(e) if e.to_string() == "signed out" => return Err(e),
                Err(_) => {}
            }
        }
    }

    for s in statics {
        if !app.store.has(&format!("GET {s}")) {
            let _ = fetch_and_save(app, &s).await;
        }
    }
    app.save_cookies();
    Ok(())
}

/// Every pack the student owns, with its content version. The second value says whether the
/// list is complete (safe to delete local packs missing from it).
async fn owned_packs(
    app: &App,
    pages: &[String],
    local: &HashMap<i64, Option<String>>,
) -> anyhow::Result<(HashMap<i64, Option<String>>, bool)> {
    // Newer servers list every owned pack in one call.
    let r = app.http.get(app.upstream_url("/api/packs/versions?all=1")).timeout(Duration::from_secs(30)).send().await?;
    if r.status() == reqwest::StatusCode::UNAUTHORIZED || r.status().is_redirection() {
        anyhow::bail!("signed out");
    }
    if r.status().is_success() {
        if let Ok(v) = r.json::<Versions>().await {
            if v.ok {
                let all = v.packs.into_iter().filter(|p| !p.deleted).map(|p| (p.pack_id, version_str(&p.pack_version))).collect();
                return Ok((all, true));
            }
        }
    }

    // Older servers: find pack ids on the dashboard and library pages, plus the ones saved here,
    // and ask about those.
    let mut ids: Vec<i64> = pages.iter().flat_map(|p| pack_ids(p)).chain(local.keys().copied()).collect();
    ids.sort_unstable();
    ids.dedup();
    let mut out = HashMap::new();
    for chunk in ids.chunks(200) {
        let list = chunk.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(",");
        let r = app.http.get(app.upstream_url(&format!("/api/packs/versions?ids={list}"))).timeout(Duration::from_secs(30)).send().await?;
        if !r.status().is_success() {
            anyhow::bail!("versions: {}", r.status());
        }
        let v: Versions = r.json().await?;
        // No versions sent, so the server lists every pack; `deleted` covers packs that are gone
        // or aren't the student's (clones of other people's packs show up on these pages too).
        for p in v.packs.into_iter().filter(|p| !p.deleted) {
            out.insert(p.pack_id, version_str(&p.pack_version));
        }
    }
    Ok((out, false))
}

/// Save one pack: its study room page and the data each tab loads. Returns the static files
/// its page needs.
async fn save_pack(app: &App, id: i64) -> anyhow::Result<Vec<String>> {
    let mut refs = Vec::new();
    match fetch_and_save(app, &format!("/library/pack/{id}")).await? {
        Some((ct, body)) if ct.starts_with("text/html") => refs.extend(static_refs(&String::from_utf8_lossy(&body))),
        _ => {}
    }

    let mut urls = vec![
        format!("/library/pack/{id}/resource-status"),
        format!("/library/pack/{id}/notes"),
        format!("/library/pack/{id}/topics"),
        format!("/library/pack/{id}/videos-data"),
        format!("/library/pack/{id}/video-count"),
        format!("/library/api/pack/{id}/final-assessment"),
        format!("/library/api/pack/{id}/toc-topics"),
        format!("/library/api/pack/{id}/questions"),
        format!("/api/ai/chat/history?pack_id={id}"),
        format!("/api/pack/{id}/folder-prompt"),
    ];

    // Flashcards, quiz and fill-in, plus where the student is up to in each.
    for (kind, item) in [("flashcards", "flashcard"), ("quiz", "quiz"), ("fill_in", "fillin"), ("notes", "")] {
        let url = format!("/library/pack/{id}/resource-content?type={kind}&group=0");
        if let Ok(Some((_, body))) = fetch_and_save(app, &url).await {
            if !item.is_empty() {
                if let Some(rid) = resource_id(&body) {
                    urls.push(format!("/api/question-progress?resource_id={rid}&item_type={item}"));
                }
            }
        }
    }

    // The guided path: each section's reading and its checkpoint questions.
    if let Ok(Some((_, body))) = fetch_and_save(app, &format!("/library/api/pack/{id}/sections")).await {
        for sid in section_ids(&body) {
            urls.push(format!("/library/api/pack/{id}/section/{sid}/content"));
            urls.push(format!("/library/api/pack/{id}/section/{sid}/checkpoints"));
        }
    }

    for u in urls {
        match fetch_and_save(app, &u).await {
            Err(e) if e.to_string() == "signed out" => return Err(e),
            _ => {}
        }
    }
    Ok(refs)
}

// ---------- reading pages ----------

pub fn static_refs(html: &str) -> Vec<String> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r#"(?:src|href)=["'](/(?:static|__ext)/[^"'\s>]+)["']"#).unwrap());
    re.captures_iter(html).map(|c| c[1].replace("&amp;", "&")).collect()
}

pub fn pack_ids(html: &str) -> Vec<i64> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(r#"(?:/library/pack/(\d+)|data-pack-id=["'](\d+)["']|/library/api/pack/(\d+))"#).unwrap()
    });
    re.captures_iter(html)
        .filter_map(|c| c.get(1).or_else(|| c.get(2)).or_else(|| c.get(3)))
        .filter_map(|m| m.as_str().parse().ok())
        .collect()
}

fn resource_id(body: &[u8]) -> Option<i64> {
    let v: serde_json::Value = serde_json::from_slice(body).ok()?;
    v.get("resource_id")?.as_i64()
}

fn section_ids(body: &[u8]) -> Vec<i64> {
    let Ok(v) = serde_json::from_slice::<serde_json::Value>(body) else { return vec![] };
    v.get("sections")
        .and_then(|s| s.as_array())
        .map(|a| a.iter().filter_map(|s| s.get("id")?.as_i64()).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_pages() {
        let html = r#"<link href="/static/css/style.css?v=3"><script src='/static/js/app.js'></script>
            <a href="/library/pack/12">x</a><div data-pack-id="40"></div><img src="https://cdn/x.png">"#;
        assert_eq!(static_refs(html), vec!["/static/css/style.css?v=3", "/static/js/app.js"]);
        assert_eq!(pack_ids(html), vec![12, 40]);
        assert_eq!(section_ids(br#"{"ok":true,"sections":[{"id":5},{"id":9}]}"#), vec![5, 9]);
        assert_eq!(resource_id(br#"{"ok":true,"resource_id":77}"#), Some(77));
    }
}
