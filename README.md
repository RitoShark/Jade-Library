# Jade Library

Repository of League of Legends material definitions for use with [Jade](https://github.com/RitoShark/Jade-League-Bin-Editor).

## What is this?

League of Legends uses hundreds of `StaticMaterialDef` entries to make meshes look different -- glass, fur, dissolve effects, glow, toon shading, and more. This repo hosts a curated, versioned collection of these materials that Jade can fetch and insert into skin bin files.

Every material ships with:
- **`snippet.json`** -- metadata and the insertable ritobin code
- **`textures/`** -- shader textures required by the material (namespaced per-material)
- **A preview image** (`.png`, `.jpg`, or `.webp`)

## Structure

```
jade-library/
  index.json                      # master catalog
  materials/
    toon-shading/
      snippet.json
      preview.png
      textures/
        ToonShading.tex
        OutlineToneMap.tex
    ...
  tools/                          # Neutralino management app
    app/
    README.md
```

All shader textures are repathed to `assets/jadelib/<material-id>/<filename>` so they never break across game patches. This prefix is fixed and not user-configurable.

## Adding a material

1. Create a folder under `materials/<kebab-case-name>/`
2. Add `snippet.json` with the metadata and ritobin text (see schema in `SCHEMA.md`)
3. Drop shader textures into `textures/`
4. Add a preview image next to `snippet.json`
5. Run the Neutralino tool to rebuild `index.json`

## Legal

Shader texture files (`.tex`) are extracted from League of Legends client assets. They are redistributed here for convenience. If Riot objects, they will be removed in favor of extraction instructions.

Material definitions (the ritobin text in `snippet.json`) are structural data describing shader configurations and are not considered copyrighted assets.
