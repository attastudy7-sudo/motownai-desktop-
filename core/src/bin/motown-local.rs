//! Run the desktop app's local server without the window, for development:
//!
//!   MOTOWN_UPSTREAM=http://127.0.0.1:5000 cargo run -p motown-core --bin motown-local
//!
//! then open the printed address in a browser.

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();
    let data_dir = std::env::var("MOTOWN_DATA").map(Into::into).unwrap_or_else(|_| std::env::temp_dir().join("motown-desktop-dev"));
    let port = std::env::var("MOTOWN_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8787);
    let started = motown_core::start(motown_core::Config {
        upstream: motown_core::Config::upstream_from_env(),
        data_dir,
        port,
        secret: None,
        bundle_dir: Some(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../bundle/static")),
    })
    .await?;
    println!("Motown AI (local) on {}", started.boot_url);
    tokio::signal::ctrl_c().await?;
    Ok(())
}
