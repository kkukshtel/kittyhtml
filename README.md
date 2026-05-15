# kittyhtml

Render HTML to an image and display it inline in a graphics-capable terminal (Kitty, WezTerm, Ghostty, iTerm2).

This is **not** a headless browser. It's a thin CLI that pipes HTML through [Blitz](https://github.com/DioxusLabs/blitz) — a Rust HTML/CSS engine (Stylo + Taffy + Parley + Vello) — to a PNG, then emits the Kitty graphics protocol or iTerm2 inline-image protocol on stdout. Headless CPU rasterization, no GPU required.

Built for AI agents that have something nice to show you — a styled report, a small table, a card — without taking over your screen with a browser.

## Install

```sh
npm install -g kittyhtml
```

Or one-shot, no install:

```sh
npx kittyhtml --demo
```

Requires Node 20+. The native renderer ships as a prebuilt N-API binary per platform (macOS arm64, Linux x64). No Rust toolchain required at install time.

## Use

```sh
kittyhtml --demo                              # bundled demo page
echo '<h1>hi</h1>' | kittyhtml --width 400
kittyhtml report.html --scale 2 -o report.png # write PNG to file
```

### Options

| flag | default | description |
|---|---|---|
| `--width N` | `800` | viewport width in CSS px |
| `--height N` | *auto-fit* | fixed canvas height |
| `--scale N` | `1` | pixel ratio (try `2` for retina-sharp text) |
| `--background CSS` | — | fill canvas before painting, e.g. `#fff` |
| `--format auto\|kitty\|iterm2` | `auto` | output protocol; auto-detect from `$TERM`/`$TERM_PROGRAM` |
| `--out, -o PATH` | — | write PNG to file (use `-` for raw PNG on stdout) |
| `--demo` | — | render the bundled demo page |

### As a library

```js
import { renderHtml, encode } from 'kittyhtml';

const png = await renderHtml('<h1>hello</h1>', { width: 400, scale: 2 });
process.stdout.write(encode(png, 'kitty'));
```

## CSS

Blitz implements a serious subset of CSS — flexbox, grid, `border-radius`, `box-shadow`, web fonts, `<img>` tags, `background:` shorthand, `max-width`, native `<ul>` bullets, the things you'd expect. It's pre-alpha for general embedding but works well for our render-once use case. The full status matrix is at [the Blitz repo](https://github.com/DioxusLabs/blitz).

## Fonts

`Noto Sans` (regular, bold, italic, bold-italic) and `Noto Sans Mono` (regular, bold) are baked into the native binary as latin-subset TTFs. No system font dependency; renders identically across macOS and Linux. Reference them in HTML with `font-family: 'Noto Sans', sans-serif` and `font-family: 'Noto Sans Mono', monospace`.

## Claude Code skill

A bundled skill lets Claude Code render output as a styled inline image when you ask for it as "kittyhtml" or "khtml". After a global install:

```sh
mkdir -p ~/.claude/skills
cp -r "$(npm root -g)/kittyhtml/skill/kittyhtml" ~/.claude/skills/
```

Then in any Claude Code session: *"give me this report as kittyhtml"* — the agent will generate HTML and pipe it through this CLI. The skill is narrow on purpose; it only triggers on those keywords.

## How agents should use it

If you're an AI agent on a host with `kittyhtml` installed and the user is on a graphics-capable terminal, pipe your HTML through it instead of dumping markup as text:

```sh
echo "$HTML" | kittyhtml --width 700 --scale 2
```

The image is one frame in the scrollback — no popups, no new windows.

## Releasing

Releases publish via GitHub Actions using npm trusted publishing (OIDC, no long-lived token). The native binary is cross-compiled per platform and published as `@kittyhtml/native-*` packages, then the umbrella `kittyhtml` package selects the right one at install time.

```sh
npm version patch    # or minor / major — bumps package.json and tags
git push --follow-tags
```

The `Publish to npm` workflow fires on the `v*` tag, builds the native binaries on the matrix, and publishes everything with `--provenance`.
