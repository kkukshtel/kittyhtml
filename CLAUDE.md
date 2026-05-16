# CLAUDE.md

Notes for Claude / future agents working in this repo.

## What this is

A small Node CLI that renders an HTML string to a PNG via [Blitz](https://github.com/DioxusLabs/blitz) (a Rust HTML/CSS engine — Stylo for CSS, Taffy for layout, Parley for text, Vello for paint) and emits a Kitty or iTerm2 inline-image escape sequence on stdout. Headless CPU rasterization. The point: AI agents in a graphics-capable terminal can show the user a styled page without spinning up Chromium.

Pre-0.3.0 used DropFlow (JS) + @napi-rs/canvas. The migration to Blitz lifted the CSS gap (flexbox, grid, real list bullets, border-radius, box-shadow, `background:` shorthand).

## Architecture

Two languages, three layers:

- **`crates/renderer/`** — Rust crate built as a cdylib + rlib. `src/lib.rs` exposes one async napi function: `renderHtml(html, {width, scale, height?}) -> Buffer<PNG>`. All the real work happens here.
  - Pinned to `blitz-{traits,dom,html,paint,net}@0.1.0-rc.2`, `anyrender@0.5`, `anyrender_vello_cpu@0.5.1`. The Vello-CPU backend means no GPU needed.
  - Six Noto TTFs are `include_bytes!`'d into the binary so output is consistent across platforms (Linux CI doesn't have Noto by default).
  - `src/net_fetcher.rs` is a minimal blitz-net wrapper (pending counter + mpsc channel) adapted from himg. The render path awaits all in-flight `<img>` fetches (10s timeout) before laying out so images actually paint instead of zero-sized blanks.
  - `examples/spike.rs` is a standalone debug binary that calls the same `render_async` core via a per-call tokio runtime. Build with `cargo run --example spike --no-default-features -- input.html output.png`. The `--no-default-features` skips the `napi-binding` feature so the binary doesn't try to link Node's `_napi_*` symbols.
- **`crates/renderer/index.cjs`** — tiny platform-selector. Picks the right `.node` binary based on `process.platform` + `process.arch` + libc detection. Falls back to a `@kittyhtml/native-*` subpackage in production (Phase 4 wires that up); loads the local build in dev.
- **`src/`** — Node-side JS. `render.js` is now a thin shim that lazy-requires `index.cjs` and calls the native function. `protocols.js` and `cli.js` are unchanged from the DropFlow era.

## Rendering pipeline (Rust side)

```
HTML string
  → NetFetcher::new()                [mpsc-backed blitz-net wrapper]
  → HtmlDocument::from_html (DocumentConfig with bundled FontContext + provider)
  → set_viewport(scaled_w, scaled_h, scale, ColorScheme::Light)
  → fetcher.fetch_resources(&mut doc).await    [drains <img> etc., 10s timeout]
  → document.resolve()              [style + layout]
  → anyrender::render_to_buffer::<VelloCpuImageRenderer, _>(
        |scene| paint_scene(scene, doc, scale, w, h)
    )                                [→ RGBA buffer]
  → alpha-scan crop to actual content (auto-height only)
  → png crate encodes to PNG bytes
```

Auto-height note: `final_layout.size.height` and `final_layout.content_size.height` under-report content extent in blitz-dom 0.1.4 — the painter pointedly uses `unrounded_layout` instead, and even walking that via `paint_children` didn't produce an accurate measurement in our testing. The pragmatic fix is to render at a generously tall canvas (3000 scaled px) and crop the buffer by finding the last row that differs from the canvas-fill color. ~12 ms on M1 for 1600x3000 RGBA. Phase 2 commit message has the longer trace.

## Local development

```sh
npm install
. "$HOME/.cargo/env"
npm run build              # napi build → crates/renderer/kittyhtml-native.<platform>.node
node src/cli.js --demo --out examples/demo.png --scale 2   # smoke test
node src/cli.js --demo                                     # display in graphics terminal
```

`examples/demo.html` is the canonical "what HTML for kittyhtml looks like" — flexbox row, grid, rounded card with shadow, native ul bullets. If the renderer changes, re-render and visually diff `examples/demo.png` before committing.

## Cargo / Rust notes

- napi-rs deps are gated behind the `napi-binding` feature (default-on) so the `examples/spike.rs` binary builds without trying to link Node's `_napi_*` symbols at standalone-binary link time.
- The crate is a workspace member... wait, no, it's a standalone crate inside `crates/renderer/` referenced explicitly by napi build flags. Adding a top-level workspace `Cargo.toml` would be cleaner if we add more crates.
- Cold compile of Blitz + Vello + Stylo pulls hundreds of crates, ~90 s on M1. Warm cache is ~3 s for small changes.
- Binary size: ~15 MB stripped per platform.

## Publishing

OIDC trusted publishing via GitHub Actions, no long-lived `NPM_TOKEN`. The umbrella `kittyhtml` package depends on per-platform `@kittyhtml/native-*` packages (Phase 4 builds the matrix). To release: `npm version patch && git push --follow-tags`. Workflow fires on the `v*` tag.

## Things to avoid

- Don't reintroduce DropFlow or `@napi-rs/canvas` deps. The whole v0.3 swap was to escape them.
- Don't reach for headless Chrome / Puppeteer — the whole value is "no browser." If a request needs real-browser fidelity, decline and suggest a different tool.
- Don't add new heavyweight JS deps. The JS side is basically stdin/argparse + a native call; keep it that way.
- Don't read `final_layout` to compute auto-height. It's a known-bad path in blitz-dom 0.1.4 (see `crates/renderer/src/lib.rs` comments). Use the alpha-scan crop instead.
- Don't skip hooks or amend commits unless explicitly asked.
