# CLAUDE.md

Notes for Claude / future agents working in this repo.

## What this is

A small Node CLI that renders an HTML string to a PNG via [Blitz](https://github.com/DioxusLabs/blitz) (a Rust HTML/CSS engine — Stylo for CSS, Taffy for layout, Parley for text, Vello for paint) and emits a Kitty or iTerm2 inline-image escape sequence on stdout. Headless CPU rasterization, no GPU. The point: AI agents in a graphics-capable terminal can show the user a styled page without spinning up Chromium.

Pre-0.3.0 used DropFlow (JS) + @napi-rs/canvas. The migration to Blitz lifted the CSS gap (flexbox, grid, real list bullets, border-radius, box-shadow, `background:` shorthand, web fonts, `<img>` tags that actually fetch).

## Architecture

Two languages, three layers:

- **`crates/renderer/`** — Rust crate built as a cdylib + rlib. `src/lib.rs` exposes one async napi function: `renderHtml(html, {width, scale, height?}) -> Buffer<PNG>`.
  - Pinned to `blitz-{traits,dom,html,paint,net}@0.1.0-rc.2`, `anyrender@0.5`, `anyrender_vello_cpu@0.5.1`, `peniko@0.4`. Vello-CPU means no GPU needed; that's the only reason this works headless on CI runners and remote servers.
  - Six Noto TTFs are `include_bytes!`'d into the binary (~160 KB total) so output is identical across platforms. Linux CI doesn't ship Noto by default and macOS has Helvetica — without these the rendering would diverge per host.
  - `src/net_fetcher.rs` is a minimal `blitz_net::Provider` wrapper (pending-request counter + mpsc channel) adapted from himg. The render path awaits all in-flight `<img>` fetches (10 s timeout) before laying out so images contribute to layout instead of resolving as zero-sized boxes.
  - `StdoutGag` in `src/lib.rs` is an RAII fd-redirect (Unix `dup2(open("/dev/null"), 1)`) around the fetch loop because blitz-net 0.1.0-rc.2 unconditionally `println!("Success {url}")` on every successful fetch — which would otherwise corrupt the Kitty escape sequence we write back on the same fd. Drop on exit restores the saved fd.
  - The napi async fn can't be `Send` because `HtmlDocument` holds Stylo trait objects that aren't `Send`/`Sync`. Worked around by moving the whole render into a `tokio::task::spawn_blocking` worker that spins up its own per-call current-thread tokio runtime for the network fetch. See `render_html` → `render_sync_inner` → `render_async`.
  - `examples/spike.rs` is a standalone debug binary that calls the same `render_sync` core. Build with `cargo run --example spike --no-default-features -- input.html output.png`. The `--no-default-features` skips the `napi-binding` feature so the binary doesn't try to link Node's `_napi_*` symbols at standalone-binary link time.
- **`crates/renderer/index.cjs`** — tiny platform-selector that picks the right `.node` binary based on `process.platform` + `process.arch` + `detect-libc`. Loads the local build in dev (`crates/renderer/kittyhtml-native.<target>.node`); falls back to `require('kittyhtml-<target>')` in production where it resolves the platform-specific subpackage from optionalDependencies.
- **`src/`** — Node-side JS.
  - `render.js` is a thin shim that lazy-requires `crates/renderer/index.cjs` and calls the native function.
  - `cli.js` is argparse + stdin + the defaults. Two adaptive defaults landed in 0.3.1/0.3.2:
    - **`--width`**: terminal pixel width when stdout is a TTY (`process.stdout.columns * 9`, clamped to 400..2400); otherwise 1200.
    - **`--scale`**: 2 when output is heading to a graphics-capable TTY (no `--out`, stdout is TTY); 1 when writing to file. Reasoning: terminals are essentially all HiDPI now, and rendering at scale 1 means the kitty protocol displays the image at half its intended on-screen size.
  - `protocols.js` is the Kitty/iTerm2 escape encoder + terminal detector.

## Rendering pipeline (Rust side)

```
HTML string
  → NetFetcher::new()                  [mpsc-backed blitz-net wrapper]
  → HtmlDocument::from_html (DocumentConfig + bundled FontContext + provider)
  → set_viewport(scaled_w, scaled_h, scale, ColorScheme::Light)
  → { StdoutGag scope }
      fetcher.fetch_resources(&mut doc).await  [drains <img> etc., 10s timeout]
  → document.resolve()                  [style + layout]
  → anyrender::render_to_buffer::<VelloCpuImageRenderer, _>(
        |scene| paint_scene(scene, doc, scale, w, h))
  → alpha-scan crop to actual content (auto-height only)
  → png crate encodes to PNG bytes
```

Auto-height note: `final_layout.size.height` and `final_layout.content_size.height` under-report content extent in blitz-dom 0.1.4 — the painter itself uses `unrounded_layout` instead, and even walking that tree via `paint_children` didn't produce an accurate measurement in our testing. The pragmatic fix is to render at a generously tall canvas (3000 scaled px) and crop the buffer by finding the last row that differs from the canvas-fill color. ~12 ms on M1 for 1600x3000 RGBA — cheap enough.

## Local development

```sh
npm install
. "$HOME/.cargo/env"
npm run build              # napi build → crates/renderer/kittyhtml-native.<target>.node
node src/cli.js --demo --width 700 --out examples/demo.png    # smoke test
node src/cli.js --demo                                        # display in graphics terminal
```

`examples/demo.html` is the canonical "what HTML for kittyhtml looks like" — flexbox row, grid, rounded card with shadow, native `<ul>` bullets, `<style>` block with class selectors. If the renderer changes, re-render and visually diff `examples/demo.png` before committing.

The CLI defaults differ between TTY and file output (see `defaultWidth` and the post-parse scale fixup in `cli.js`). When generating `examples/demo.png` always pass an explicit `--width` so the committed image is reproducible across machines.

## Cargo / Rust notes

- napi-rs deps are gated behind the `napi-binding` feature (default-on) so the `examples/spike.rs` binary builds without trying to link Node's `_napi_*` symbols at standalone-binary link time. The example version of spike runs the full `render_async` path via a per-call current-thread tokio runtime.
- The crate sits standalone inside `crates/renderer/`. There's no workspace `Cargo.toml` at the repo root — `napi build` is pointed at the inner manifest via `--manifest-path`.
- Cold compile of Blitz + Vello + Stylo + openssl-vendored + blitz-net pulls ~500 crates, ~3–4 minutes on a `macos-latest` runner. Warm cache (`Swatinem/rust-cache` in CI) is closer to ~30 seconds.
- Binary size: ~15 MB stripped per platform.
- openssl is pulled in with `features = ["vendored"]` so the Linux build doesn't need `libssl-dev` at runtime on user machines.

## Publishing

OIDC trusted publishing via GitHub Actions; no long-lived `NPM_TOKEN` ever touches the repo or Actions secrets. The umbrella `kittyhtml` package has `optionalDependencies` on three platform-specific subpackages — `kittyhtml-darwin-arm64`, `kittyhtml-darwin-x64`, `kittyhtml-linux-x64-gnu` — and `npm` installs only the one matching the host.

Release loop:

```sh
npm version patch    # or minor / major — bumps package.json and tags
git push --follow-tags
```

That's the whole thing. The `Publish to npm` workflow fires on the `v*` tag and:

1. Builds the native binary on three matrix runners (macos-latest × {arm64, x64}, ubuntu-latest × x64).
2. Downloads all artifacts to a single publish job.
3. Stamps the umbrella's `version` into every `npm/<target>/package.json` AND into the umbrella's `optionalDependencies` block, so versions stay locked in step automatically.
4. Publishes each platform subpackage with `--provenance`, then the umbrella.

Trusted publishing is configured separately on each of the four packages' npmjs.com settings pages — repo `kkukshtel/kittyhtml`, workflow `publish.yml`, no environment.

If the workflow fails partway through publish, npm doesn't allow re-publishing the same version; bump version and retry. Build failures don't reach publish (job is gated on `needs: build`).

## Things to avoid

- Don't reintroduce DropFlow or `@napi-rs/canvas` deps. The whole v0.3 swap was to escape them.
- Don't reach for headless Chrome / Puppeteer — the whole value is "no browser." If a request needs real-browser fidelity, decline and suggest a different tool.
- Don't add new heavyweight JS deps. The JS side is basically stdin/argparse + a native call; keep it that way.
- Don't read `final_layout` to compute auto-height. It's a known-bad path in blitz-dom 0.1.4 (see `crates/renderer/src/lib.rs` comments). Use the alpha-scan crop.
- Don't write `println!` from Rust unless you're inside the `StdoutGag` scope, and don't put non-render work inside that scope. The fd-1 redirect is real and any production diagnostic should go to `eprintln!`.
- Don't manually edit `npm/<target>/package.json` versions or the umbrella's `optionalDependencies` versions — the workflow stamps them from `package.json`'s top-level `version`. Manual edits will get overwritten on the next release.
- Don't skip hooks or amend commits unless explicitly asked.
