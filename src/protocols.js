import { execFileSync } from 'node:child_process';

const ESC = '\x1b';
const ST = '\x1b\\';
const BEL = '\x07';

/**
 * Detect a terminal graphics protocol from the environment.
 * Returns 'kitty' | 'iterm2' | null.
 */
export function detectTerminal(env = process.env) {
  // Inside tmux, $TERM/$TERM_PROGRAM describe tmux, not the outer terminal.
  // Ask tmux which terminal the attached client is running in.
  if (env.TMUX) {
    const outer = tmuxQuery('#{client_termname}');
    if (outer) return detectTerminal({ TERM: outer });
  }
  if (env.KITTY_WINDOW_ID || env.TERM === 'xterm-kitty') return 'kitty';
  if (env.TERM_PROGRAM === 'WezTerm') return 'kitty';
  if (env.TERM === 'xterm-ghostty' || env.TERM_PROGRAM === 'ghostty') return 'kitty';
  if (env.TERM_PROGRAM === 'iTerm.app' || env.LC_TERMINAL === 'iTerm2') return 'iterm2';
  return null;
}

/**
 * Encode a PNG buffer for the Kitty graphics protocol.
 * https://sw.kovidgoyal.net/kitty/graphics-protocol/
 *
 * The payload is base64-encoded and split into chunks of at most 4096 bytes.
 * Only the first chunk carries the action/format keys; subsequent chunks carry
 * only `m=1` (more) or `m=0` (last).
 */
export function encodeKitty(pngBuffer) {
  const b64 = pngBuffer.toString('base64');
  const chunkSize = 4096;

  if (b64.length <= chunkSize) {
    return `${ESC}_Ga=T,f=100;${b64}${ST}\n`;
  }

  let out = '';
  let i = 0;
  let first = true;
  while (i < b64.length) {
    const slice = b64.slice(i, i + chunkSize);
    i += chunkSize;
    const more = i < b64.length ? 1 : 0;
    if (first) {
      out += `${ESC}_Ga=T,f=100,m=${more};${slice}${ST}`;
      first = false;
    } else {
      out += `${ESC}_Gm=${more};${slice}${ST}`;
    }
  }
  return out + '\n';
}

/**
 * Encode a PNG buffer for the iTerm2 inline image protocol.
 * https://iterm2.com/documentation-images.html
 */
export function encodeIterm2(pngBuffer) {
  const b64 = pngBuffer.toString('base64');
  return `${ESC}]1337;File=inline=1;size=${pngBuffer.length}:${b64}${BEL}\n`;
}

/**
 * Encode a PNG for the chosen format. 'auto' uses detectTerminal().
 * Returns null if format is 'auto' and no graphics-capable terminal was detected.
 */
export function encode(pngBuffer, format = 'auto', opts = {}) {
  let fmt = format;
  if (fmt === 'auto') {
    fmt = detectTerminal();
    if (!fmt) return null;
  }
  switch (fmt) {
    case 'kitty': return process.env.TMUX ? encodeKittyTmux(pngBuffer, opts) : encodeKitty(pngBuffer);
    case 'iterm2': return encodeIterm2(pngBuffer);
    default: throw new Error(`Unknown terminal format: ${fmt}`);
  }
}

