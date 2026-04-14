// Extractor tab — orchestrates the full extraction pipeline.
//
// V1 scope: champion skins only.
//   1. Walk Game/DATA/FINAL/Champions/*.wad.client
//   2. Extract each WAD into a temp folder via wad-extract
//   3. Walk the extracted tree for skin*.bin files
//   4. Convert each bin to JSON via ritobin
//   5. Walk JSON tree, collect StaticMaterialDef entries
//   6. Dedupe via fingerprint
//   7. Repath shader textures to assets/jadelib/<id>/
//   8. Emit snippet.json + snippet.txt + textures/
//   9. Diff against existing repo
//  10. Regenerate index.json
//
// Continue-on-error throughout — log each failure, never abort the whole run.

import { getConfig, isConfigComplete, saveConfig } from './config.js';
import { wadExtract, ritobinBatchDir } from './toolRunner.js';
import { findMaterials } from './materialWalker.js';
import { dedupeMaterials } from './deduper.js';
import { repathMaterial } from './repather.js';
import { emitSnippet } from './snippetEmitter.js';
import { diffAgainstExisting } from './differ.js';
import { rebuildIndex } from './indexBuilder.js';

let progressEl, progressTextEl, logEl, startBtn, leaguePathEl, championFilterEl;
let isRunning = false;

export function initExtractTab() {
    progressEl = document.getElementById('extract-progress-fill');
    progressTextEl = document.getElementById('extract-progress-text');
    logEl = document.getElementById('extract-log');
    startBtn = document.getElementById('start-extract');
    leaguePathEl = document.getElementById('league-path');
    championFilterEl = document.getElementById('champion-filter');

    // Restore the last-used League install path from config.
    const saved = getConfig().leaguePath;
    if (saved && leaguePathEl) leaguePathEl.value = saved;

    // Persist whenever the user edits it directly.
    leaguePathEl?.addEventListener('change', () => {
        saveConfig({ leaguePath: leaguePathEl.value.trim() });
    });

    document.getElementById('league-path-browse')?.addEventListener('click', async () => {
        if (typeof Neutralino === 'undefined') return;
        const dir = await Neutralino.os.showFolderDialog('Select League install Game folder');
        if (dir) {
            leaguePathEl.value = dir;
            await saveConfig({ leaguePath: dir });
        }
    });

    startBtn.addEventListener('click', startExtraction);
}

function setProgress(pct, text) {
    if (progressEl) progressEl.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    if (progressTextEl && text) progressTextEl.textContent = text;
}

function setFooterStatus(text) {
    const el = document.getElementById('app-footer-status');
    if (el) el.textContent = text;
}

function logLine(line, kind = '') {
    if (!logEl) return;
    const div = document.createElement('div');
    div.className = `log-line ${kind ? 'log-' + kind : ''}`;
    div.textContent = line;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
}

function clearLog() {
    if (logEl) logEl.innerHTML = '';
}

async function startExtraction() {
    if (isRunning) return;
    if (!isConfigComplete()) {
        logLine('Setup is incomplete — open the Settings tab to configure tool paths.', 'error');
        return;
    }

    const cfg = getConfig();
    const leaguePath = leaguePathEl.value.trim();
    if (!leaguePath) {
        logLine('League install path is required.', 'error');
        return;
    }
    await saveConfig({ leaguePath });
    const championFilter = championFilterEl.value.trim().toLowerCase();

    isRunning = true;
    startBtn.disabled = true;
    clearLog();
    setProgress(0, 'Discovering WAD files…');
    setFooterStatus('Extraction: discovering WAD files…');

    try {
        await runPipeline(leaguePath, championFilter, cfg);
        setProgress(100, 'Done');
        setFooterStatus('Extraction complete');
        logLine('Pipeline completed.', 'success');
    } catch (e) {
        logLine(`Fatal error: ${e}`, 'error');
        setProgress(0, 'Failed');
        setFooterStatus(`Extraction failed: ${e}`);
    } finally {
        isRunning = false;
        startBtn.disabled = false;
    }
}

