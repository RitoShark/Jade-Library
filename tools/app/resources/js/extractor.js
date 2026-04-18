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
import { dedupeMaterials, fingerprint } from './deduper.js';
import { repathMaterial } from './repather.js';
import { emitSnippet } from './snippetEmitter.js';
import { diffAgainstExisting } from './differ.js';
import { rebuildIndex } from './indexBuilder.js';

let progressEl, progressTextEl, logEl, startBtn, leaguePathEl, championFilterEl, wadExcludeEl;
let isRunning = false;

export function initExtractTab() {
    progressEl = document.getElementById('extract-progress-fill');
    progressTextEl = document.getElementById('extract-progress-text');
    logEl = document.getElementById('extract-log');
    startBtn = document.getElementById('start-extract');
    leaguePathEl = document.getElementById('league-path');
    championFilterEl = document.getElementById('champion-filter');
    wadExcludeEl = document.getElementById('wad-exclude');

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
    const wadExcludeTerms = (wadExcludeEl?.value || '')
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);

    isRunning = true;
    startBtn.disabled = true;
    clearLog();
    setProgress(0, 'Discovering WAD files…');
    setFooterStatus('Extraction: discovering WAD files…');

    try {
        await runPipeline(leaguePath, championFilter, wadExcludeTerms, cfg);
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

async function runPipeline(leaguePath, championFilter, wadExcludeTerms, cfg) {
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

    if (wadExcludeTerms && wadExcludeTerms.length > 0) {
        const beforeCount = wads.length;
        wads = wads.filter(w => {
            const nameLower = w.split(/[\\/]/).pop().toLowerCase();
            return !wadExcludeTerms.some(term => nameLower.includes(term));
        });
        const excluded = beforeCount - wads.length;
        if (excluded > 0) {
            logLine(`Excluded ${excluded} WAD(s) matching: ${wadExcludeTerms.join(', ')}`);
        }
    }

    logLine(`Found ${wads.length} champion WADs`);
    if (wads.length === 0) return;

    const tempDir = `${NL_PATH}/temp/extract-${Date.now()}`;
    await Neutralino.filesystem.createDirectory(tempDir).catch(() => {});

    // Streaming pipeline: for each champion WAD we extract, collect its
    // materials, emit any NEW ones (fingerprint-deduped against everything
    // seen before), then wipe the temp extraction for that champion so the
    // temp folder never grows past one champion's WAD worth of files.
    //
    // Global state across all champions:
    //   globalFingerprints: fingerprint → emitted material (for dedup)
    //   extractedWads:      names of champion WADs currently on-disk in
    //                       tempDir (reset after each champion wipe)
    //   allUniqueMaterials: collected list used for the final diff step
    const globalFingerprints = new Map();
    const extractedWads = new Set();
    const allUniqueMaterials = [];
    let totalCollected = 0;
    let emitted = 0;

    const ctx = {
        tempDir,
        repoPath: cfg.repoPath,
        leaguePath,
        extractedWads,
        logFn: logLine,
    };

    for (let i = 0; i < wads.length; i++) {
        const wad = wads[i];
        const champName = wad.split(/[\\/]/).pop().replace(/\.wad\.client$/i, '');
        const progressLabel = `(${i + 1}/${wads.length}) ${champName}`;
        // Reserve 90% of the bar for the per-champion loop; diff + index split the last 10%.
        setProgress((i / wads.length) * 90, progressLabel);

        const champMaterials = [];

        try {
            // 2. Extract this WAD into temp
            setFooterStatus(`${progressLabel} — extracting WAD…`);
            const wadOut = `${tempDir}/${champName}`;
            await Neutralino.filesystem.createDirectory(wadOut).catch(() => {});
            await wadExtract(wad, wadOut);
            // Store lowercase — resolveTargetWad returns lowercase champ
            // names extracted from asset paths, so the Set lookup has to
            // be case-insensitive or cross-ref fallback fires uselessly.
            extractedWads.add(champName.toLowerCase());

            // 3. Batch-convert every .bin in the extracted tree with one
            //    ritobin invocation.
            setFooterStatus(`${progressLabel} — batch converting bins…`);
            try {
                await ritobinBatchDir(wadOut);
            } catch (e) {
                logLine(`  ${champName}: batch convert failed: ${e}`, 'warning');
            }

            // 4. Walk the tree for material JSONs.
            setFooterStatus(`${progressLabel} — scanning materials…`);
            const bins = await findAllBins(wadOut);
            logLine(`  ${champName}: ${bins.length} bins`);

            for (let b = 0; b < bins.length; b++) {
                const binPath = bins[b];
                const binName = binPath.split(/[\\/]/).pop().replace(/\.bin$/i, '');
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
                    champMaterials.push(...found);
                } catch (e) {
                    logLine(`    ${binPath}: ${e}`, 'warning');
                }
            }

            totalCollected += champMaterials.length;

            // 5. Dedupe within the champion first (skins often share materials)
            //    then merge into the global fingerprint map. New fingerprints
            //    get emitted right here so we can delete the temp data.
            const champUnique = dedupeMaterials(champMaterials);
            logLine(`  ${champName}: ${champMaterials.length} entries → ${champUnique.length} unique`);

            setFooterStatus(`${progressLabel} — emitting snippets…`);
            for (let m = 0; m < champUnique.length; m++) {
                const mat = champUnique[m];
                const fp = fingerprint(mat);
                const existing = globalFingerprints.get(fp);
                if (existing) {
                    // Already emitted from a previous champion. Append the
                    // usage trace and re-write just snippet.json metadata so
                    // the usedBy list stays accurate. Textures already copied.
                    const usage = { champion: mat.sourceChampion, skin: mat.sourceSkin, bin: mat.sourceBin };
                    existing.usedBy.push(usage);
                    try {
                        await emitSnippet(existing, cfg.repoPath);
                    } catch (e) {
                        logLine(`    ${mat.name}: usedBy update failed: ${e}`, 'warning');
                    }
                    continue;
                }

                // New material — repath, emit, copy textures, store in map.
                try {
                    const repathed = repathMaterial(mat);
                    repathed.relPath = resolveRelPath(repathed);
                    repathed.usedBy = [{ champion: mat.sourceChampion, skin: mat.sourceSkin, bin: mat.sourceBin }];
                    setFooterStatus(`${progressLabel} — writing ${repathed.relPath}`);
                    await emitSnippet(repathed, cfg.repoPath);
                    await copyReferencedTextures(repathed, ctx);
                    globalFingerprints.set(fp, repathed);
                    allUniqueMaterials.push(repathed);
                    emitted++;
                } catch (e) {
                    logLine(`    ${mat.name}: emit failed: ${e}`, 'warning');
                }
            }
        } catch (e) {
            logLine(`  ${champName}: ${e}`, 'error');
        }

        // 6. Wipe the tempDir contents (current champ + any on-demand
        //    cross-champ extracts). Recreate the tempDir for the next iteration.
        setFooterStatus(`${progressLabel} — cleaning temp…`);
        try {
            await Neutralino.filesystem.remove(tempDir);
        } catch (e) {
            // Ignore — next iteration will recreate.
        }
        await Neutralino.filesystem.createDirectory(tempDir).catch(() => {});
        extractedWads.clear();
    }

    logLine(`\nCollected ${totalCollected} StaticMaterialDef entries across all champions`);
    logLine(`Emitted ${emitted} unique snippet folders`, 'success');

    setProgress(92, 'Cleaning up temp files…');
    setFooterStatus('Cleaning up temp files…');
    try {
        await Neutralino.filesystem.remove(tempDir);
    } catch (e) {
        logLine(`Temp cleanup failed: ${e}`, 'warning');
    }

    setProgress(96, 'Diffing against existing library…');
    setFooterStatus('Diffing against existing library…');
    try {
        const diff = await diffAgainstExisting(cfg.repoPath, allUniqueMaterials);
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

    // Some bin entries contain a double-extension path like
    //   foo_tx_cm.SKINS_Ahri_Skin88.tex
    // but the physical file is just foo_tx_cm.tex — strip the
    // `.SKINS_...` segment between the real extension and .tex.
    const cleaned = rel.replace(/\.SKINS_[^./]+(\.(?:tex|dds))$/i, '$1');

    const variants = new Set([rel, rel.toLowerCase()]);
    if (cleaned !== rel) {
        variants.add(cleaned);
        variants.add(cleaned.toLowerCase());
    }

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
