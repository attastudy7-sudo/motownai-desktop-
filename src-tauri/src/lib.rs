//! The desktop window. It starts the local server (`motown-core`), then opens the web app
//! from it. Everything else, saving packs and working offline, happens in the core.

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    tauri::Builder::default()
        // Opening the app again focuses the window that's already open (one copy of the data).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let secret = motown_core::random_secret();
            // The site's CSS, JS, fonts and images, shipped inside the installer.
            let bundle_dir = app.path().resource_dir().ok().map(|d| d.join("static")).filter(|d| d.is_dir());
            let cfg = motown_core::Config {
                upstream: motown_core::Config::upstream_from_env(),
                data_dir,
                port: 0,
                secret: Some(secret),
                bundle_dir,
            };
            // The local server lives on Tauri's async runtime for the life of the app.
            let started = tauri::async_runtime::block_on(motown_core::start(cfg))?;
            let local_origin = format!("http://{}", started.addr);
            let boot: url::Url = started.boot_url.parse()?;

            let upstream = motown_core::Config::upstream_from_env();
            let handle = app.handle().clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(boot))
                .title("Motown AI")
                .inner_size(1280.0, 820.0)
                .min_inner_size(900.0, 600.0)
                .center()
                .on_navigation(move |url| navigate(&handle, url, &local_origin, &upstream))
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Motown AI");
}

/// Where the window may go. The app itself stays on the local server; the site's own absolute
/// links (and Google sign-in coming back to motownai.com) are sent through it too; other sites
/// open in the student's normal browser. Google's sign-in pages stay in the window so the
/// session lands in the app.
fn navigate(app: &tauri::AppHandle, url: &url::Url, local_origin: &str, upstream: &url::Url) -> bool {
    let origin = url.origin().ascii_serialization();
    if origin == local_origin || url.scheme() == "about" || url.scheme() == "data" || url.scheme() == "blob" {
        return true;
    }
    let host = url.host_str().unwrap_or("");
    let ours = url.origin() == upstream.origin() || host == "motownai.com" || host == "www.motownai.com";
    if ours {
        let mut local = format!("{local_origin}{}", url.path());
        if let Some(q) = url.query() {
            local.push('?');
            local.push_str(q);
        }
        if let (Some(w), Ok(u)) = (app.get_webview_window("main"), local.parse::<url::Url>()) {
            let _ = w.navigate(u);
        }
        return false;
    }
    if host == "accounts.google.com" || host.ends_with(".google.com") && url.path().starts_with("/o/oauth2") {
        return true;
    }
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = open::that_detached(url.as_str());
    }
    false
}
