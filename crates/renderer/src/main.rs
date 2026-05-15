// kittyhtml renderer — Phase 1 spike.
//
// Reads an HTML file path, writes a PNG file. Verifies that Blitz + Vello-CPU
// can render headless on macOS without a GPU. No napi yet, no API surface yet,
// no font wiring — just the simplest possible pipeline so we can eyeball the
// output and decide whether the migration plan stands.

use std::env;
use std::fs;
use std::io::BufWriter;
use std::path::PathBuf;

use anyrender::render_to_buffer;
use anyrender_vello_cpu::VelloCpuImageRenderer;
use blitz_dom::DocumentConfig;
use blitz_html::HtmlDocument;
use blitz_paint::paint_scene;
use blitz_traits::shell::{ColorScheme, Viewport};
use png::{BitDepth, ColorType, Encoder};

fn walk_max_bottom(doc: &blitz_dom::BaseDocument, node_id: usize, parent_abs_y: f32, max_bottom: &mut f32) {
    let Some(node) = doc.get_node(node_id) else { return };
    let abs_y = parent_abs_y + node.final_layout.location.y;
    let bottom = abs_y + node.final_layout.size.height;
    if bottom > *max_bottom {
        *max_bottom = bottom;
    }
    for &child_id in &node.children {
        walk_max_bottom(doc, child_id, abs_y, max_bottom);
    }
}

#[tokio::main(flavor = "multi_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 {
        eprintln!("usage: spike <input.html> <output.png> [width] [scale]");
        std::process::exit(2);
    }

    let input_path = PathBuf::from(&args[1]);
    let output_path = PathBuf::from(&args[2]);
    let width: u32 = args.get(3).map(|s| s.parse().unwrap_or(800)).unwrap_or(800);
    let scale: f64 = args.get(4).map(|s| s.parse().unwrap_or(1.0)).unwrap_or(1.0);

    let html = fs::read_to_string(&input_path)?;
    eprintln!("[spike] read {} bytes of HTML", html.len());

    // No network fetcher and no custom FontContext for the spike — let Blitz
    // do its default thing. We'll wire those in Phase 2.
    let mut document = HtmlDocument::from_html(
        &html,
        DocumentConfig {
            base_url: None,
            net_provider: None,
            font_ctx: None,
            ..Default::default()
        },
    );
    eprintln!("[spike] parsed document");

    let scaled_width = (width as f64 * scale).round() as u32;
    // himg uses a small initial viewport (e.g. 720x405) and reads
    // root_element height after resolve. With a tall viewport, Blitz seems
    // to treat the root element as filling viewport, so root.size.h reports
    // a clipped value. Try matching himg's approach.
    let initial_viewport_h = (405.0 * scale).round() as u32;
    document.as_mut().set_viewport(Viewport::new(
        scaled_width,
        initial_viewport_h,
        scale as f32,
        ColorScheme::Light,
    ));

    document.as_mut().resolve();
    eprintln!("[spike] resolved styles + layout");

    // Walk every node, accumulate absolute Y by walking from root, take
    // the max bottom edge. Reliable regardless of html/body sizing quirks.
    let doc_ref = document.as_ref();
    let html_id = doc_ref.root_element().id;
    let mut max_bottom: f32 = 0.0;
    walk_max_bottom(doc_ref, html_id, 0.0, &mut max_bottom);
    let computed_height = max_bottom;

    // Diagnostic: also show what root_element + body reports for comparison.
    let root_l = &doc_ref.root_element().final_layout;
    let body_l = doc_ref
        .root_element()
        .children
        .iter()
        .filter_map(|&id| doc_ref.get_node(id))
        .find(|n| {
            n.element_data()
                .map(|e| e.name.local.as_ref() == "body")
                .unwrap_or(false)
        })
        .map(|n| &n.final_layout);
    eprintln!(
        "[spike] root size.h={} content.h={} body={:?} walked_max_bottom={}",
        root_l.size.height,
        root_l.content_size.height,
        body_l.map(|l| (l.size.height, l.content_size.height)),
        computed_height
    );

    // FIXED big render + alpha-scan crop for the spike. Phase 2 figures
    // out the proper Blitz API for content height.
    let scaled_height: u32 = 3000;
    let t_render = std::time::Instant::now();

    // Re-resolve at the actual height so layout decisions that depend on
    // viewport height (percent heights, etc.) line up with the canvas size.
    document.as_mut().set_viewport(Viewport::new(
        scaled_width,
        scaled_height,
        scale as f32,
        ColorScheme::Light,
    ));
    document.as_mut().resolve();

    let buffer = render_to_buffer::<VelloCpuImageRenderer, _>(
        |scene| {
            paint_scene(
                scene,
                document.as_ref(),
                scale,
                scaled_width,
                scaled_height,
            )
        },
        scaled_width,
        scaled_height,
    );
    eprintln!(
        "[spike] rasterized {} bytes (RGBA) in {:?}",
        buffer.len(),
        t_render.elapsed()
    );

    // Phase-1 hack: Blitz's `final_layout` underreports content height in
    // ways I haven't yet figured out, AND when the viewport is tall the page
    // background gets painted to the canvas bottom, so plain alpha-scan
    // doesn't work either. Instead: compute the modal pixel of the very
    // bottom row (the "fill"), then find the last row that contains at
    // least one pixel different from that fill. That row is the bottom of
    // real content. Add a small margin for breathing room.
    let row_bytes = (scaled_width * 4) as usize;
    let last_row_start = ((scaled_height - 1) as usize) * row_bytes;
    let fill_px = &buffer[last_row_start..last_row_start + 4];
    let mut last_content_row: u32 = 0;
    for y in (0..scaled_height).rev() {
        let row_start = (y as usize) * row_bytes;
        let row = &buffer[row_start..row_start + row_bytes];
        if row.chunks_exact(4).any(|px| px != fill_px) {
            last_content_row = y;
            break;
        }
    }
    let margin = (24.0 * scale).round() as u32;
    let crop_h = (last_content_row + 1 + margin).min(scaled_height);
    let cropped = &buffer[..(crop_h as usize) * row_bytes];
    eprintln!(
        "[spike] content-vs-fill scan: last content at row {} → cropped to {}x{} (fill = rgba {},{},{},{})",
        last_content_row, scaled_width, crop_h, fill_px[0], fill_px[1], fill_px[2], fill_px[3]
    );

    let file = fs::File::create(&output_path)?;
    let mut encoder = Encoder::new(BufWriter::new(file), scaled_width, crop_h);
    encoder.set_color(ColorType::Rgba);
    encoder.set_depth(BitDepth::Eight);
    let mut writer = encoder.write_header()?;
    writer.write_image_data(cropped)?;
    writer.finish()?;
    eprintln!("[spike] wrote {}", output_path.display());

    Ok(())
}
