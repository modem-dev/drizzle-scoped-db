# Repository assets

## Social preview

- `social-preview.svg` is the editable source.
- `social-preview.png` is the 1280×640 raster export for GitHub repository social previews and Open Graph/Twitter card images.

After editing the SVG, regenerate the PNG with:

```bash
magick -background none assets/social-preview.svg assets/social-preview.png
```
