# Jade Library

Repository of League of Legends material definitions for use with [Jade](https://github.com/RitoShark/Jade-League-Bin-Editor).

## What is this?

League of Legends uses `StaticMaterialDef` entries all over skin and VFX bins to drive shader behavior — dissolve effects, toon shading, glass, refraction, panners, fresnel glow, and so on. This repo hosts a versioned catalog of those materials that Jade's in-app **Material Library** browser can fetch and drop into your bin files on demand.

Every material ships with:
- **`snippet.txt`** — the ritobin source that gets inserted into the user's bin
- **`snippet.json`** — metadata (name, category, champion, skin, textures, tags, featured flag, etc.)
- **`textures/`** — shader textures the material samples, with the paths inside `snippet.txt` already rewritten to `assets/jadelib/<material-id>/<filename>` so they never break across game patches
- **Optional** `preview.png` / `thumb.png` — card thumbnail for the browser

## Folder layout

```
jade-library/
├── index.json                              # flat catalog (rebuilt by the tools app)
├── SCHEMA.md                               # schema reference for snippet.json + index.json
├── README.md
├── materials/
│   ├── <champion>/<skin>/<material-id>/    # skin-specific (most common)
│   ├── <champion>/<material-id>/           # champion-wide
│   ├── general/<material-id>/              # curated / not champion-specific
│   └── ...
└── tools/                                  # Neutralino management app (see below)
    ├── app/
    └── README.md
```

Current catalog: **183 champion subtrees** plus a `general/` bucket for curated materials like `toon-shading` and `glow`.

## Categories

The library classifier (name-based, priority-ordered, first match wins) buckets materials into:

- **Dissolve Effects** — dissolve, burn, erode, disintegrate
- **Toon Shading** — toon, matcap, cel shading
- **Glass & Refraction** — glass, refract, crystal, ice
- **Distortion** — distort, panner, scroll, warp, wave, ripple
- **Glow & Emissive** — fresnel, emissive, glow, rim light, bloom
- **Body & Character** — body, hair, eye, face, armor, weapon, etc. (catch-all for character surfaces)
- **Special** — everything that doesn't match

## The Tools App

`tools/app/` is a Neutralino desktop app for managing this repo. It handles everything from extracting materials out of League WADs to curating them. It has six tabs:

### Extract
Runs the full pipeline: walks `<League>/Game/DATA/FINAL/Champions/*.wad.client`, batch-converts bins with ritobin, dedupes `StaticMaterialDef` entries by fingerprint, repaths textures to `assets/jadelib/<id>/`, writes `snippet.txt` + `snippet.json` + textures per material. Streams per-champion: extracts one WAD, emits its materials, wipes temp, moves on — so temp usage peaks at one WAD's worth (~150–300 MB) instead of the 20GB of a full extraction.

Options:
- **Champion filter** — restrict to WADs containing a substring (e.g. `Ahri`)
- **Exclude** — comma-separated substrings; skip WADs that contain any (e.g. `Strawberry_, Companions` to drop gamemode junk)

### Add
Paste a ritobin `StaticMaterialDef` snippet, fill in metadata, and the app writes it into the library at the right path — no need to run the extractor for one-off manual inserts. Auto-parses the entry key + sampler list, auto-fills the folder slug and display name, routes to:
- `materials/<champion>/<skin>/<id>/` if both provided
- `materials/<champion>/<id>/` if only champion
- `materials/general/<id>/` otherwise (curated)

### Diff
Shows the most recent extraction's added/changed/removed lists as collapsible sections with a summary bar at the top and a **Clear diff** button. Always refreshes on tab activation.

### Preview
Attach a preview image to an existing material. Two-stage picker: champion → material of that champion. A **General / Curated** bucket is pinned above the champion list for manually inserted materials.

### Manage
Multi-select material browser for curation:
- Checkbox rows + filter
- **Bulk actions** — set category for N materials, mark/unmark featured, reclassify (re-run the classifier on the saved metadata), **delete** with confirmation
- **Per-material** — edit display name, category, description, tags, featured; reclassify or delete

### Index
One-click rebuild of `index.json` from the current `materials/**/snippet.json` state. Also has a **Delete index.json** button for a clean rebuild.

### Settings
Tool paths (ritobin, wad-extract), hashes dir, League install path, repo path.

## Adding materials by hand

If you don't want to use the Add tab, drop a folder at `materials/<champion>/<skin>/<id>/` (or wherever fits) containing:

- `snippet.txt` — the ritobin text
- `snippet.json` — metadata per [SCHEMA.md](SCHEMA.md)
- `textures/<*.tex>` — any shader textures referenced in the snippet
- Optionally `preview.png` or `thumb.png`

Then run **Rebuild index.json** in the Index tab.

## Jade integration

Jade's **Material Library** browser (Ctrl+L when a bin is open) fetches `index.json` from this repo's `master` branch, lists everything with champion filter, category filter, search, and an **Installed** bucket. Clicking a material:

1. Downloads `snippet.txt` + `snippet.json` + textures into the local cache (`%APPDATA%\LeagueToolkit\Jade\library\materials\<path>\`)
2. Lets you pair it with a submesh via the material override dialog (with SKN submesh detection and texture matching)
3. On insert: injects the `StaticMaterialDef` into the bin right after `skinMeshProperties`, adds the override entry, and copies textures from the cache into the user's mod at `assets/jadelib/<id>/`

If the user closes the bin without saving, Jade offers to remove any `assets/jadelib/<id>/` folders it created during that session.

## Legal

Shader texture files (`.tex`) are extracted from League of Legends client assets and redistributed here for convenience. If Riot objects, they will be removed in favor of extraction instructions.

Material definitions (the ritobin text in `snippet.txt`) are structural data describing shader configurations and are not considered copyrighted assets.
