# Repository assets

## Social preview

- `social-preview.svg` is the editable source.
- `social-preview.png` is the 1280×640 raster export for GitHub repository social previews and Open Graph/Twitter card images.

After editing the SVG, regenerate the PNG with:

```bash
magick -background none assets/social-preview.svg assets/social-preview.png
```

## Before / after diagram

- `before-after.svg` is the editable source.
- `before-after.png` is the 1584×618 raster export embedded in the README and used for social/tweet promotion. It contrasts a plain Drizzle handle (a forgotten scope filter leaks silently) with a `drizzle-scoped-db` handle (the same query throws).

```bash
magick -background none assets/before-after.svg assets/before-after.png
```
