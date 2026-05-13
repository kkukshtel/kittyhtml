# kittyhtml

Render HTML to an image and display it inline in a graphics-capable terminal (Kitty, WezTerm, Ghostty, iTerm2).

This is **not** a headless browser. It's a thin CLI that pipes HTML through [DropFlow](https://github.com/chearon/dropflow) (a real CSS layout engine, no JS/no Chromium) to a PNG, then emits the Kitty graphics protocol or iTerm2 inline-image protocol on stdout.

Built for AI agents that have something nice to show you — a styled report, a small table, a card — without taking over your screen with a browser.

## Install

```sh
# from this directory, until published
npm install
npm link        # exposes the `kittyhtml` binary on your PATH
```

Requires Node 20+. Pulls in [`@napi-rs/canvas`](https://www.npmjs.com/package/@napi-rs/canvas) (prebuilt native binary, no compile step) and `dropflow`.

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

## Releasing

Releases publish via GitHub Actions using npm trusted publishing (OIDC, no long-lived token). To cut a release:

```sh
npm version patch    # or minor / major — bumps package.json and tags
git push --follow-tags
```

The `Publish to npm` workflow fires on the `v*` tag, exchanges a GitHub OIDC token with npm for a one-shot publish token, and publishes with `--provenance` so each release carries a Sigstore attestation linking it back to the source commit.

## CSS caveats

DropFlow implements a serious subset of CSS but isn't a browser. Things to know when writing HTML for it (as of DropFlow 0.6.x):

- Use the longhand `background-color`, not the `background` shorthand.
- `max-width` / `min-width` aren't supported yet — use `width`.
- `list-style` markers don't render; use `&bull;` or numbers inline.
- `border-radius`, `box-shadow`, `transform`, and `position: absolute/fixed` aren't supported yet.
- Body background doesn't propagate to the canvas — set the background on a wrapper element, or pass `--background <css>` to fill the canvas.

See the [DropFlow README](https://github.com/chearon/dropflow#supported-css-rules) for the full support matrix.

## Fonts

First run fetches Noto fonts from a CDN via DropFlow's bundled `register-noto-fonts.js`. Subsequent renders reuse what was loaded. Bundled offline fonts are on the roadmap.

## Claude Code skill

A bundled skill lets Claude Code render output as a styled inline image when you ask for it as "kittyhtml" or "khtml":

```sh
mkdir -p ~/.claude/skills
cp -r skill/kittyhtml ~/.claude/skills/kittyhtml
```

Then in any Claude Code session: *"give me this report as kittyhtml"* — the agent will generate DropFlow-compatible HTML and pipe it through this CLI. The skill is narrow on purpose; it only triggers on those keywords.

## How agents should use it

If you're an AI agent on a host with `kittyhtml` installed and the user is on a graphics-capable terminal, pipe your HTML through it instead of dumping markup as text:

```sh
echo "$HTML" | kittyhtml --width 700 --scale 2
```

The image is one frame in the scrollback — no popups, no new windows.
