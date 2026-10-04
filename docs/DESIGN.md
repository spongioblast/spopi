# SPOPI design system

SPOPI uses CSS custom properties and reusable `.ui-*` primitives to keep the desktop UI consistent. The CSS variables in `public/style-theme.css` are the single source of truth.

## CSS layers

Load styles in this order:

1. `style-theme.css` — foundation and theme tokens
2. `design-system.css` — reusable UI primitives
3. The feature stylesheets in `stylesheets.json`, in that order, each next to its module
4. `style.css` — page layout that applies after them

Business styles may position a component or represent domain state, but must not duplicate a primitive's typography, dimensions, colors, or generic interaction states.

## Foundation tokens

### Typography

Use only the shared type scale:

- `--font-size-xs` (11px): micro text only, such as diff gutter numbers, badge counts, and keyboard hints
- `--font-size-sm`: metadata and compact labels
- `--font-size-md`: default body and controls
- `--font-size-lg`: prominent labels and small headings
- `--font-size-xl`: headings
- `--font-size-2xl`: display values

Do not add a token merely to preserve an isolated historical font size. Choose the closest semantic level and visually review the result.

Weights are `--font-weight-normal` (400), `--font-weight-medium` (500), `--font-weight-semibold` (600), and `--font-weight-bold` (700). Line heights are `--line-height-tight` (1.25, headings and badges), `--line-height-normal` (1.4, compact UI text), `--line-height-relaxed` (1.5, body and chat), and `--line-height-code` (1.6, code and editors). `line-height: 1` for icon boxes stays literal.

Two font stacks live in `style-theme.css`: `--font-sans` (the UI: San Francisco on macOS, Segoe UI on Windows, the system font on Linux) and `--font-mono` (paths, commands, diffs, tool output). `body` sets `--font-sans`, and `style.css` makes buttons, inputs, selects, and textareas inherit it, since browsers give form controls their own font. A component sets `font-family` only to switch to `var(--font-mono)` for code-like text. The code editor and terminal use the bundled Fira Code (`"SPOPI Mono Nerd"`), and chat and Markdown text put `"SPOPI CJK"` in front of `--font-sans`. Do not write a font list by hand: one that names only macOS fonts falls back to Arial or Courier New on Windows.

### Spacing

Spacing follows a 4px base scale. `--space-0-5` and `--space-1-5` exist for dense desktop controls. Use the scale in `gap`, `padding`, and `margin`. A margin may keep a `1px` hairline or a negative nudge.

### Color

Feature CSS takes colours from tokens only: `--text-*`, `--bg-*`, `--border*`, `--accent*`, and the status colours `--success`, `--warning`, `--error` (`--danger`). Tint a status colour with `color-mix(in srgb, var(--error) 10%, transparent)` instead of a literal rgba. These tokens are the same in every theme:

- `--overlay-scrim` behind modals, `--overlay-scrim-strong` behind the image lightbox, and `--scrim` under a control drawn over an image
- `--shade-weak`, `--shade`, `--shade-strong`: black tints for wells and code blocks
- `--elevation-sm`, `--elevation-md`, `--elevation-lg`: real shadows for surfaces that must lift in dark themes (dark themes set `--shadow-*` to none)
- `--dialog-border`: the dark-theme dialog edge
- `--on-accent` and `--on-danger`: text on accent and on status fills
- `--info`: the unread and update blue
- `--chart-1` … `--chart-6`: series colours for the Usage charts

A theme may also set `--header-pill-text` and the terminal palette (`--ansi-<colour>`, `--ansi-bright-<colour>`). Both are optional; readers fall back to `--text-secondary` and the built-in terminal palette.

`--text-secondary` is for text the user reads (timestamps, durations, secondary labels). `--text-placeholder` is for an empty field's hint. Do not fade readable metadata with an extra `opacity`.

### Layering

