import * as flow from 'dropflow';
import parse from 'dropflow/parse.js';
import { createCanvas } from 'canvas';

const FONTS_DIR = new URL('../assets/fonts/', import.meta.url);
const BUNDLED_FONTS = [
  'NotoSans-Regular.ttf',
  'NotoSans-Bold.ttf',
  'NotoSans-Italic.ttf',
  'NotoSans-BoldItalic.ttf',
  'NotoSansMono-Regular.ttf',
  'NotoSansMono-Bold.ttf',
];

let fontsReady = false;
function ensureFonts() {
  if (fontsReady) return;
  for (const file of BUNDLED_FONTS) {
    flow.fonts.add(flow.createFaceFromTablesSync(new URL(file, FONTS_DIR)));
  }
  fontsReady = true;
}

/**
 * Render an HTML string to a PNG buffer using DropFlow.
 *
 * @param {string} html
 * @param {object} [opts]
 * @param {number} [opts.width=800]   Viewport width in CSS px before scaling.
 * @param {number|null} [opts.height] Fixed canvas height; if null, auto-fit to content.
 * @param {number} [opts.scale=1]     Pixel ratio (2 = retina-sharp).
 * @param {string|null} [opts.background] Optional canvas background fill (CSS color).
 * @returns {Promise<Buffer>} PNG image bytes.
 */
export async function renderHtml(html, opts = {}) {
  const { width = 800, height = null, scale = 1, background = null } = opts;
  ensureFonts();

  const root = parse(html);
  await flow.load(root);

  const pxWidth = Math.max(1, Math.round(width * scale));
  const layout = flow.generate(root);

  let pxHeight;
  if (height != null) {
    pxHeight = Math.max(1, Math.round(height * scale));
    flow.layout(layout, pxWidth, pxHeight);
  } else {
    flow.layout(layout, pxWidth, 1_000_000);
    const measured = layout.getBorderArea().height;
    pxHeight = Math.max(1, Math.ceil(measured));
    flow.layout(layout, pxWidth, pxHeight);
  }

  const canvas = createCanvas(pxWidth, pxHeight);
  const ctx = canvas.getContext('2d');
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, pxWidth, pxHeight);
  }
  flow.paintToCanvas(layout, ctx);
  return canvas.toBuffer('image/png');
}