/** Run `tmux display -p FORMAT`; returns the trimmed output or null. */
function tmuxQuery(format) {
  try {
    return execFileSync('tmux', ['display', '-p', format], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    return null;
  }
}

/** Wrap one escape sequence in tmux's DCS passthrough (needs allow-passthrough on). */
function tmuxWrap(seq) {
  return `${ESC}Ptmux;${seq.replaceAll(ESC, ESC + ESC)}${ST}`;
}

// Row/column diacritics for Kitty Unicode placeholders, from kitty's
// rowcolumn-diacritics.txt. Index N encodes row (or column) N.
const DIACRITICS = [
  0x0305, 0x030D, 0x030E, 0x0310, 0x0312, 0x033D, 0x033E, 0x033F, 0x0346, 0x034A, 0x034B, 0x034C,
  0x0350, 0x0351, 0x0352, 0x0357, 0x035B, 0x0363, 0x0364, 0x0365, 0x0366, 0x0367, 0x0368, 0x0369,
  0x036A, 0x036B, 0x036C, 0x036D, 0x036E, 0x036F, 0x0483, 0x0484, 0x0485, 0x0486, 0x0487, 0x0592,
  0x0593, 0x0594, 0x0595, 0x0597, 0x0598, 0x0599, 0x059C, 0x059D, 0x059E, 0x059F, 0x05A0, 0x05A1,
  0x05A8, 0x05A9, 0x05AB, 0x05AC, 0x05AF, 0x05C4, 0x0610, 0x0611, 0x0612, 0x0613, 0x0614, 0x0615,
  0x0616, 0x0617, 0x0657, 0x0658, 0x0659, 0x065A, 0x065B, 0x065D, 0x065E, 0x06D6, 0x06D7, 0x06D8,
  0x06D9, 0x06DA, 0x06DB, 0x06DC, 0x06DF, 0x06E0, 0x06E1, 0x06E2, 0x06E4, 0x06E7, 0x06E8, 0x06EB,
  0x06EC, 0x0730, 0x0732, 0x0733, 0x0735, 0x0736, 0x073A, 0x073D, 0x073F, 0x0740, 0x0741, 0x0743,
  0x0745, 0x0747, 0x0749, 0x074A, 0x07EB, 0x07EC, 0x07ED, 0x07EE, 0x07EF, 0x07F0, 0x07F1, 0x07F3,
  0x0816, 0x0817, 0x0818, 0x0819, 0x081B, 0x081C, 0x081D, 0x081E, 0x081F, 0x0820, 0x0821, 0x0822,
  0x0823, 0x0825, 0x0826, 0x0827, 0x0829, 0x082A, 0x082B, 0x082C, 0x082D, 0x0951, 0x0953, 0x0954,
  0x0F82, 0x0F83, 0x0F86, 0x0F87, 0x135D, 0x135E, 0x135F, 0x17DD, 0x193A, 0x1A17, 0x1A75, 0x1A76,
  0x1A77, 0x1A78, 0x1A79, 0x1A7A, 0x1A7B, 0x1A7C, 0x1B6B, 0x1B6D, 0x1B6E, 0x1B6F, 0x1B70, 0x1B71,
  0x1B72, 0x1B73, 0x1CD0, 0x1CD1, 0x1CD2, 0x1CDA, 0x1CDB, 0x1CE0, 0x1DC0, 0x1DC1, 0x1DC3, 0x1DC4,
  0x1DC5, 0x1DC6, 0x1DC7, 0x1DC8, 0x1DC9, 0x1DCB, 0x1DCC, 0x1DD1, 0x1DD2, 0x1DD3, 0x1DD4, 0x1DD5,
  0x1DD6, 0x1DD7, 0x1DD8, 0x1DD9, 0x1DDA, 0x1DDB, 0x1DDC, 0x1DDD, 0x1DDE, 0x1DDF, 0x1DE0, 0x1DE1,
  0x1DE2, 0x1DE3, 0x1DE4, 0x1DE5, 0x1DE6, 0x1DFE, 0x20D0, 0x20D1, 0x20D4, 0x20D5, 0x20D6, 0x20D7,
  0x20DB, 0x20DC, 0x20E1, 0x20E7, 0x20E9, 0x20F0, 0x2CEF, 0x2CF0, 0x2CF1, 0x2DE0, 0x2DE1, 0x2DE2,
  0x2DE3, 0x2DE4, 0x2DE5, 0x2DE6, 0x2DE7, 0x2DE8, 0x2DE9, 0x2DEA, 0x2DEB, 0x2DEC, 0x2DED, 0x2DEE,
  0x2DEF, 0x2DF0, 0x2DF1, 0x2DF2, 0x2DF3, 0x2DF4, 0x2DF5, 0x2DF6, 0x2DF7, 0x2DF8, 0x2DF9, 0x2DFA,
  0x2DFB, 0x2DFC, 0x2DFD, 0x2DFE, 0x2DFF, 0xA66F, 0xA67C, 0xA67D, 0xA6F0, 0xA6F1, 0xA8E0, 0xA8E1,
  0xA8E2, 0xA8E3, 0xA8E4, 0xA8E5, 0xA8E6, 0xA8E7, 0xA8E8, 0xA8E9, 0xA8EA, 0xA8EB, 0xA8EC, 0xA8ED,
  0xA8EE, 0xA8EF, 0xA8F0, 0xA8F1, 0xAAB0, 0xAAB2, 0xAAB3, 0xAAB7, 0xAAB8, 0xAABE, 0xAABF, 0xAAC1,
  0xFE20, 0xFE21, 0xFE22, 0xFE23, 0xFE24, 0xFE25, 0xFE26, 0x10A0F, 0x10A38, 0x1D185, 0x1D186, 0x1D187,
  0x1D188, 0x1D189, 0x1D1AA, 0x1D1AB, 0x1D1AC, 0x1D1AD, 0x1D242, 0x1D243, 0x1D244,
];
const PLACEHOLDER = '\u{10EEEE}';

/**
 * Encode a PNG for the Kitty graphics protocol through tmux.
 *
 * Raw Kitty placements are invisible to tmux, so it overwrites/scrolls them
 * away. Instead we transmit the image via passthrough with virtual placements
 * (U=1) and print Unicode placeholder cells, which tmux treats as ordinary
 * text and redraws/scrolls correctly. The image id rides in the foreground
 * color and the placement id in the underline color.
 * https://sw.kovidgoyal.net/kitty/graphics-protocol/#unicode-placeholders
 */
export function encodeKittyTmux(pngBuffer, opts = {}) {
  const imgW = pngBuffer.readUInt32BE(16);
  const imgH = pngBuffer.readUInt32BE(20);
  const termCols = opts.columns || process.stdout.columns || 80;
  // Width in cells: the CLI sizes the page at ~9 CSS px per column.
  const scale = opts.scale || 1;
  const cols = Math.max(1, Math.min(termCols, Math.round(imgW / scale / 9)));

  let cellRatio = 0.5; // cell width / cell height
  const [cw, ch] = (tmuxQuery('#{client_cell_width} #{client_cell_height}') || '')
    .split(' ').map(Number);
  if (cw > 0 && ch > 0 && cw / ch > 0.3 && cw / ch < 0.8) cellRatio = cw / ch;
  const totalRows = Math.max(1, Math.round(cols * (imgH / imgW) * cellRatio));

  const id = 1 + Math.floor(Math.random() * 0xfffffe);
  const b64 = pngBuffer.toString('base64');
  const chunkSize = 4096;

  // Transmit only (a=t); placements are created per slice below.
  let out = '';
  for (let i = 0; i < b64.length; i += chunkSize) {
    const more = i + chunkSize < b64.length ? 1 : 0;
    const keys = i === 0 ? `a=t,f=100,i=${id},q=2,m=${more}` : `m=${more}`;
    out += tmuxWrap(`${ESC}_G${keys};${b64.slice(i, i + chunkSize)}${ST}`);
  }

  // A placement can address at most DIACRITICS.length rows, so tall images
  // are split into several placements, each showing a horizontal band.
  const maxRows = DIACRITICS.length;
  const fg = `${ESC}[38;2;${(id >> 16) & 255};${(id >> 8) & 255};${id & 255}m`;
  let text = '';
  for (let r0 = 0, pid = 1; r0 < totalRows; r0 += maxRows, pid++) {
    const rows = Math.min(maxRows, totalRows - r0);
    const y = Math.round((r0 / totalRows) * imgH);
    const h = Math.round(((r0 + rows) / totalRows) * imgH) - y;
    out += tmuxWrap(
      `${ESC}_Ga=p,U=1,i=${id},p=${pid},y=${y},h=${h},c=${cols},r=${rows},q=2${ST}`,
    );
    const ul = `${ESC}[58;5;${pid}m`;
    for (let r = 0; r < rows; r++) {
      text += fg + ul + PLACEHOLDER + String.fromCodePoint(DIACRITICS[r])
        + PLACEHOLDER.repeat(cols - 1) + `${ESC}[39;59m\n`;
    }
  }
  return out + text;
}
