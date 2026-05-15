---
name: kittyhtml
description: Render output as an inline terminal image using the `kittyhtml` CLI. ONLY use when the user explicitly asks for output as "kittyhtml" or "khtml" (e.g. "show me this as kittyhtml", "as khtml please", "render in kittyhtml"). Do NOT use for general HTML, web, or browser-related tasks.
---

# kittyhtml output format

The user has asked for output as **kittyhtml** or **khtml** — they want the result rendered as a styled HTML page and displayed inline in their terminal as an image, via the `kittyhtml` CLI.

## What to do

1. **Verify the tool is installed**: `command -v kittyhtml`. If missing, tell the user `npm install -g kittyhtml` and stop.

2. **Generate HTML** that represents the content the user asked about — a styled page, card, table, summary. Keep it focused; the rendered image should fit on one screen.

3. **Pipe it through the CLI**:
   ```sh
   cat <<'HTML' | kittyhtml --width 700 --scale 2
   <!DOCTYPE html>
   <html><body>...</body></html>
   HTML
   ```

   Use `--scale 2` for crisp text on retina/HiDPI. Pick width based on shape:
   - `--width 700`–`800` for full pages and reports
   - `--width 500` for cards and summaries
   - `--width 400` for compact, just-a-snippet output

4. After piping, write a one-line confirmation (e.g. "Rendered above."). The image is the deliverable; don't restate its contents in text.

## CSS — what works

kittyhtml v0.3+ uses Blitz (Stylo + Taffy + Parley + Vello). Most modern CSS works:

- Flexbox (`display: flex`, `flex: 1`, `gap`, etc.)
- CSS Grid (`display: grid`, `grid-template-columns`, etc.)
- `border-radius`, `box-shadow`, `opacity`
- `max-width`, `min-width`, `width`, `height`
- `background:` shorthand (no need for `background-color` longhand)
- Native `<ul>` / `<ol>` bullets
- `<img>` tags (with absolute URLs; HTTPS works)
- `position: relative` / `absolute`
- Web fonts via `@font-face`

Inline styles only — no `<style>` blocks, no `class` selectors are honored.

## Fonts

Two are baked in and reliable:
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
<body style="font-family: 'Noto Sans', sans-serif; margin: 0; padding: 0; background: #f4f4f5; color: #18181b;">
  <div style="max-width: 720px; margin: 0 auto; padding: 32px 24px;">
    <div style="background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); padding: 28px 32px;">
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
