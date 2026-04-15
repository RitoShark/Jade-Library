// Index Rebuild tab + the runtime function the pipeline calls.
//
// Walks <repoPath>/materials/** recursively and regenerates index.json.
// The layout expected on disk is:
//
//   materials/
//     general/
//       toon-shading/              ← curated, no champion
//         snippet.json
//     ahri/
//       ahri-base-inst/            ← champion bin, no specific skin
//         snippet.json
//       skin77/
//         ahri-tails-inst/         ← skin-specific material
//           snippet.json
//
// A material is any directory containing a `snippet.json` file. The path
// from `materials/` down to that directory becomes the entry's `path`,
// which the Jade client uses to fetch it.

import { getConfig } from './config.js';

let logEl, btn;

export function initIndexTab() {
    logEl = document.getElementById('index-log');
    btn = document.getElementById('rebuild-index');
    btn?.addEventListener('click', async () => {
        const cfg = getConfig();
        if (!cfg.repoPath) {
            log('Repo path not configured — open Settings.', 'error');
            return;
        }
        log('Rebuilding…');
        try {
            const result = await rebuildIndex(cfg.repoPath);
            log(`Wrote ${result.materialCount} materials.`, 'success');
        } catch (e) {
            log(`Error: ${e}`, 'error');
        }
    });

    document.getElementById('clean-index')?.addEventListener('click', async () => {
        const cfg = getConfig();
        if (!cfg.repoPath) {
            log('Repo path not configured — open Settings.', 'error');
            return;
        }
        const target = `${cfg.repoPath}/index.json`;
        try {
            await Neutralino.filesystem.remove(target);
            log(`Deleted ${target}. Click Rebuild to regenerate.`, 'success');
        } catch (e) {
            // Neutralino throws even when the file simply doesn't exist, so
            // surface a friendlier message in that case.
            const msg = String(e);
            if (msg.includes('NE_FS_NOPATHE') || msg.toLowerCase().includes('no such')) {
                log('index.json does not exist — nothing to delete.');
            } else {
                log(`Error: ${e}`, 'error');
            }
        }
    });
}

function log(msg, kind = '') {
    if (!logEl) return;
    const div = document.createElement('div');
    div.className = `log-line ${kind ? 'log-' + kind : ''}`;
    div.textContent = msg;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
}

// Keep in sync with the categories exported by classifier.js
const DEFAULT_CATEGORIES = [
    { id: 'dissolve',   name: 'Dissolve Effects' },
    { id: 'toon',       name: 'Toon Shading' },
    { id: 'glass',      name: 'Glass & Refraction' },
    { id: 'distortion', name: 'Distortion' },
    { id: 'glow',       name: 'Glow & Emissive' },
    { id: 'body',       name: 'Body & Character' },
    { id: 'special',    name: 'Special' },
];

export async function rebuildIndex(repoPath) {
    if (typeof Neutralino === 'undefined') {
        throw new Error('Neutralino runtime not available');
    }

    const materialsRoot = `${repoPath}/materials`;
    const materials = [];
    const champions = new Set();

    // Walk the materials tree. Any directory containing snippet.json is a
    // material; the relative path becomes its `path`.
    async function walk(dir, relParts) {
        let entries;
        try {
            entries = await Neutralino.filesystem.readDirectory(dir);
        } catch (e) {
            return;
        }

        // If this directory has a snippet.json, it's a material — emit it
        // and don't recurse further into this subtree (materials shouldn't
        // nest inside each other).
        const hasSnippet = entries.some(
            e => e.type === 'FILE' && e.entry === 'snippet.json'
        );
        if (hasSnippet) {
            try {
                const meta = JSON.parse(
                    await Neutralino.filesystem.readFile(`${dir}/snippet.json`)
                );
                const path = relParts.join('/');
                const champion = detectChampion(relParts, meta);
                const skin = detectSkin(relParts, meta);
                if (champion) champions.add(champion);

                let hasPreview = false;
                for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
                    try {
                        const stats = await Neutralino.filesystem.getStats(
                            `${dir}/preview.${ext}`
                        );
                        if (stats?.size > 0) { hasPreview = true; break; }
                    } catch (e) {}
                }

                materials.push({
                    id: meta.id || relParts[relParts.length - 1],
                    path,
                    name: meta.name || relParts[relParts.length - 1],
                    category: meta.category || 'special',
                    champion,
                    skin,
                    description: meta.description || '',
                    tags: meta.tags || [],
                    hasPreview,
                    userSlots: (meta.userSlots || []).map(s => s.name || s),
                    featured: meta.featured ?? false,
                    version: meta.version ?? 1,
                    updatedAt: meta.updatedAt || new Date().toISOString(),
                    materialName: meta.materialName || null,
                });
            } catch (e) {
                console.warn(`Skipping ${dir}: ${e}`);
            }
            return;
        }

        // Otherwise recurse into subdirectories.
        for (const e of entries) {
            if (e.type !== 'DIRECTORY') continue;
            await walk(`${dir}/${e.entry}`, [...relParts, e.entry]);
        }
    }

    await walk(materialsRoot, []);

    // Stable ordering — by path so diffs are readable.
    materials.sort((a, b) => a.path.localeCompare(b.path));

    const index = {
        schemaVersion: 2,
        lastUpdated: new Date().toISOString(),
        categories: DEFAULT_CATEGORIES,
        champions: [...champions].sort(),
        materials,
    };

    await Neutralino.filesystem.writeFile(
        `${repoPath}/index.json`,
        JSON.stringify(index, null, 2)
    );

    return {
        materialCount: materials.length,
        categories: DEFAULT_CATEGORIES,
    };
}

// First path segment is the champion name, or `null` for curated
// materials living under `materials/general/...`. The Jade browser
// treats `champion === null` as "no champion" for the General bucket
// filter, so we must NOT emit the literal string "general" here.
function detectChampion(relParts, meta) {
    if (relParts.length >= 2) {
        const first = relParts[0].toLowerCase();
        if (first === 'general') return null;
        return first;
    }
    if (meta?.source?.champion) {
        const c = String(meta.source.champion).toLowerCase();
        return c === 'general' ? null : c;
    }
    return null;
}

// Skin segment — matches `skin<N>` anywhere in the path, or uses
// snippet.json metadata as a fallback.
function detectSkin(relParts, meta) {
    const hit = relParts.find(p => /^skin\d+$/i.test(p));
    if (hit) return hit.toLowerCase();
    if (meta?.source?.skin) return String(meta.source.skin).toLowerCase();
    return null;
}
