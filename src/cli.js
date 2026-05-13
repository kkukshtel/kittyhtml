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
  --width N         Viewport width in CSS px (default 800).
  --height N        Fixed canvas height; omit to auto-fit content.
  --scale N         Pixel ratio for crisper output (default 1; try 2).
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

function parseArgs(argv) {
  const opts = {
    width: 800,
    height: null,
    scale: 1,
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
  return opts;
}

function loadDemoHtml() {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(here, '..', 'examples', 'demo.html'), 'utf8');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  let html;
  if (opts.demo) {
    html = loadDemoHtml();
  } else if (opts.file) {
    html = readFileSync(opts.file, 'utf8');
  } else if (!process.stdin.isTTY) {
    html = readFileSync(0, 'utf8');
  } else {
    process.stdout.write(HELP);
    process.exit(1);
  }

  const png = await renderHtml(html, opts);

  if (opts.out) {
    if (opts.out === '-') {
      process.stdout.write(png);
    } else {
      writeFileSync(opts.out, png);
      process.stderr.write(`kittyhtml: wrote ${opts.out} (${png.length} bytes)\n`);
    }
    return;
  }

  const encoded = encode(png, opts.format);
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
