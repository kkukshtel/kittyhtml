# kittyhtml

Render HTML to an image and display it inline in a graphics-capable terminal (Kitty, WezTerm, Ghostty, iTerm2).

This is **not** a headless browser. It's a thin CLI that pipes HTML through [Blitz](https://github.com/DioxusLabs/blitz) — a Rust HTML/CSS engine (Stylo + Taffy + Parley + Vello-CPU) — to a PNG, then emits the Kitty graphics protocol or iTerm2 inline-image protocol on stdout. Headless CPU rasterization, no GPU.

Built for AI agents that have something nice to show you — a styled report, a small table, a card — without taking over your screen with a browser.

## Install

```sh
npm install -g kittyhtml
```

Or one-shot, no install:

```sh
npx kittyhtml --demo
```

Requires Node 20+. The native renderer ships as a prebuilt N-API binary per platform — macOS arm64, macOS x64, Linux x64 — selected automatically at install time. No Rust toolchain required on user machines.

## Use

```sh
kittyhtml --demo                          # bundled demo page
echo '<h1>hi</h1>' | kittyhtml            # adapt to your terminal
kittyhtml report.html -o report.png       # write PNG to file
cat data.html | kittyhtml --width 1200    # explicit width
```

### Options

| flag | default | description |
|---|---|---|
| `--width N` | terminal width (TTY) / `1200` (file) | viewport width in CSS px |
| `--height N` | *auto-fit* | fixed canvas height |
| `--scale N` | `2` (TTY) / `1` (file) | pixel ratio; HiDPI-default since most terminals are retina |
| `--background CSS` | — | fill canvas before painting, e.g. `#fff` |
| `--format auto\|kitty\|iterm2` | `auto` | output protocol; auto-detected from `$TERM`/`$TERM_PROGRAM` |
| `--out, -o PATH` | — | write PNG to file (use `-` for raw PNG on stdout) |
| `--demo` | — | render the bundled demo page |

The two adaptive defaults mean a bare `echo HTML | kittyhtml` Just Works — the image fills your terminal at retina-sharp resolution. Pass explicit `--width` / `--scale` for fixed-size output (screenshots, etc.).

### As a library

```js
import { renderHtml, encode } from 'kittyhtml';

const png = await renderHtml('<h1>hello</h1>', { width: 400, scale: 2 });
process.stdout.write(encode(png, 'kitty'));
```

## CSS

Blitz implements a serious subset of CSS: flexbox, grid, `border-radius`, `box-shadow`, web fonts, `<img>` tags (HTTPS, fetched at render time), `background:` shorthand, `max-width`, native `<ul>`/`<ol>` markers, `<style>` blocks with class selectors. Most of what you'd put in a marketing page or a report works. Two known gotchas as of Blitz 0.1.0-rc.2:

- **`<thead>` content paints empty.** Use plain `<tr>` rows styled with `font-weight: 700` instead.
- **Fixed widths larger than `--width` overflow the canvas.** Stick to `width: 100%` / `max-width` for elements that should fit.

The full status matrix lives in [the Blitz repo](https://github.com/DioxusLabs/blitz).

## Fonts

`Noto Sans` (regular / bold / italic / bold-italic) and `Noto Sans Mono` (regular / bold) are baked into the native binary as latin-subset TTFs. No system-font dependency; renders identically on macOS and Linux. Reference them in HTML:

```css
font-family: 'Noto Sans', sans-serif;
font-family: 'Noto Sans Mono', monospace;
```

Other fonts fall back to system defaults, which on Linux CI is "nothing pretty."

## Claude Code skill

A bundled skill lets Claude Code render output as a styled inline image when you ask for it as "kittyhtml" or "khtml":

```sh
mkdir -p ~/.claude/skills
cp -r "$(npm root -g)/kittyhtml/skill/kittyhtml" ~/.claude/skills/
```

Then in any Claude Code session: *"give me this report as kittyhtml"* — the agent will generate HTML, pipe it through this CLI, and the image lands inline in your terminal. The skill is narrow on purpose; it only triggers on those keywords.

## How agents should use it

If you're an AI agent on a host with `kittyhtml` installed and the user is on a graphics-capable terminal, pipe your HTML through it instead of dumping markup as text:

```sh
echo "$HTML" | kittyhtml
```

The defaults are tuned for that exact case — terminal-width canvas, HiDPI-sharp text. The image lands as one frame in the scrollback. No popups, no browser windows.

## Releasing

Releases publish via GitHub Actions using npm trusted publishing (OIDC, no long-lived token). The native binary is cross-compiled per platform and published as `kittyhtml-darwin-arm64` / `kittyhtml-darwin-x64` / `kittyhtml-linux-x64-gnu`; the umbrella `kittyhtml` package selects the right one at install time via `optionalDependencies`.

```sh
npm version patch    # or minor / major — bumps package.json and tags
git push --follow-tags
```

The `Publish to npm` workflow fires on the `v*` tag, builds all three native binaries, stamps the umbrella's version into every subpackage and into its own `optionalDependencies`, and publishes everything with `--provenance`. The full release loop is that two-line `npm version` + `git push`; the workflow handles version sync and publish.
