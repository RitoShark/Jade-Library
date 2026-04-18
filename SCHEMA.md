# Schema

Reference for the JSON formats used in this repo.

## index.json

Master catalog fetched first by Jade.

```json
{
  "schemaVersion": 1,
  "lastUpdated": "2026-04-13T16:30:00Z",
  "categories": [
    { "id": "toon", "name": "Toon Shading" },
    { "id": "glass", "name": "Glass & Refraction" }
  ],
  "materials": [
    {
      "id": "toon-shading",
      "name": "Toon Shading",
      "category": "toon",
      "description": "...",
      "tags": ["toon", "outline", "rim"],
      "hasPreview": true,
      "userSlots": ["Diffuse_Texture"],
      "featured": true,
      "version": 1,
      "updatedAt": "2026-04-13T16:30:00Z"
    }
  ]
}
```

### Fields

| Field | Type | Description |
|---|---|---|
| `schemaVersion` | int | Format version of this file |
| `lastUpdated` | ISO8601 | Timestamp of the most recent change to any material |
| `categories[].id` | string | Short ID used for sidebar grouping |
| `categories[].name` | string | Display name |
| `materials[].id` | string | Kebab-case ID, must match folder name under `materials/` |
| `materials[].featured` | bool | Whether to surface in the Material Override dialog's "Featured" section |
| `materials[].version` | int | Bumped when the material changes -- drives cache invalidation |
| `materials[].updatedAt` | ISO8601 | Per-material change timestamp |

## snippet.json + snippet.txt

Per-material metadata lives in `snippet.json`. The actual ritobin text lives
in a sibling `snippet.txt` file so it stays human-readable and diffable in
the repo. `snippet.json` references it by filename via the `snippetFile`
field (defaults to `snippet.txt`).

```json
{
  "id": "toon-shading",
  "name": "Toon Shading",
  "category": "toon",
  "version": 1,
  "updatedAt": "2026-04-13T16:30:00Z",
  "description": "Cel-shaded look with outline and rim lighting.",
  "userSlots": [
    {
      "name": "Diffuse_Texture",
      "kind": "diffuse",
      "description": "Main skin texture"
    }
  ],
  "materialName": "jadelib_toon_shading",
  "textureFiles": [
    { "name": "ToonShading.tex",    "updatedAt": "2026-04-13T16:30:00Z" },
    { "name": "OutlineToneMap.tex", "updatedAt": "2026-04-13T16:30:00Z" }
  ],
  "snippetFile": "snippet.txt"
}
```

```
"jadelib_toon_shading" = StaticMaterialDef {
    Name: string = "jadelib_toon_shading"
    SamplerValues: list2[embed] = {
        ...
    }
    ...
}
```

### Fields

| Field | Type | Description |
|---|---|---|
| `id` | string | Must match folder name |
| `materialName` | string | Always starts with `jadelib_`. Used as the key in the ritobin snippet and as the target of `material: link` in override entries. |
| `userSlots[].kind` | enum | `diffuse` / `normal` / `mask` / `emissive` / `specular` / `other` -- drives the SKN auto-match suffix heuristic |
| `textureFiles[]` | array | Shader textures shipped alongside this material, each with its own `updatedAt` for skip-or-overwrite logic on insert |
| `snippetFile` | string | Filename of the sibling ritobin text file. Defaults to `snippet.txt` if omitted. First line is always `"jadelib_<id>" = StaticMaterialDef {` |

## User slot kinds

The `kind` field on each user slot drives which texture suffixes Jade prefers when auto-resolving from a SKN match:

| Kind | Preferred suffixes |
|---|---|
| `diffuse` | `_CM`, `_Diffuse`, `_Color`, `_Albedo`, (no suffix) |
| `normal` | `_NM`, `_Normal` |
| `mask` | `_MK`, `_Mask` |
| `emissive` | `_EM`, `_Emissive`, `_Glow` |
| `specular` | `_SP`, `_Specular` |
| `other` | any match |