async function runPipeline(leaguePath, championFilter, cfg) {
    if (typeof Neutralino === 'undefined') {
        throw new Error('Neutralino not available — extraction needs filesystem and exec APIs');
    }

    // 1. Discover WAD files
    const champWadDir = `${leaguePath}/DATA/FINAL/Champions`;
    let wads = [];
    try {
        const entries = await Neutralino.filesystem.readDirectory(champWadDir);
        wads = entries
            .filter(e => {
                if (e.type !== 'FILE') return false;
                const n = e.entry.toLowerCase();
                if (!n.endsWith('.wad.client')) return false;
                // Skip locale WADs (voiceover): Ahri.en_US.wad.client, etc.
                // Any filename with a locale segment like .xx_YY. before .wad.client
                if (/\.[a-z]{2}_[a-z]{2}\.wad\.client$/i.test(e.entry)) return false;
                return true;
            })
            .map(e => `${champWadDir}/${e.entry}`);
    } catch (e) {
        throw new Error(`Failed to read ${champWadDir}: ${e}`);
    }

    if (championFilter) {
        wads = wads.filter(w => w.toLowerCase().includes(championFilter));
    }

    logLine(`Found ${wads.length} champion WADs`);
    if (wads.length === 0) return;

    const tempDir = `${NL_PATH}/temp/extract-${Date.now()}`;
    await Neutralino.filesystem.createDirectory(tempDir).catch(() => {});

    const allMaterials = [];

    for (let i = 0; i < wads.length; i++) {
        const wad = wads[i];
        const champName = wad.split(/[\\/]/).pop().replace(/\.wad\.client$/i, '');
        const progressLabel = `(${i + 1}/${wads.length}) ${champName}`;
        setProgress((i / wads.length) * 90, progressLabel);

        try {
            // 2. Extract this WAD into temp
            setFooterStatus(`${progressLabel} — extracting WAD…`);
            const wadOut = `${tempDir}/${champName}`;
            await Neutralino.filesystem.createDirectory(wadOut).catch(() => {});
            await wadExtract(wad, wadOut);

            // 3. Batch-convert every .bin in the extracted tree with one
            //    ritobin invocation. Hashes only get loaded once, so this
            //    is orders of magnitude faster than spawning ritobin per bin.
            setFooterStatus(`${progressLabel} — batch converting bins…`);
            try {
                await ritobinBatchDir(wadOut);
            } catch (e) {
                logLine(`  ${champName}: batch convert failed: ${e}`, 'warning');
            }

            // 4. Walk the tree for material JSONs. Filter out animation bins
            //    and read each JSON that ritobin produced.
            setFooterStatus(`${progressLabel} — scanning materials…`);
            const bins = await findAllBins(wadOut);
            logLine(`  ${champName}: ${bins.length} bins`);

            for (let b = 0; b < bins.length; b++) {
                const binPath = bins[b];
                const binName = binPath.split(/[\\/]/).pop().replace(/\.bin$/i, '');
                // Relative path from the wad root, for snippet.json traceability.
                const relBin = binPath.startsWith(wadOut)
                    ? binPath.slice(wadOut.length + 1)
                    : binPath;
                if (b % 20 === 0 || b === bins.length - 1) {
                    setFooterStatus(
                        `${progressLabel} — scanning (${b + 1}/${bins.length}) ${binName}`
                    );
                }
                try {
                    const tree = await readBinJson(binPath);
                    if (!tree) continue;
                    const found = findMaterials(tree, champName, binName, relBin);
                    allMaterials.push(...found);
                } catch (e) {
                    logLine(`    ${binPath}: ${e}`, 'warning');
                }
            }
        } catch (e) {
            logLine(`  ${champName}: ${e}`, 'error');
        }
    }

    logLine(`\nCollected ${allMaterials.length} StaticMaterialDef entries`);
    setProgress(90, 'Deduplicating…');
    setFooterStatus('Deduplicating materials…');

    // 6. Dedupe
    const unique = dedupeMaterials(allMaterials);
    logLine(`Reduced to ${unique.length} unique materials`);

    setProgress(92, 'Repathing & emitting snippets…');
    setFooterStatus('Repathing & emitting snippets…');

    // Track which champion WADs we've already extracted into tempDir so the
    // cross-champion texture lookup can trigger on-demand extractions without
    // re-running the same WAD twice.
    const extractedWads = new Set(
        wads.map(w => w.split(/[\\/]/).pop().replace(/\.wad\.client$/i, ''))
    );
    const ctx = {
        tempDir,
        repoPath: cfg.repoPath,
        leaguePath,
        extractedWads,
        logFn: logLine,
    };

    // 7-9. For each unique material: repath, resolve its repo-relative path
    //      (champion/skin or champion), emit, copy referenced textures.
    let emitted = 0;
    for (let m = 0; m < unique.length; m++) {
        const mat = unique[m];
        try {
            const repathed = repathMaterial(mat);
            repathed.relPath = resolveRelPath(repathed);
            setFooterStatus(
                `Writing snippet (${m + 1}/${unique.length}) ${repathed.relPath}`
            );
            await emitSnippet(repathed, cfg.repoPath);
            setFooterStatus(
                `Copying textures (${m + 1}/${unique.length}) ${repathed.relPath}`
            );
            await copyReferencedTextures(repathed, ctx);
            emitted++;
        } catch (e) {
            logLine(`Failed to emit ${mat.name}: ${e}`, 'warning');
        }
    }
    logLine(`Wrote ${emitted}/${unique.length} snippet folders`);

    // Clean up the temp wad-extract dump — we only wanted the referenced
    // textures, which are now copied into the material output folders.
    setFooterStatus('Cleaning up temp files…');
    try {
        await Neutralino.filesystem.remove(tempDir);
    } catch (e) {
        logLine(`Temp cleanup failed: ${e}`, 'warning');
    }

    setProgress(96, 'Diffing against existing library…');
    setFooterStatus('Diffing against existing library…');
    try {
        const diff = await diffAgainstExisting(cfg.repoPath, unique);
        logLine(`Diff: +${diff.added.length} new, ~${diff.changed.length} changed, -${diff.removed.length} removed`, 'success');
    } catch (e) {
        logLine(`Diff failed: ${e}`, 'warning');
    }

    setProgress(98, 'Rebuilding index.json…');
    setFooterStatus('Rebuilding index.json…');
    try {
        await rebuildIndex(cfg.repoPath);
        logLine('index.json rebuilt', 'success');
    } catch (e) {
        logLine(`Index rebuild failed: ${e}`, 'warning');
    }
}

