#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderHtml } from './render.js';
import { encode, detectTerminal } from './protocols.js';

const HELP = `kittyhtml — render HTML to an image and display it inline in the terminal.

USAGE
  kittyhtml [FILE] [options]
  cat page.html | kittyhtml [options]
  kittyhtml --demo

OPTIONS
  --width N         Viewport width in CSS px (default: terminal width when
                    rendered to a TTY, else 1200).
  --height N        Fixed canvas height; omit to auto-fit content.
  --scale N         Pixel ratio for crisper output (default: 2 when piping
                    to a graphics-capable terminal, 1 when writing to file).
  --background CSS  Fill canvas background before painting (e.g. "#fff").
  --format FMT      Output protocol: auto | kitty | iterm2 (default auto).
  --out, -o PATH    Write PNG to PATH instead of stdout. ("-" = stdout PNG)
  --demo            Render a bundled demo page.
  --help, -h        Show this help.

EXAMPLES
  kittyhtml --demo
  echo '<h1>hi</h1>' | kittyhtml --width 400
  kittyhtml report.html --scale 2 -o report.png
`;

// When stdout is a terminal, estimate its visible width in pixels so the
// rendered image fits the terminal at 1:1 instead of looking small. The
// estimate is `columns * 9` — a rough cell-width assumption that's close
// enough on macOS terminals at default zoom. Clamped so we don't render
// a wallpaper for someone with a 400-column tmux pane.
function defaultWidth() {
  if (process.stdout.isTTY && typeof process.stdout.columns === 'number') {
    const cols = process.stdout.columns;
    return Math.max(400, Math.min(2400, cols * 9));
  }
  return 1200;
}

function parseArgs(argv) {
  const opts = {
    width: defaultWidth(),
    height: null,
    // null sentinel: filled in after arg parse based on output destination.
    scale: null,
    background: null,
    format: 'auto',
    out: null,
    demo: false,
    file: null,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) {
        process.stderr.write(`kittyhtml: missing value for ${a}\n`);
        process.exit(2);
      }
      return v;
    };
    switch (a) {
      case '--demo': opts.demo = true; break;
      case '--width': opts.width = Number(next()); break;
      case '--height': opts.height = Number(next()); break;
      case '--scale': opts.scale = Number(next()); break;
      case '--background': case '--bg': opts.background = next(); break;
      case '--format': opts.format = next(); break;
      case '--out': case '-o': opts.out = next(); break;
      case '--help': case '-h': process.stdout.write(HELP); process.exit(0);
      default:
        if (a.startsWith('-')) {
          process.stderr.write(`kittyhtml: unknown option ${a}\n`);
          process.exit(2);
        }
        positional.push(a);
    }
  }
  if (positional.length > 1) {
    process.stderr.write(`kittyhtml: too many positional arguments\n`);
    process.exit(2);
  }
  if (positional[0]) opts.file = positional[0];

  if (opts.scale == null) {
    // Going to a graphics-capable terminal → assume HiDPI (every modern
    // mac and most linux laptops). The terminal will downscale the larger
    // PNG to fill the same on-screen area, giving retina-sharp text. File
    // output stays at 1:1 since the user knows they want the literal pixel
    // count they asked for.
    opts.scale = opts.out == null && process.stdout.isTTY ? 2 : 1;
  }

  return opts;
}

function loadDemoHtml() {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(here, '..', 'examples', 'demo.html'), 'utf8');
}

// readFileSync(0) crashes with EAGAIN when stdin is in non-blocking mode and
// the upstream process hasn't flushed yet (common with `claude -p ... | kittyhtml`).
// Async iteration over process.stdin yields back to the event loop and waits
// for data, so it handles any pipe pacing correctly.
async function readStdin() {
  process.stdin.setEncoding('utf8');
  let buf = '';
  for await (const chunk of process.stdin) buf += chunk;
  return buf;
}

// The native renderer only bundles latin-subset Noto fonts and its generic
// family fallback (sans-serif, monospace, ...) never reaches a CJK font, so
// Chinese/Japanese/Korean text renders as tofu boxes. Named system fonts do
// work, so splice CJK-capable families into every font stack. Override the
// list with $KITTYHTML_CJK_FONTS (comma-separated CSS family list).
const CJK_FONTS = process.env.KITTYHTML_CJK_FONTS ||
  '"Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", "SimHei"';