Overlays use the z-index ladder, lowest first: `--z-settings`, `--z-surface-modal`, `--z-dialog`, `--z-popover`, `--z-toast`, `--z-context-menu`, `--z-lightbox`, `--z-swap`. Toasts sit above dialogs so an error raised from a dialog stays visible. Numbers below 1000 are for stacking inside one component. `public/app/ui/layering.test.js` pins the ladder.

### Control heights

- `--control-height-xs` (24px): dense toolbars only
- `--control-height-sm` (28px): compact controls
- `--control-height-md` (32px): default controls
- `--control-height-lg` (40px): primary actions and spacious forms

The default `.ui-*` control size is medium. Add a size modifier only for non-default sizes.

### Shape

Use `--radius-xs`, `--radius-sm`, `--radius-md`, `--radius`, `--radius-lg`, or `--radius-pill`. Do not introduce component-specific radius values.

## UI primitives

Primitives live in `public/design-system.css`:

- `.ui-button`
- `.ui-icon-button`
- `.ui-input`
- `.ui-textarea`
- `.ui-select`
- `.ui-loading`
- `.ui-toggle` (`--sm`): on/off switch, a `button[role="switch"]` with `aria-checked` or a checkbox input
- `.ui-tabs` with `.ui-tab` children: tab strip; `aria-selected="true"` or `.active` marks the open tab. `.ui-tabs--underline` is for page-level tabs
- `.ui-badge` (`--accent`): count or status label
- `.ui-empty`: empty, error, and unavailable states, in Settings and everywhere else (Review, panels, lists). Build them with `settingsState()` from `public/app/ui/settings-states.js`, which also gives the loading state and a Retry button, or put `.ui-empty` on a single line of text. `.settings-help` is help text on Settings pages, not an empty state
- `.ui-skeleton`: shimmer block while content loads

Button variants are `--primary`, `--secondary`, `--ghost`, and `--danger`. Size modifiers are `--xs`, `--sm`, and `--lg`; medium is the default. A size modifier changes the height only: the label stays `--font-size-md`, so a small button reads the same as a medium one. A component that needs a smaller label (a dense tab strip) sets `font-size` itself.

Editor tabs (`.file-preview-tab`) keep their own chrome: they carry close buttons and dirty markers, and Review and Git sub-tabs reuse that look.

```html
<button
  type="button"
  class="ui-button ui-button--primary save-settings-button"
>
  Save
</button>

<button
  type="button"
  class="ui-icon-button ui-icon-button--sm ui-icon-button--ghost new-session-btn"
  aria-label="New session"
>
  …
</button>

<div class="ui-loading" role="status">Loading…</div>
```

Keep business classes when migrating existing markup. `.ui-*` owns shared appearance; the business class owns positioning, domain state, JS hooks, and test selectors.

## Settings pages

Every Settings page is built from the helpers in `public/app/ui/settings-controls.js`, so the pages look alike:

- `settingsPage(title, key, children)` gives the page title and the body. The body stacks its children with `--space-4` between them. A page that wraps its cards in its own element adds `settings-stack` to it for the same gap.
- `settingsCard(title, key, children)` is one group of settings: a `.ui-card` with a `.settings-section-title`. Every group sits in a card. No row or help text sits loose in the body.
- `row({ label, description, control })` is one setting: the label and an optional one-line description on the left, the control on the right. Toggles, selects, number fields, and level controls all go in rows.
- An intro line with page-wide actions (Test all, Refresh) is a `.settings-intro`: a `.settings-help` on the left and `.settings-intro-actions` on the right. It sits above the first card, or inside the first card when the actions belong to it.
- Help text is `.settings-help`. A primary action is `ui-button--primary`; the rest are `--secondary`.

Packages and Usage are tools rather than forms: their tabs, package grid, and dashboard keep their own layout under the same page title. `settings-pages-layout.test.js` pins the card rule for the form pages.

A page a phone may not use (Phone access, for one) checks `canHere()` from `public/app/shell/capabilities.js` and shows one card with a `.settings-help` line saying so, instead of controls the host would refuse.

## Dialogs