// For each shader texture referenced by this material (originalGamePath set by
// the repather), locate the actual file in the temp extraction tree and copy
// it into `<repo>/materials/<id>/textures/<filename>`. Only .tex/.dds files
// are copied — anything else the sampler happens to point at is ignored.
async function copyReferencedTextures(mat, ctx) {
    if (typeof Neutralino === 'undefined') return;
    const files = mat.textureFiles || [];
    if (files.length === 0) return;

    const rel = mat.relPath || mat.id;
    const outDir = `${ctx.repoPath}/materials/${rel}/textures`;
    await Neutralino.filesystem.createDirectory(outDir).catch(() => {});

    for (const f of files) {
        const orig = (f.originalGamePath || '').trim();
        if (!orig) continue;
        if (!/\.(tex|dds)$/i.test(orig)) continue;

        // First pass — look in any already-extracted tree (source champ
        // plus any WADs extracted earlier in this run).
        let src = await findTextureInTemp(ctx.tempDir, orig);

        // Second pass — figure out which WAD this texture belongs to based on
        // its path (Characters/<Champ>/... or Shared/...), extract it if we
        // haven't already, then try again.
        if (!src) {
            const targetWad = resolveTargetWad(orig);
            if (targetWad && !ctx.extractedWads.has(targetWad)) {
                const ok = await extractOnDemand(targetWad, ctx);
                if (ok) {
                    ctx.extractedWads.add(targetWad);
                    src = await findTextureInTemp(ctx.tempDir, orig);
                }
            }
        }

        if (!src) {
            ctx.logFn(`    Missing texture ${orig}`, 'warning');
            continue;
        }
        try {
            const bytes = await Neutralino.filesystem.readBinaryFile(src);
            await Neutralino.filesystem.writeBinaryFile(`${outDir}/${f.name}`, bytes);
        } catch (e) {
            ctx.logFn(`    Copy failed ${orig}: ${e}`, 'warning');
        }
    }
}

// Walk every extracted champion subfolder under tempDir and try both the
// original-case and lowercased variants of the game path.
async function findTextureInTemp(tempDir, originalGamePath) {
    const rel = originalGamePath.replace(/\\/g, '/');
    const variants = [rel, rel.toLowerCase()];
    let roots = [];
    try {
        const entries = await Neutralino.filesystem.readDirectory(tempDir);
        roots = entries
            .filter(e => e.type === 'DIRECTORY')
            .map(e => `${tempDir}/${e.entry}`);
    } catch (e) {
        return null;
    }
    for (const root of roots) {
        for (const v of variants) {
            const full = `${root}/${v}`;
            try {
                const stats = await Neutralino.filesystem.getStats(full);
                if (stats && !stats.isDirectory) return full;
            } catch (e) {}
        }
    }
    return null;
}

