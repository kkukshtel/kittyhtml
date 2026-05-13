# CLAUDE.md

Notes for Claude / future agents working in this repo.

## What this is

A small Node CLI that renders an HTML string to a PNG via [DropFlow](https://github.com/chearon/dropflow) (a CSS layout engine, not a browser) and emits a Kitty or iTerm2 inline-image escape sequence on stdout. The point is: AI agents in a graphics-capable terminal can show the user a styled page without spinning up Chromium.

## Architecture

Three modules in `src/`, deliberately kept small and orthogonal:

- `src/render.js` — `renderHtml(html, {width, height, scale, background}) -> Buffer`. Wires DropFlow's `environment.registerFont` and `environment.createDecodedImage` to the `@napi-rs/canvas` backend (one-time, lazy), registers the six bundled Noto TTFs via `flow.createFaceFromTablesSync`, parses HTML through DropFlow, lays out at huge height to measure, then re-lays out at the natural content height and paints. Output is `await canvas.encode('png')`.
- `src/protocols.js` — `encodeKitty(buf)`, `encodeIterm2(buf)`, `detectTerminal(env)`, `encode(buf, format)`. Kitty payload is chunked at 4096-byte base64 boundaries per the spec; only the first chunk carries the `a=T,f=100` keys, subsequent chunks just carry `m=1`/`m=0`.
- `src/cli.js` — argparse + stdin/file input + `--demo` + `--out` glue. Default `--format auto` falls back to whatever `detectTerminal()` picks (Kitty for kitty/WezTerm/Ghostty, iTerm2 for iTerm.app), or errors if neither.

`src/index.js` is the library entrypoint that re-exports `renderHtml` and the protocol encoders. The `bin` entry in `package.json` points at `src/cli.js`.

## DropFlow CSS subset — IMPORTANT

DropFlow 0.6.x is a real CSS engine but not a browser. When generating HTML for it, stay inside this subset or output silently breaks:

- Use `background-color`, **not** `background` shorthand.
- Use `width: Npx`, **not** `max-width` (not implemented).
- No `list-style` markers — fake bullets with `&bull;&nbsp;&nbsp;`.
- No `border-radius`, `box-shadow`, `transform`, `position: absolute/fixed`.
- `<body>` background does NOT propagate to the canvas. Wrap content in a styled `<div>` to fill the image.
- Only inline `style` attributes work — no `<style>` blocks, no `class`.
- Available fonts: `Noto Sans`, `Noto Sans Mono` (bundled in `assets/fonts/`).

The same caveats are encoded in `skill/kittyhtml/SKILL.md` so the bundled Claude skill produces compatible HTML.

## Local development

```sh
npm install
node src/cli.js --demo --out examples/demo.png --scale 2   # smoke test
node src/cli.js --demo                                     # actually display in terminal
```

`examples/demo.html` is the canonical reference for "HTML that renders well under DropFlow." If you touch the renderer, re-run the demo and visually diff `examples/demo.png` before committing.

## Fonts

Six Latin TTFs ship in `assets/fonts/`:

- `NotoSans-Regular.ttf`, `-Bold`, `-Italic`, `-BoldItalic`
- `NotoSansMono-Regular.ttf`, `-Bold`

They're loaded via `createFaceFromTablesSync` which reads weight/style from each font's OS/2 tables — no manual descriptor mapping in `src/render.js`. To add a font, drop the TTF in `assets/fonts/` and append its filename to `BUNDLED_FONTS`.

We deliberately do NOT call DropFlow's `registerNotoFonts()` helper — that one fetches from a CDN on first run and would break offline use.

## Publishing

Releases publish via GitHub Actions using npm **trusted publishing** (OIDC). There is no long-lived `NPM_TOKEN` secret in the repo or in Actions secrets.

How it works:
1. `.github/workflows/publish.yml` runs on `v*` tag push or manual `workflow_dispatch`.
2. The workflow has `permissions: id-token: write`, which makes GitHub provide an OIDC token via env vars.
3. npm 11.5.1+ (installed fresh in the workflow via `npm install -g npm@latest`) sees the OIDC env, exchanges the GitHub token with the npm registry for a one-shot publish token, and runs `npm publish --provenance --access public`.
4. The `--provenance` flag attaches a Sigstore attestation linking the published tarball to the source commit/workflow run.

Configured on the npm side: package settings → Trusted Publishers → GitHub Actions, repo `kkukshtel/kittyhtml`, workflow `publish.yml`, no environment.

### Release loop

```sh
npm version patch     # or `minor` / `major` — bumps package.json and tags v<x.y.z>
git push --follow-tags
```

That's it. The tag push fires the workflow; no token, no OTP. For an out-of-band publish (e.g. testing the workflow), use `gh workflow run publish.yml`.

### First release was different

`v0.1.0` was published manually with an authenticator OTP, because npm's Trusted Publishers UI doesn't expose a "pending publisher" flow for packages that don't exist yet — the settings page only appears once the package is published. Subsequent versions go through the workflow.

## Things to avoid

- Don't add `class` attributes or `<style>` blocks to HTML — DropFlow only honors inline `style`.
- Don't reach for headless Chrome / Puppeteer — the whole value here is "no browser." If a request needs real-browser fidelity, decline and suggest a different tool.
- Don't `npm install` extra heavyweight deps. Two dependencies (`dropflow`, `@napi-rs/canvas`) is the budget; the tarball stays under ~100 KB. We deliberately use `@napi-rs/canvas` over the legacy `canvas` package — the latter drags in 60+ transitive deps via `node-gyp`/`node-pre-gyp`, including several deprecated ones (`inflight`, `npmlog`, `rimraf@3`, `glob@7`, etc.). If something looks like it'd be easier with `canvas`, fix it on the napi-rs side instead.
- Don't write a `NPM_TOKEN` secret into the repo or Actions — the whole publish setup is built around not needing one.
