const ESC = '\x1b';
const ST = '\x1b\\';
const BEL = '\x07';

/**
 * Detect a terminal graphics protocol from the environment.
 * Returns 'kitty' | 'iterm2' | null.
 */
export function detectTerminal(env = process.env) {
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
export function encode(pngBuffer, format = 'auto') {
  let fmt = format;
  if (fmt === 'auto') {
    fmt = detectTerminal();
    if (!fmt) return null;
  }
  switch (fmt) {
    case 'kitty': return encodeKitty(pngBuffer);
    case 'iterm2': return encodeIterm2(pngBuffer);
    default: throw new Error(`Unknown terminal format: ${fmt}`);
  }
}
