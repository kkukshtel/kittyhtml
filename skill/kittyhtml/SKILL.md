---
name: kittyhtml
description: Render output as an inline terminal image using the `kittyhtml` CLI. ONLY use when the user explicitly asks for output as "kittyhtml" or "khtml" (e.g. "show me this as kittyhtml", "as khtml please", "render in kittyhtml"). Do NOT use for general HTML, web, or browser-related tasks.
---

# kittyhtml output format

The user has asked for output as **kittyhtml** or **khtml** — they want the result rendered as a styled HTML page and displayed inline in their terminal as an image.

## What to do

1. **Verify the tool is installed**: `command -v kittyhtml`. If missing, tell the user `npm install -g kittyhtml` and stop.

2. **Generate HTML** that represents the content. Be liberal with CSS — Blitz handles flexbox, grid, `<style>` blocks, class selectors, web fonts, and `<img>` tags. Treat it like a real browser with the caveats listed below.

3. **Pipe through the CLI**:
   ```sh
   cat <<'HTML' | kittyhtml --scale 2
   <!DOCTYPE html>
   <html><body>...</body></html>
   HTML
   ```

   Don't pass `--width` unless the user asks for a specific size — the default adapts to their terminal width. Always pass `--scale 2` for sharper text on HiDPI displays.

4. After piping, write a one-line confirmation (e.g. "Rendered above."). The image is the deliverable; don't restate its contents in text.

## CSS — what works

kittyhtml v0.3+ uses Blitz (Stylo + Taffy + Parley + Vello CPU). Treat it like a modern browser:

- **Full `<style>` blocks and class selectors work.** Use them.
- Flexbox, CSS Grid, `border-radius`, `box-shadow`, `opacity`, web fonts via `@font-face`, `<img>` tags with HTTPS URLs.
- `max-width`, `min-width`, `width`, `height` all work in any units.
- `<ul>` / `<ol>` render native bullets/numbers.
- `position: relative` and (limited) `absolute`.

## Caveats (Blitz pre-alpha)

- **`<thead>` rows render the background but lose text content.** Workaround: put header rows in `<tbody>` and style the row with `font-weight: 700` instead of wrapping in `<thead>`, or apply inline `style="font-weight:700"` directly on each `<th>`.
- **Fixed widths bigger than `--width` overflow the canvas.** Stick to percentages (`width: 100%`) or `max-width` on tables and large containers. The canvas dimension is `--width * --scale` pixels.

## Fonts

Two are baked into the binary and reliable:
- `'Noto Sans'` (regular, bold, italic, bold-italic)
- `'Noto Sans Mono'` for code

Use them as the canonical `font-family`:
```css
font-family: 'Noto Sans', sans-serif;
font-family: 'Noto Sans Mono', monospace;
```

Other fonts will fall back to system defaults or fail to render predictably.

## Template that's known to render well

```html
<!DOCTYPE html>
<html>
<head><style>
body { font-family: 'Noto Sans', sans-serif; margin: 0; padding: 0; background: #f4f4f5; color: #18181b; }
.wrap { max-width: 720px; margin: 0 auto; padding: 32px 24px; }
.card { background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); padding: 28px 32px; }
</style></head>
<body>
  <div class="wrap">
    <div class="card">
      <!-- content here -->
    </div>
  </div>
</body>
</html>
```

## When NOT to use this skill

- The user wants real HTML to save to a file or open in a browser → write HTML normally.
- The user is asking how `kittyhtml` works → answer the question directly.
- The user wants a screenshot of a real web page → this isn't a browser; suggest a headless-Chrome tool instead.
- The user hasn't said "kittyhtml" or "khtml" → do not invoke; produce regular output.
