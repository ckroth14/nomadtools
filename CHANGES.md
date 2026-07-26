# Changes — nomadtools.us

This folder is the updated static site. Drop these files over your local
`nomadtools.us/` repo, then review with `git diff` before committing.

Static HTML/CSS/JS — no build step. Open `index.html` in a browser to preview.

## Pages changed

### index.html
- **Product cards:** equalized the two card header heights (logo header now
  matches the 360-viewer header at 230px) so the feature-list rows align across
  both cards.
- **Bullet dashes:** forced `.feature-list li::before` color to `var(--red)`
  with `!important` so all bullets render red consistently.
- **Pricing:** hero price and product-card price now show a slashed
  **~~$349~~ $299**.
- **Hero device caption:** font-size set to 14px.

### toolbox.html (IP ToolBox)
- **Screenshot gallery:** now 4 thumbnails in a 2×2 grid (larger previews):
  `annot_main`, `annot_third`, `annot_second`, and the full-workspace shot.
  Clicking a thumbnail swaps the main image.
- Tightened the gap between the "Enter your email" prompt and the input.
- Right download column width set to 400px.

### nomad-poe.html
- **Gallery (3 images):** 360° viewer → annotated top view
  (`poe_top_annotated_v2.png`) → shoulder strap (`strap_poe.png`).
  Thumbnails switched to a 2-column grid for larger previews.
- **Specifications:** added a **Material** row —
  "3D Printed (PETG) Body and mount components".
- **Pricing:** main price block shows slashed **~~$349~~ $299**.

### about.html
- Contact text edit: "…runs on the batteries already on your truck."
- **CK Concepts credit:** moved into its own card directly below the contact
  form (`.credit-block`, right column stacked via `.about-aside`).

## New image assets (in Art/)
These were generated during design and are NOT in the old repo — a full folder
copy brings them in:
- `annot_main.png`, `annot_second.png`, `annot_third.png` — annotated IP ToolBox
  app screenshots.
- `poe_top_annotated_v2.png` — annotated nomad.poe top view.
- `strap_poe.png` — annotated shoulder strap.
- `ck-concepts.png` — designer credit logo (about page).

## Not touched
- `$299` mentions in the nomad.poe comparison table and About prose were left as
  plain references (not price displays).
