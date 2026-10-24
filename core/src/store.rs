//! Everything the app keeps on disk, in one SQLite file in the app's data folder.
//!
//!   responses  the last good copy of every page and API reply the app has seen, so it can be
//!              shown again offline (key = method + path + query)
//!   packs      which version of each pack is saved here, so a pack is fetched again only when
//!              it changes on the server
//!   outbox     progress made offline (answers, finished sections, notes), sent in order once
//!              the app is back online
//!   kv         small settings (signed-in user, last sync time)

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};

pub struct Store {
    db: Mutex<Connection>,
}

#[derive(Clone, Debug)]
pub struct Saved {
    pub status: u16,
    pub content_type: String,
    pub location: Option<String>,
    pub body: Vec<u8>,
    pub fetched_at: i64,
}

#[derive(Clone, Debug)]
pub struct Queued {
    pub id: i64,
    pub method: String,
    pub path: String,
    pub content_type: Option<String>,
    pub body: Vec<u8>,
}

pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

impl Store {
    pub fn open(path: &Path) -> anyhow::Result<Self> {
        let db = Connection::open(path)?;
        db.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             CREATE TABLE IF NOT EXISTS responses (
               key TEXT PRIMARY KEY, status INTEGER NOT NULL, content_type TEXT NOT NULL,
               location TEXT, body BLOB NOT NULL, fetched_at INTEGER NOT NULL, pack_id INTEGER);
             CREATE INDEX IF NOT EXISTS responses_pack ON responses(pack_id);
             CREATE TABLE IF NOT EXISTS packs (
               id INTEGER PRIMARY KEY, version TEXT, saved_at INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS outbox (
               id INTEGER PRIMARY KEY AUTOINCREMENT, method TEXT NOT NULL, path TEXT NOT NULL,
               content_type TEXT, body BLOB NOT NULL, created_at INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
        )?;
        Ok(Self { db: Mutex::new(db) })
    }

    fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.db.lock().unwrap_or_else(|e| e.into_inner())
    }

    // ---------- saved responses ----------

    pub fn get(&self, key: &str) -> Option<Saved> {
        self.conn()
            .query_row(
                "SELECT status, content_type, location, body, fetched_at FROM responses WHERE key = ?1",
                [key],
                |r| {
                    Ok(Saved {
                        status: r.get::<_, i64>(0)? as u16,
                        content_type: r.get(1)?,
                        location: r.get(2)?,
                        body: r.get(3)?,
                        fetched_at: r.get(4)?,
                    })
                },
            )
            .optional()
            .ok()
            .flatten()
    }

    pub fn put(&self, key: &str, saved: &Saved) {
        let pack_id = pack_of(key);
        let _ = self.conn().execute(
            "INSERT INTO responses (key, status, content_type, location, body, fetched_at, pack_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(key) DO UPDATE SET status = ?2, content_type = ?3, location = ?4,
               body = ?5, fetched_at = ?6, pack_id = ?7",
            params![key, saved.status as i64, saved.content_type, saved.location, saved.body, saved.fetched_at, pack_id],
        );
    }

    pub fn has(&self, key: &str) -> bool {
        self.conn()
            .query_row("SELECT 1 FROM responses WHERE key = ?1", [key], |_| Ok(()))
            .optional()
            .ok()
            .flatten()
            .is_some()
    }

    // ---------- packs ----------

    pub fn pack_versions(&self) -> Vec<(i64, Option<String>)> {
        self.saved_packs().into_iter().map(|(id, v, _)| (id, v)).collect()
    }

