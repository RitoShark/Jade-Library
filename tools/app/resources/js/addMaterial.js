// Add tab — paste a ritobin StaticMaterialDef snippet and save it to
// the library as a new material folder. Skips the full extractor: writes
// snippet.txt + snippet.json directly into the computed target path based
// on champion/skin hints.
//
// Folder layout mirrors the extractor's output:
//   materials/<champion>/skin<N>/<id>/   (champion + skin)
//   materials/<champion>/<id>/           (champion-wide)
//   materials/general/<id>/              (no champion — curated)

import { getConfig } from './config.js';
import { CATEGORIES } from './classifier.js';

let snippetEl, nameEl, idEl, categoryEl, championEl, skinEl,
    descriptionEl, tagsEl, featuredEl, saveBtn, clearBtn, statusEl,
    parseStatusEl, previewEl;

let parsedSnippet = null; // { materialName, samplerCount, userSlots, textureFiles }

export function initAddTab() {
    snippetEl      = document.getElementById('add-snippet');
    nameEl         = document.getElementById('add-name');
    idEl           = document.getElementById('add-id');
    categoryEl     = document.getElementById('add-category');
    championEl     = document.getElementById('add-champion');
    skinEl         = document.getElementById('add-skin');
    descriptionEl  = document.getElementById('add-description');
    tagsEl         = document.getElementById('add-tags');
    featuredEl     = document.getElementById('add-featured');
    saveBtn        = document.getElementById('add-save');
    clearBtn       = document.getElementById('add-clear');
    statusEl       = document.getElementById('add-status');
    parseStatusEl  = document.getElementById('add-parse-status');
    previewEl      = document.getElementById('add-preview');

    // Populate category dropdown
    categoryEl.innerHTML = CATEGORIES
        .map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
        .join('');

    snippetEl?.addEventListener('input', parseSnippetLive);
    saveBtn?.addEventListener('click', handleSave);
    clearBtn?.addEventListener('click', clearForm);
}

// ── Ritobin snippet parser (lightweight) ──────────────────────────────────
//
// We don't need a full parser — just enough to extract:
//   - entryKey  (the "name" before = StaticMaterialDef)
//   - materialName (the inner `name: string = "..."` field, usually same)
//   - sampler count + TextureName/texturePath pairs
function parseSnippet(text) {
    if (!text || !text.trim()) return null;

    // Entry key: "name" = StaticMaterialDef {
    const entryRe = /^\s*"([^"]+)"\s*=\s*StaticMaterialDef\s*\{/m;
    const entryMatch = entryRe.exec(text);
    if (!entryMatch) return null;
    const entryKey = entryMatch[1];

    // Inner name field
    const innerNameRe = /\bname\s*:\s*string\s*=\s*"([^"]+)"/i;
    const innerNameMatch = innerNameRe.exec(text);
    const materialName = innerNameMatch ? innerNameMatch[1] : entryKey;

    // Collect every StaticMaterialShaderSamplerDef block's TextureName + texturePath
    const samplers = [];
    const blockRe = /StaticMaterialShaderSamplerDef\s*\{([^}]*)\}/g;
    let m;
    while ((m = blockRe.exec(text)) !== null) {
        const body = m[1];
        const nameMatch = /TextureName\s*:\s*string\s*=\s*"([^"]+)"/.exec(body);
        const pathMatch = /texturePath\s*:\s*string\s*=\s*"([^"]+)"/.exec(body);
        samplers.push({
            name: nameMatch ? nameMatch[1] : '(no TextureName)',
            path: pathMatch ? pathMatch[1] : '',
        });
    }

    // User slots = samplers whose TextureName looks like a user-facing slot
    // (Diffuse_Texture, MainTex, EmissiveTex, etc.)
    const userSlotNames = new Set([
        'diffuse_texture', 'maintex', 'main_texture', 'basetex', 'base_texture',
        'diffuse', 'albedo', 'emissivetex', 'emissive',
    ]);
    const userSlots = samplers
        .filter(s => userSlotNames.has(s.name.toLowerCase()))
        .map(s => ({ name: s.name, kind: 'diffuse', description: '' }));

    const textureFiles = samplers
        .filter(s => s.path && /\.(tex|dds)$/i.test(s.path))
        .map(s => ({
            name: s.path.split(/[\\/]/).pop(),
            updatedAt: new Date().toISOString(),
        }));

    return {
        entryKey,
        materialName,
        samplerCount: samplers.length,
        samplers,
        userSlots,
        textureFiles,
    };
}

function parseSnippetLive() {
    const text = snippetEl.value;
    parsedSnippet = parseSnippet(text);

    if (!parsedSnippet) {
        parseStatusEl.textContent = text.trim() ? 'Could not detect a StaticMaterialDef entry.' : '';
        parseStatusEl.className = text.trim() ? 'form-hint error' : 'form-hint';
        previewEl.hidden = true;
        return;
    }

    parseStatusEl.textContent = `Detected: ${parsedSnippet.entryKey} · ${parsedSnippet.samplerCount} sampler${parsedSnippet.samplerCount !== 1 ? 's' : ''}`;
    parseStatusEl.className = 'form-hint success';

    // Auto-fill the ID + name if they're empty
    if (!idEl.value.trim()) {
        idEl.value = slugify(parsedSnippet.materialName);
    }
    if (!nameEl.value.trim()) {
        nameEl.value = humanizeName(parsedSnippet.materialName);
    }

    const samplerLines = parsedSnippet.samplers
        .map(s => `  ${s.name.padEnd(24, ' ')} ${s.path || '(no path)'}`)
        .join('\n');
    previewEl.textContent = `entryKey: ${parsedSnippet.entryKey}\nmaterialName: ${parsedSnippet.materialName}\nsamplers (${parsedSnippet.samplerCount}):\n${samplerLines}`;
    previewEl.hidden = false;
}

