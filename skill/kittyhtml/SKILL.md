---
name: kittyhtml
description: Render output as an inline terminal image using the `kittyhtml` CLI. ONLY use when the user explicitly asks for output as "kittyhtml" or "khtml" (e.g. "show me this as kittyhtml", "as khtml please", "render in kittyhtml"). Do NOT use for general HTML, web, or browser-related tasks.
---

# kittyhtml output format

The user has asked for output as **kittyhtml** or **khtml** — they want the result rendered as a styled HTML page and displayed inline in their terminal as an image, via the `kittyhtml` CLI.

## What to do

1. **Verify the tool is installed**: `command -v kittyhtml` (one-time check per session). If missing, tell the user to run `npm install -g kittyhtml` and stop.

2. **Generate HTML** that represents the content the user asked about — a styled page, card, table, summary, or whatever fits the request. Keep it focused; the rendered image should fit on one screen.

3. **Pipe it through the CLI**:
   ```sh
   cat <<'HTML' | kittyhtml --width 700 --scale 2
   <!DOCTYPE html>
   <html><body>...</body></html>
   HTML
   ```

   Use `--scale 2` for crisp text on retina/HiDPI. Use `--width 600`–`800` for content that should feel "page-sized." Use a smaller width (`--width 400`) for compact card-like output.

4. After piping, write a one-line confirmation (e.g. "Rendered above."). The image is the deliverable; don't restate its contents in text.

## CSS rules — DropFlow subset

DropFlow is a real CSS layout engine but it's not a browser. Stick to this subset:

- **Use `background-color`, NOT the `background` shorthand.** The shorthand is silently dropped.
- **Use `width: Npx`, NOT `max-width`.** `max-width` / `min-width` aren't implemented.
- **No `list-style` markers.** Don't use `<ul><li>` and expect bullets. Use `<div>&bull;&nbsp;&nbsp;item</div>` or numbered prefixes.
- **No `border-radius`, `box-shadow`, `transform`, `position: absolute/fixed`.** Square corners only. Use `border: 1px solid #color;` for definition.
- **`<body>` background does NOT propagate to the canvas.** Wrap content in an outer `<div style="background-color: #fff; padding: ...">` to fill the image.
- **Only inline `style` attributes work** — no `<style>` blocks, no classes.
- **Fonts available**: `Noto Sans` (default), `Noto Sans Mono` for code.

## Template that's known to render well

```html
<!DOCTYPE html>
<html>
<body style="font-family: 'Noto Sans', sans-serif; margin: 0; padding: 0; color: #18181b;">
  <div style="background-color: #f4f4f5; padding: 24px 0;">
    <div style="width: 640px; margin: 0 auto;">
      <div style="background-color: #ffffff; border: 1px solid #e4e4e7; padding: 24px 28px;">
        <!-- content here -->
      </div>
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