    /// (id, version, when it was last saved) for every pack saved here.
    pub fn saved_packs(&self) -> Vec<(i64, Option<String>, i64)> {
        let c = self.conn();
        let mut st = match c.prepare("SELECT id, version, saved_at FROM packs") {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map(|rows| rows.flatten().collect())
            .unwrap_or_default()
    }

    pub fn set_pack_version(&self, id: i64, version: Option<&str>) {
        let _ = self.conn().execute(
            "INSERT INTO packs (id, version, saved_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET version = ?2, saved_at = ?3",
            params![id, version, now()],
        );
    }

    /// A pack deleted on the server (or on another device): forget it and everything saved for it.
    pub fn forget_pack(&self, id: i64) {
        let c = self.conn();
        let _ = c.execute("DELETE FROM packs WHERE id = ?1", [id]);
        let _ = c.execute("DELETE FROM responses WHERE pack_id = ?1", [id]);
    }

    pub fn pack_count(&self) -> i64 {
        self.conn().query_row("SELECT COUNT(*) FROM packs", [], |r| r.get(0)).unwrap_or(0)
    }

    // ---------- outbox ----------

    pub fn enqueue(&self, method: &str, path: &str, content_type: Option<&str>, body: &[u8]) {
        let _ = self.conn().execute(
            "INSERT INTO outbox (method, path, content_type, body, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![method, path, content_type, body, now()],
        );
    }

    pub fn queued(&self) -> Vec<Queued> {
        let c = self.conn();
        let mut st = match c.prepare("SELECT id, method, path, content_type, body FROM outbox ORDER BY id") {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        st.query_map([], |r| {
            Ok(Queued { id: r.get(0)?, method: r.get(1)?, path: r.get(2)?, content_type: r.get(3)?, body: r.get(4)? })
        })
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
    }

    pub fn dequeue(&self, id: i64) {
        let _ = self.conn().execute("DELETE FROM outbox WHERE id = ?1", [id]);
    }

    pub fn pending(&self) -> i64 {
        self.conn().query_row("SELECT COUNT(*) FROM outbox", [], |r| r.get(0)).unwrap_or(0)
    }

    // ---------- settings ----------

    pub fn kv_get(&self, key: &str) -> Option<String> {
        self.conn()
            .query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0))
            .optional()
            .ok()
            .flatten()
    }

    pub fn kv_set(&self, key: &str, value: &str) {
        let _ = self.conn().execute(
            "INSERT INTO kv (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2",
            params![key, value],
        );
    }

    /// Signing out forgets the student's data on this computer.
    pub fn wipe(&self) {
        let _ = self.conn().execute_batch(
            "DELETE FROM responses; DELETE FROM packs; DELETE FROM outbox; DELETE FROM kv; VACUUM;",
        );
    }
}

/// Which pack a saved response belongs to, from its URL (`/library/pack/12/...`,
/// `/library/api/pack/12/...`, `/api/pack/12/...`, `?pack_id=12`), so deleting a pack
/// also deletes what was saved for it.
pub fn pack_of(key: &str) -> Option<i64> {
    use std::sync::OnceLock;
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        regex::Regex::new(r"(?:/pack/(\d+)(?:[/?]|$)|[?&]pack_id=(\d+))").unwrap()
    });
    let c = re.captures(key)?;
    c.get(1).or_else(|| c.get(2))?.as_str().parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_pack_ids() {
        assert_eq!(pack_of("GET /library/pack/12"), Some(12));
        assert_eq!(pack_of("GET /library/pack/12/resource-content?type=quiz&group=0"), Some(12));
        assert_eq!(pack_of("GET /library/api/pack/7/section/3/content"), Some(7));
        assert_eq!(pack_of("GET /api/ai/chat/history?pack_id=44"), Some(44));
        assert_eq!(pack_of("GET /dashboard"), None);
        assert_eq!(pack_of("GET /library/packs"), None);
    }

    #[test]
    fn round_trips() {
        let dir = std::env::temp_dir().join(format!("motown-store-{}", rand::random::<u32>()));
        std::fs::create_dir_all(&dir).unwrap();
        let s = Store::open(&dir.join("t.db")).unwrap();
        let saved = Saved { status: 200, content_type: "text/html".into(), location: None, body: b"hi".to_vec(), fetched_at: 1 };
        s.put("GET /library/pack/3", &saved);
        assert!(s.has("GET /library/pack/3"));
        s.set_pack_version(3, Some("v1"));
        assert_eq!(s.pack_versions(), vec![(3, Some("v1".to_string()))]);
        s.forget_pack(3);
        assert!(!s.has("GET /library/pack/3"));
        s.enqueue("POST", "/api/question-answer", Some("application/json"), b"{}");
        assert_eq!(s.pending(), 1);
        let q = s.queued();
        s.dequeue(q[0].id);
        assert_eq!(s.pending(), 0);
    }
}