// Figure out which WAD file we need to extract based on the texture path.
// Returns the WAD basename (without .wad.client), or null if we don't know
// how to resolve it.
function resolveTargetWad(originalGamePath) {
    const norm = originalGamePath.replace(/\\/g, '/').toLowerCase();
    // ASSETS/Characters/<ChampName>/...
    const champ = norm.match(/(?:^|\/)assets\/characters\/([^/]+)\//);
    if (champ) {
        // Capitalize first letter — League WAD filenames use PascalCase
        // (e.g. Ahri.wad.client, MonkeyKing.wad.client). Hash resolution gives
        // us lowercase in paths, so we only need to match case-insensitively
        // later when the WAD extractor reads its own filename.
        return champ[1];
    }
    return null;
}

async function extractOnDemand(champName, ctx) {
    const champWadDir = `${ctx.leaguePath}/DATA/FINAL/Champions`;
    // Try common casings for the WAD filename.
    const candidates = [
        `${champWadDir}/${champName}.wad.client`,
        `${champWadDir}/${capitalize(champName)}.wad.client`,
    ];
    let wadPath = null;
    for (const c of candidates) {
        try {
            const stats = await Neutralino.filesystem.getStats(c);
            if (stats && !stats.isDirectory) { wadPath = c; break; }
        } catch (e) {}
    }
    // Fallback: directory listing, case-insensitive match.
    if (!wadPath) {
        try {
            const entries = await Neutralino.filesystem.readDirectory(champWadDir);
            const target = entries.find(e =>
                e.type === 'FILE' &&
                e.entry.toLowerCase() === `${champName.toLowerCase()}.wad.client`
            );
            if (target) wadPath = `${champWadDir}/${target.entry}`;
        } catch (e) {}
    }
    if (!wadPath) {
        ctx.logFn(`    Cross-ref WAD not found: ${champName}`, 'warning');
        return false;
    }

    const outDir = `${ctx.tempDir}/${champName}`;
    try {
        await Neutralino.filesystem.createDirectory(outDir);
    } catch (e) {}
    try {
        ctx.logFn(`    Extracting cross-ref WAD ${champName}…`);
        await wadExtract(wadPath, outDir);
        return true;
    } catch (e) {
        ctx.logFn(`    Cross-ref extract failed (${champName}): ${e}`, 'warning');
        return false;
    }
}

function capitalize(s) {
    if (!s) return s;
    return s[0].toUpperCase() + s.slice(1);
}

// Decide where a material lives inside the repo tree:
//   materials/<champion>/skin<N>/<id>/   when the source bin is a skin bin
//   materials/<champion>/<id>/           for any other champion bin
// Falls back to just <id> if we can't identify the champion (shouldn't happen
// for extracted materials — only for hand-curated ones which live under
// materials/general/ and are placed by hand).
function resolveRelPath(mat) {
    const champ = (mat.sourceChampion || '').toLowerCase();
    if (!champ) return mat.id;

    // Prefer the walker-derived sourceSkin (which reads it from entryKey —
    // always accurate for a specific material). Fall back to parsing the
    // bin filename if for any reason the walker couldn't determine it.
    let skin = (mat.sourceSkin || '').toLowerCase();
    if (!/^skin\d+$/.test(skin)) {
        const m = (mat.sourceBin || '').toLowerCase().match(/\bskin(\d+)\b/);
        skin = m ? `skin${m[1]}` : '';
    }
    if (skin) {
        return `${champ}/${skin}/${mat.id}`;
    }
    return `${champ}/${mat.id}`;
}

// Read the ritobin-produced JSON for a given .bin path. Ritobin's recursive
// mode may either append .json to the full filename (`skin0.bin.json`) or
// replace the .bin extension (`skin0.json`), so we try both.
async function readBinJson(binPath) {
    const candidates = [
        `${binPath}.json`,
        binPath.replace(/\.bin$/i, '.json'),
    ];
    for (const p of candidates) {
        try {
            const text = await Neutralino.filesystem.readFile(p);
            if (text) return JSON.parse(text);
        } catch (e) {}
    }
    return null;
}

async function findAllBins(rootDir) {
    if (typeof Neutralino === 'undefined') return [];
    const out = [];
    async function walk(dir) {
        let entries = [];
        try {
            entries = await Neutralino.filesystem.readDirectory(dir);
        } catch (e) {
            return;
        }
        for (const e of entries) {
            const full = `${dir}/${e.entry}`;
            if (e.type === 'DIRECTORY') {
                await walk(full);
            } else if (e.type === 'FILE' && /\.bin$/i.test(e.entry)) {
                out.push(full);
            }
        }
    }
    await walk(rootDir);
    return out;
}
