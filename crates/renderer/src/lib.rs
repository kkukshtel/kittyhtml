// kittyhtml-renderer: napi-rs binding around Blitz + Vello-CPU.
//
// Exposes a single async function `renderHtml(html, opts) -> Buffer<PNG>`.
// All rendering is headless (no GPU) so this works in CI and on servers.
//
// See README.md / CLAUDE.md for the surrounding context.

use std::io::BufWriter;
use std::sync::Arc;
use std::sync::OnceLock;

use anyrender::render_to_buffer;
use anyrender_vello_cpu::VelloCpuImageRenderer;
use blitz_dom::{DocumentConfig, FontContext};
use blitz_html::HtmlDocument;
use blitz_paint::paint_scene;
use blitz_traits::shell::{ColorScheme, Viewport};
use peniko::Blob;
use png::{BitDepth, ColorType, Encoder};

// Bundled fonts baked into the binary so output is consistent across
// platforms (Linux CI doesn't ship Noto Sans by default; macOS has Helvetica
// not Noto). ~160 KB total.
const FONT_BYTES: &[&[u8]] = &[
    include_bytes!("../../../assets/fonts/NotoSans-Regular.ttf"),
    include_bytes!("../../../assets/fonts/NotoSans-Bold.ttf"),
    include_bytes!("../../../assets/fonts/NotoSans-Italic.ttf"),
    include_bytes!("../../../assets/fonts/NotoSans-BoldItalic.ttf"),
    include_bytes!("../../../assets/fonts/NotoSansMono-Regular.ttf"),
    include_bytes!("../../../assets/fonts/NotoSansMono-Bold.ttf"),
];

/// Lazily-constructed FontContext seeded with the bundled fonts. Cloned per
/// render — the inner Collection/SourceCache are reference-counted internally.
fn font_context() -> FontContext {
    static TEMPLATE: OnceLock<FontContext> = OnceLock::new();
    TEMPLATE
        .get_or_init(|| {
            let mut ctx = FontContext::new();
            for &bytes in FONT_BYTES {
                ctx.collection
                    .register_fonts(Blob::new(Arc::new(bytes.to_vec())), None);
            }
            ctx
        })
        .clone()
}

/// Options accepted by `renderHtml`. CSS-px units. `scale` multiplies the
/// canvas for retina-sharp output.
#[cfg_attr(feature = "napi-binding", napi_derive::napi(object))]
pub struct RenderOptions {
    /// Viewport width in CSS px.
    pub width: u32,
    /// Pixel ratio. 2.0 = retina-sharp.
    pub scale: f64,
    /// Optional fixed canvas height (CSS px). If omitted, the canvas is
    /// auto-fit to the rendered content.
    pub height: Option<u32>,
}

/// Render an HTML string to a PNG. Returns the encoded PNG bytes.
#[cfg(feature = "napi-binding")]
#[napi_derive::napi]
pub async fn render_html(
    html: String,
    opts: RenderOptions,
) -> napi::Result<napi::bindgen_prelude::Buffer> {
    tokio::task::spawn_blocking(move || render_sync(&html, &opts))
        .await
        .map_err(|e| napi::Error::from_reason(format!("join error: {e}")))?
        .map_err(|e| napi::Error::from_reason(format!("render error: {e}")))
        .map(napi::bindgen_prelude::Buffer::from)
}

/// Synchronous worker. Used directly by the spike binary and by the napi
/// wrapper above (via `spawn_blocking`). Blitz's `resolve` + `paint_scene`
/// are CPU-bound, so the napi side wraps this in a worker thread to avoid
/// monopolizing the Node event loop.
pub fn render_sync(html: &str, opts: &RenderOptions) -> Result<Vec<u8>, String> {
    let scale = opts.scale.max(0.01);
    let scaled_width = ((opts.width as f64) * scale).round() as u32;
    let scaled_width = scaled_width.max(1);

    let mut document = HtmlDocument::from_html(
        html,
        DocumentConfig {
            base_url: None,
            net_provider: None,
            font_ctx: Some(font_context()),
            ..Default::default()
        },
    );

    // Auto-fit: render at a generously-tall canvas, then crop the buffer
    // down to the actual content extent via alpha-scan. Cheap on Vello-CPU
    // (~12 ms for a 1600x3000 RGBA buffer on M1) and dodges blitz-dom's
    // layout-introspection issues entirely — neither `final_layout` nor
    // walking `paint_children` against `unrounded_layout` produced an
    // accurate content height as of blitz 0.1.0-rc.2 / 0.1.4.
    let scaled_height = match opts.height {
        Some(h) => ((h as f64) * scale).round() as u32,
        None => (3000.0 * scale.max(1.0)) as u32,
    };

    document.as_mut().set_viewport(Viewport::new(
        scaled_width,
        scaled_height,
        scale as f32,
        ColorScheme::Light,
    ));
    document.as_mut().resolve();

    let buffer = render_to_buffer::<VelloCpuImageRenderer, _>(
        |scene| paint_scene(scene, document.as_ref(), scale, scaled_width, scaled_height),
        scaled_width,
        scaled_height,
    );

    // Crop: when auto-fitting, find the last row whose pixels differ from
    // the canvas-fill color (the bottom row, which is invariably some
    // uniform fill — either the body bg propagated to canvas or transparent).
    let row_bytes = (scaled_width as usize) * 4;
    let crop_h = if opts.height.is_some() {
        scaled_height
    } else {
        let bottom = find_content_bottom(&buffer, scaled_width, scaled_height);
        let margin = (24.0 * scale) as u32;
        (bottom + 1 + margin).min(scaled_height)
    };

    encode_png(&buffer[..(crop_h as usize) * row_bytes], scaled_width, crop_h)
}

/// Find the last row whose pixels differ from the bottom row's fill color.
fn find_content_bottom(buffer: &[u8], width: u32, height: u32) -> u32 {
    let row_bytes = (width as usize) * 4;
    let last_row_start = ((height - 1) as usize) * row_bytes;
    let fill_px = &buffer[last_row_start..last_row_start + 4];
    for y in (0..height).rev() {
        let row_start = (y as usize) * row_bytes;
        let row = &buffer[row_start..row_start + row_bytes];
        if row.chunks_exact(4).any(|px| px != fill_px) {
            return y;
        }
    }
    0
}

fn encode_png(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity((rgba.len() / 2).max(1024));
    {
        let mut encoder = Encoder::new(BufWriter::new(&mut out), width, height);
        encoder.set_color(ColorType::Rgba);
        encoder.set_depth(BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|e| format!("png header: {e}"))?;
        writer
            .write_image_data(rgba)
            .map_err(|e| format!("png data: {e}"))?;
        writer.finish().map_err(|e| format!("png finish: {e}"))?;
    }
    Ok(out)
}