Modal questions and small forms open with `openDialog()` (or `confirmDialog()` / `promptDialog()`) from `public/app/ui/dialog.js`. It renders into `#dialog-container` at `--z-dialog`, returns focus when it closes, and runs the primary action on Enter. Do not append an overlay to `body` by hand.

- `title` is the question. Body text is a `p.dialog-message`; `.settings-help` belongs to Settings pages.
- A form field is a `label.dialog-field` with a `span.dialog-field-label` caption above the control (`ui-input`, or `select()` for a choice).
- Actions sit right-aligned: `ui-button--secondary` first, then one `ui-button--primary` (or `--danger`) marked `primary: true`.
- `closeOnBackdrop: false` when a stray click must not decide (a pairing request, unsaved input).
- `className` names the dialog and sets only its width, e.g. `max-width: min(480px, 92vw)`.
- A request that can be answered in another window or by a timeout keeps its `close` handle and closes itself when the answer arrives.

## Interaction and accessibility

The design system owns hover, active, focus-visible, disabled, busy, and invalid presentation. Prefer native semantics:

- Use `<button type="button">` for actions.
- Use `<a href>` for navigation.
- Use native `<input>` and `<textarea>` elements.
- Keep a native `<select>` as the value source, then call `enhanceSelect()` from `public/app/ui/select-menu.js` so the open menu is a styled listbox. `select()` in `settings-controls.js` does both. Do not leave a raw OS picker anywhere, dialogs included: WebView2 draws it white in the dark theme.
- Use `disabled`, `aria-disabled`, `aria-busy`, and `aria-invalid` rather than visual-only state classes.
- Do not apply button styling to a `div` or `span` to simulate a control.

Domain states such as `.selected`, `.current`, or `.is-recording` remain in business CSS.

## Rules

Recommended:

```css
.settings-actions {
  display: flex;
  gap: var(--space-2);
}

.settings-title {
  font-size: var(--font-size-lg);
}
```

Avoid:

```css
.settings-button {
  height: 34px;
  padding: 7px 14px;
  border-radius: 9px;
  font-size: 13px;
}
```

Do not create one-off variables such as `--settings-special-gap` merely to satisfy the checker. Stable, repeated component semantics may become tokens; one-off page layouts should compose foundation tokens.

## Legitimate exceptions

Not every CSS dimension is a design token. Percentages, viewport units, calculated geometry, responsive breakpoints, dynamic measurements, one-pixel dividers, and chart geometry may be literal when they describe layout or rendering rather than visual scale.

For an exceptional fixed value that the checker cannot infer, explain it locally:

```css
/* design-token-ignore: fixed plotting area required by Chart.js */
.cost-chart-canvas {
  height: 300px;
}
```

An ignore without a reason is invalid. Do not use ignores for ordinary font sizes, control heights, padding, gaps, or radii.

## Checks

After changing CSS, UI markup, or inline styles, run:

```bash
bun run check
```

`bun run check:fix` applies exact token substitutions. Ambiguous values require human selection and visual review.

`scripts/check-design-css.mjs` fails on literal px in padding, gap, font-size, radius, and margin; control-sized `height`/`min-height`; numeric `font-weight`; a `font-family` that is not `inherit`, a `--font-*` token, or a bundled `"SPOPI …"` face; `var()` in an `@font-face` weight; z-index of 1000 or more; and raw hex, `rgb()`, `hsl()`, `white`, or `black` in feature CSS (mask images may use `black`). Static design values set through `element.style` in JavaScript fail too; dynamic measured geometry is allowed.

## Visual review checklist

Before completing a design-system migration, review:

- every built-in theme
- sidebar and header controls
- chat composer
- settings forms
- dialogs
- cost dashboard and charts
- hover, active, focus, disabled, busy, and invalid states
- narrow windows
- long text, truncation, wrapping, and icon alignment
- the font that actually renders on Windows, not only how it looks on a Mac: DevTools → Computed → Rendered Fonts, or `CSS.getPlatformFontsForNode` over CDP. It should be Segoe UI for the interface and Fira Code in the editor and terminal