// ── Save ───────────────────────────────────────────────────────────────────
async function handleSave() {
    setStatus('', '');

    if (!parsedSnippet) {
        setStatus('Paste a valid StaticMaterialDef snippet first.', 'error');
        return;
    }

    const cfg = getConfig();
    if (!cfg.repoPath) {
        setStatus('Repo path not configured — open Settings.', 'error');
        return;
    }
    if (typeof Neutralino === 'undefined') {
        setStatus('Neutralino runtime not available.', 'error');
        return;
    }

    const id = (idEl.value.trim() || slugify(parsedSnippet.materialName));
    const name = nameEl.value.trim() || humanizeName(parsedSnippet.materialName);
    const category = categoryEl.value;
    const champion = championEl.value.trim().toLowerCase();
    let skin = skinEl.value.trim().toLowerCase();
    if (skin && !/^skin\d+$/.test(skin)) {
        // Accept "77" → "skin77"
        if (/^\d+$/.test(skin)) skin = `skin${skin}`;
        else {
            setStatus(`Skin must look like "skin<N>" (got "${skin}").`, 'error');
            return;
        }
    }
    const description = descriptionEl.value.trim();
    const tags = tagsEl.value.split(',').map(t => t.trim()).filter(Boolean);
    const featured = featuredEl.checked;

    // Build the target relative path
    let relPath;
    if (champion && skin) relPath = `${champion}/${skin}/${id}`;
    else if (champion)    relPath = `${champion}/${id}`;
    else                  relPath = `general/${id}`;

    const matDir = `${cfg.repoPath}/materials/${relPath}`;

    // Don't clobber an existing material
    try {
        const stat = await Neutralino.filesystem.getStats(`${matDir}/snippet.json`);
        if (stat) {
            setStatus(`A material already exists at ${relPath}. Change the ID or champion/skin.`, 'error');
            return;
        }
    } catch (e) { /* path doesn't exist — good */ }

    saveBtn.disabled = true;
    try {
        await ensureDirRecursive(matDir);
        await ensureDir(`${matDir}/textures`);

        await Neutralino.filesystem.writeFile(`${matDir}/snippet.txt`, snippetEl.value);

        const meta = {
            id,
            name,
            category,
            version: 1,
            updatedAt: new Date().toISOString(),
            description,
            userSlots: parsedSnippet.userSlots,
            materialName: parsedSnippet.materialName,
            textureFiles: parsedSnippet.textureFiles,
            snippetFile: 'snippet.txt',
            source: {
                champion: champion || null,
                skin: skin || null,
                bin: null,
                entryKey: parsedSnippet.entryKey,
            },
            tags,
            featured,
            usedBy: [],
        };
        await Neutralino.filesystem.writeFile(`${matDir}/snippet.json`, JSON.stringify(meta, null, 2));

        setStatus(`Added at ${relPath} — rebuild the index to surface it.`, 'success');
    } catch (e) {
        setStatus(`Save failed: ${e}`, 'error');
    } finally {
        saveBtn.disabled = false;
    }
}

function clearForm() {
    snippetEl.value = '';
    nameEl.value = '';
    idEl.value = '';
    championEl.value = '';
    skinEl.value = '';
    descriptionEl.value = '';
    tagsEl.value = '';
    featuredEl.checked = false;
    categoryEl.selectedIndex = 0;
    parsedSnippet = null;
    parseStatusEl.textContent = '';
    previewEl.hidden = true;
    setStatus('', '');
}

function setStatus(text, kind) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = `manage-save-status${kind ? ' ' + kind : ''}`;
}

// ── Utilities ─────────────────────────────────────────────────────────────
// Neutralino's createDirectory only creates leaves; walk up manually.
async function ensureDirRecursive(dir) {
    const parts = dir.replace(/\\/g, '/').split('/');
    let current = '';
    for (const p of parts) {
        if (!p) { current = '/'; continue; }
        current = current ? (current === '/' ? '/' + p : `${current}/${p}`) : p;
        try {
            await Neutralino.filesystem.createDirectory(current);
        } catch (e) {
            // Already exists → ignore; other errors bubble when we try to write.
        }
    }
}

async function ensureDir(dir) {
    try { await Neutralino.filesystem.createDirectory(dir); } catch (e) {}
}

function slugify(s) {
    return String(s)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        || 'material';
}

function humanizeName(s) {
    // "ahri_tails_panner_fresnel_inst" → "Ahri Tails Panner Fresnel Inst"
    return String(s)
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .map(w => w ? w[0].toUpperCase() + w.slice(1) : w)
        .join(' ');
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}