const GENERIC_FAMILY = /,?\s*\b(sans-serif|serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+)\s*(!important)?\s*$/i;

function addCjkToStack(value, fonts = CJK_FONTS) {
  if (/^\s*(inherit|initial|unset|revert)\s*$/i.test(value)) return value;
  const m = value.match(GENERIC_FAMILY);
  if (m) {
    const head = value.slice(0, m.index).trimEnd();
    const tail = m[0].replace(/^,?\s*/, '');
    return `${head ? head + ', ' : ''}${fonts}, ${tail}`;
  }
  return value.replace(/\s*(!important)?\s*$/, (_, imp) => `, ${fonts}${imp ? ' ' + imp : ''}`);
}

// `attrQuote` is the quote char of the enclosing style="" attribute, if any;
// the injected family names must use the other one.
function patchCss(css, attrQuote) {
  const fonts = attrQuote === '"' ? CJK_FONTS.replaceAll('"', "'")
    : attrQuote === "'" ? CJK_FONTS.replaceAll("'", '"') : CJK_FONTS;
  return css
    .replace(/(font-family\s*:)([^;}]*)/gi, (_, prop, v) => prop + addCjkToStack(v, fonts))
    // `font:` shorthand ends with the family list; only touch ones that
    // actually carry a size (and therefore a family).
    .replace(/(\bfont\s*:)([^;}]*\d(?:px|pt|em|rem|%)[^;}]*)/gi,
      (_, prop, v) => prop + addCjkToStack(v, fonts));
}

function addCjkFallback(html) {
  html = html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_, open, css, close) => open + patchCss(css) + close);
  html = html.replace(/(\sstyle\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi,
    (_, attr, dq, sq) => dq != null ? `${attr}"${patchCss(dq, '"')}"` : `${attr}'${patchCss(sq, "'")}'`);
  // Base stack for documents that never set a font.
  const base = `<style>:root{font-family:"Noto Sans", ${CJK_FONTS}, sans-serif}</style>`;
  // Insert after <head>, else <html>, else the doctype, so the parser never
  // sees content before them.
  for (const re of [/<head\b[^>]*>/i, /<html\b[^>]*>/i, /<!doctype[^>]*>/i]) {
    if (re.test(html)) return html.replace(re, m => m + base);
  }
  return base + html;
}

// Blitz resolves a table's percentage width against its grandparent instead
// of its parent, so `width: 100%` ignores the parent's padding and overflows
// it. Giving every table its own wrapper div makes it resolve correctly.
function wrapTables(html) {
  return html
    .replace(/<table\b/gi, '<div><table')
    .replace(/<\/table\s*>/gi, '</table></div>');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  let html;
  if (opts.demo) {
    html = loadDemoHtml();
  } else if (opts.file) {
    html = readFileSync(opts.file, 'utf8');
  } else if (!process.stdin.isTTY) {
    html = await readStdin();
  } else {
    process.stdout.write(HELP);
    process.exit(1);
  }

  const png = await renderHtml(wrapTables(addCjkFallback(html)), opts);

  if (opts.out) {
    if (opts.out === '-') {
      process.stdout.write(png);
    } else {
      writeFileSync(opts.out, png);
      process.stderr.write(`kittyhtml: wrote ${opts.out} (${png.length} bytes)\n`);
    }
    return;
  }

  const encoded = encode(png, opts.format, { scale: opts.scale });
  if (encoded == null) {
    const term = process.env.TERM || '';
    const tp = process.env.TERM_PROGRAM || '';
    process.stderr.write(
      `kittyhtml: no graphics-capable terminal detected (TERM=${term}, TERM_PROGRAM=${tp}).\n` +
      `  Use --format kitty|iterm2 to force, or --out FILE to write a PNG.\n`,
    );
    process.exit(2);
  }
  process.stdout.write(encoded);
}

main().catch(err => {
  process.stderr.write(`kittyhtml: ${err.stack || err.message}\n`);
  process.exit(1);
});
