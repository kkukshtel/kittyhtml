// Debug binary — calls the same render path as the napi binding, but writes
// to a file instead of returning a Buffer. Useful for `cargo run --bin spike`
// when iterating on the Rust side without going through Node.

use std::env;
use std::fs;
use std::path::PathBuf;

use kittyhtml_renderer::{render_sync, RenderOptions};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 {
        eprintln!("usage: spike <input.html> <output.png> [width=800] [scale=2]");
        std::process::exit(2);
    }
    let input = PathBuf::from(&args[1]);
    let output = PathBuf::from(&args[2]);
    let width: u32 = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(800);
    let scale: f64 = args.get(4).and_then(|s| s.parse().ok()).unwrap_or(2.0);

    let html = fs::read_to_string(&input)?;
    let png = render_sync(
        &html,
        &RenderOptions {
            width,
            scale,
            height: None,
        },
    )?;
    fs::write(&output, &png)?;
    eprintln!("[spike] wrote {} ({} bytes)", output.display(), png.len());
    Ok(())
}
