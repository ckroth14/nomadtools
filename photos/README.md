# Media Photos

Photos shown on the **Media page → Photos tab** are driven by `photos.json`
in this folder. To add a photo you do two things:

### 1. Drop the image file into this `photos/` folder
JPG or PNG. Recommended: landscape, ~1600px wide, under ~500 KB each so the
page loads fast.

### 2. Add a line to `photos.json`
It's a simple list. Each photo is one entry with a `file` and a `caption`:

```json
[
  { "file": "camera-install.jpg", "caption": "IP camera install on a parking-lot pole" },
  { "file": "poe-ports.jpg",      "caption": "nomad.poe PoE and LAN ports" }
]
```

- **file** — the exact image filename in this folder (case-sensitive)
- **caption** — short description (also used as the image's alt text / tooltip)

Photos appear in the Photos grid in the order listed. Save the file, commit,
and push — they go live automatically. No HTML editing required.

An empty list (`[]`) shows a "Photos coming soon" message on the page.

### Tips
- Keep the JSON valid: commas between entries, no trailing comma after the last one.
- Filenames with spaces work, but dashes are cleaner (e.g. `field-install-1.jpg`).
