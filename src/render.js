import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Loaded lazily so importing this module doesn't pay the .node init cost
// until someone actually renders.
let _native = null;
function native() {
  if (_native == null) _native = require('../crates/renderer/index.cjs');
  return _native;
}

/**
 * Render an HTML string to a PNG buffer via Blitz + Vello-CPU.
 *
 * @param {string} html
 * @param {object} [opts]
 * @param {number} [opts.width=800]   Viewport width in CSS px before scaling.
 * @param {number|null} [opts.height] Fixed canvas height; if null, auto-fit to content.
 * @param {number} [opts.scale=1]     Pixel ratio (2 = retina-sharp).
 * @returns {Promise<Buffer>} PNG image bytes.
 */
export async function renderHtml(html, opts = {}) {
  const { width = 800, height = null, scale = 1 } = opts;
  const nativeOpts = {
    width: Math.max(1, Math.round(width)),
    scale: Math.max(0.01, scale),
  };
  if (height != null) nativeOpts.height = Math.max(1, Math.round(height));
  return await native().renderHtml(html, nativeOpts);
}
