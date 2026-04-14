# Jade Library Tools

Neutralino-based GUI for extracting League of Legends materials from game files
and managing the `jade-library` repo.

## What it does

The tools handle the half of the workflow that lives **outside** the main Jade
editor:

1. **Extract** new and updated `StaticMaterialDef` entries from champion WAD
   archives every time League gets a patch
2. **Repath** shader textures into the stable `assets/jadelib/<material-id>/`
   layout
3. **Diff** the new extraction against what's already in the repo so you can
   review changes before committing
4. **Submit preview images** for materials so the Jade browser can display
   them
5. **Rebuild `index.json`** with current versions and metadata

The pipeline is JavaScript running inside Neutralino, shelling out to two
existing binaries for the actual binary parsing:

- `ritobin.exe` (moonshadow565/ritobin) — converts `.bin` files to JSON
- `wad-extract.exe` (cslol-tools) — extracts WAD archives

These binaries are **not** committed to the repo. You point at your local
copies via the first-run setup wizard.

## Folder layout

```
tools/
  README.md                  ← this file
  app/
    neutralino.config.json   ← Neutralino app config
    config.json              ← local user settings (gitignored)
    hashes/                  ← downloaded hash files (gitignored)
    logs/                    ← extraction logs (gitignored)
    resources/
      index.html             ← main UI shell
      css/
        app.css              ← gradient theme matching jadeALT-cover.html
      js/
        main.js              ← bootstrap + tab routing
        config.js            ← config file persistence
        setup.js             ← first-run wizard
        settings.js          ← settings tab (tool paths, hashes)
        toolRunner.js        ← wraps os.execCommand for ritobin/wad-extract
        extractor.js         ← extraction pipeline orchestrator
        materialWalker.js    ← finds StaticMaterialDef entries in JSON trees
        deduper.js           ← fingerprint-based dedup
        repather.js          ← rewrites texture paths to assets/jadelib/<id>/
        snippetEmitter.js    ← writes snippet.json + snippet.txt + textures/
        differ.js            ← diff against existing repo + Diff tab UI
        indexBuilder.js      ← regenerates index.json
        previewSubmit.js     ← preview image drop zone + canvas resize
```

## Running for the first time

1. Install Neutralino CLI globally: `npm install -g @neutralinojs/neu`
2. From this `tools/` folder, fetch the runtime: `neu update`
3. Launch in dev mode: `neu run`

On first launch the setup wizard opens. Provide:

- Path to `ritobin.exe`
- Path to `wad-extract.exe` (cslol-tools)
- Path to your hashes folder (or use Jade's existing one at
  `%APPDATA%\FrogTools\hashes`)
- Path to your local `jadelibrary` repo (the folder containing this `tools/`)

All paths are persisted to `app/config.json` (gitignored) so the wizard only
shows once.

## Running an extraction

1. Switch to the **Extract** tab
2. Browse to your League install path
   (`C:\Riot Games\League of Legends\Game`)
3. Optionally enter a champion name to filter (e.g. `Ahri`) for faster
   iteration
4. Click **Start Extraction**
5. Watch the progress bar + log panel
6. When done, switch to the **Diff** tab to review what changed

Errors on individual bins are logged but never abort the run — the pipeline
always completes with a final summary.

## Adding a preview image

1. Switch to the **Preview** tab
2. Pick a material from the dropdown
3. Drag a PNG/JPG/WEBP into the drop zone
4. The image is auto-resized to 512×288 (16:9 thumbnail)
5. Click **Save preview** — the file is written next to the material's
   `snippet.json` as `preview.png`

## Rebuilding the index

The Extract pipeline auto-rebuilds `index.json` at the end of each run, but if
you hand-edit any `snippet.json` files you can rebuild manually from the
**Index** tab.
