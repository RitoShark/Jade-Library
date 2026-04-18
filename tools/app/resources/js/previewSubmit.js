// Preview Image Submission tab.
//
// Two-stage picker: champion → material. Walks materials/** looking for
// snippet.json files, groups by champion (first path segment), and keeps
// a special "general" bucket for curated / manually inserted materials.
// Drop a PNG/JPG/WEBP on the drop zone, canvas resizes it to 512×288,
// then saves it as preview.png in the picked material's folder.

import { getConfig } from './config.js';

const PREVIEW_W = 512;
const PREVIEW_H = 288;

let champSelect, materialSelect, dropZone, fileInput, saveBtn, previewThumb;
let pickedFile = null;
let pickedDataUrl = null;

// Flat list of { path, dir, name, champion } built from the repo scan.
// Rebuilt on refresh; re-filtered when the champion dropdown changes.
let allMaterials = [];

export function initPreviewTab() {
    champSelect = document.getElementById('preview-champion-select');
    materialSelect = document.getElementById('preview-material-select');
    dropZone = document.getElementById('preview-drop-zone');
    fileInput = document.getElementById('preview-file-input');
    saveBtn = document.getElementById('save-preview');
    previewThumb = document.getElementById('preview-preview');

    populateMaterialList();

    champSelect?.addEventListener('change', onChampionChanged);
    materialSelect?.addEventListener('change', () => {
        saveBtn.disabled = !(pickedDataUrl && materialSelect.value);
    });

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const file = e.dataTransfer?.files?.[0];
        if (file) handleFile(file);
    });
    fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (file) handleFile(file);
    });

    saveBtn.addEventListener('click', savePreview);
}

// Walk materials/** looking for snippet.json, the same way the Manage tab does.
async function walkMaterials(root) {
    if (typeof Neutralino === 'undefined') return [];
    const results = [];

    async function walk(dir, relParts) {
        let entries;
        try {
            entries = await Neutralino.filesystem.readDirectory(dir);
        } catch (e) {
            return;
        }
        const hasSnippet = entries.some(e => e.type === 'FILE' && e.entry === 'snippet.json');
        if (hasSnippet) {
            try {
                const text = await Neutralino.filesystem.readFile(`${dir}/snippet.json`);
                const meta = JSON.parse(text);
                const relPath = relParts.join('/');
                const champion = relParts[0]?.toLowerCase() || 'general';
                results.push({
                    path: relPath,
                    dir,
                    name: meta.name || meta.id || relPath.split('/').pop(),
                    champion,
                });
            } catch (e) {
                console.warn(`Failed to read ${dir}/snippet.json:`, e);
            }
            return;
        }
        for (const e of entries) {
            if (e.type === 'DIRECTORY') {
                await walk(`${dir}/${e.entry}`, [...relParts, e.entry]);
            }
        }
    }

    await walk(root, []);
    results.sort((a, b) => a.path.localeCompare(b.path));
    return results;
}

async function populateMaterialList() {
    if (!champSelect || !materialSelect) return;

    const cfg = getConfig();
    if (!cfg.repoPath || typeof Neutralino === 'undefined') {
        champSelect.innerHTML = '<option value="">— Repo path not configured —</option>';
        return;
    }

    champSelect.innerHTML = '<option value="">Loading…</option>';
    materialSelect.disabled = true;
    materialSelect.innerHTML = '<option value="">— Pick a champion first —</option>';

    try {
        allMaterials = await walkMaterials(`${cfg.repoPath}/materials`);
    } catch (e) {
        console.warn('Failed to walk materials:', e);
        allMaterials = [];
    }

    const champions = new Set();
    for (const m of allMaterials) champions.add(m.champion);
    const hasGeneral = champions.has('general');
    champions.delete('general');
    const sorted = [...champions].sort();

    const options = ['<option value="">— Select a champion —</option>'];
    if (hasGeneral) {
        const generalCount = allMaterials.filter(m => m.champion === 'general').length;
        options.push(`<option value="general">General / Curated (${generalCount})</option>`);
        options.push('<option disabled>──────────</option>');
    }
    for (const champ of sorted) {
        const count = allMaterials.filter(m => m.champion === champ).length;
        options.push(`<option value="${escapeAttr(champ)}">${escapeHtml(capitalize(champ))} (${count})</option>`);
    }
    champSelect.innerHTML = options.join('');
}

function onChampionChanged() {
    const champ = champSelect.value;
    if (!champ) {
        materialSelect.disabled = true;
        materialSelect.innerHTML = '<option value="">— Pick a champion first —</option>';
        saveBtn.disabled = true;
        return;
    }
    const mats = allMaterials.filter(m => m.champion === champ);
    const options = ['<option value="">— Select a material —</option>'];
    for (const m of mats) {
        // path relative to materials/ folder — used by savePreview as the
        // target folder
        options.push(`<option value="${escapeAttr(m.path)}">${escapeHtml(m.name)} · ${escapeHtml(m.path)}</option>`);
    }
    materialSelect.innerHTML = options.join('');
    materialSelect.disabled = false;
    saveBtn.disabled = !(pickedDataUrl && materialSelect.value);
}

function handleFile(file) {
    pickedFile = file;
    const reader = new FileReader();
    reader.onload = () => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = PREVIEW_W;
            canvas.height = PREVIEW_H;
            const ctx = canvas.getContext('2d');

            // Cover-fit the source image into the canvas (crop overflow)
            const srcRatio = img.width / img.height;
            const dstRatio = PREVIEW_W / PREVIEW_H;
            let sx, sy, sw, sh;
            if (srcRatio > dstRatio) {
                sh = img.height;
                sw = sh * dstRatio;
                sx = (img.width - sw) / 2;
                sy = 0;
            } else {
                sw = img.width;
                sh = sw / dstRatio;
                sx = 0;
                sy = (img.height - sh) / 2;
            }
            ctx.drawImage(img, sx, sy, sw, sh, 0, 0, PREVIEW_W, PREVIEW_H);

            pickedDataUrl = canvas.toDataURL('image/png');
            previewThumb.innerHTML = `<img src="${pickedDataUrl}" alt="preview" />`;
            previewThumb.hidden = false;
            saveBtn.disabled = !materialSelect.value;
        };
        img.src = reader.result;
    };
    reader.readAsDataURL(file);
}

async function savePreview() {
    if (!pickedDataUrl || !materialSelect.value) return;
    const cfg = getConfig();
    if (!cfg.repoPath || typeof Neutralino === 'undefined') return;

    saveBtn.disabled = true;
    try {
        const base64 = pickedDataUrl.replace(/^data:image\/png;base64,/, '');
        const target = `${cfg.repoPath}/materials/${materialSelect.value}/preview.png`;
        await Neutralino.filesystem.writeBinaryFile(target, base64ToArrayBuffer(base64));
        saveBtn.textContent = 'Saved ✓';
        setTimeout(() => {
            saveBtn.textContent = 'Save preview';
            saveBtn.disabled = false;
        }, 1500);
    } catch (e) {
        console.error(e);
        saveBtn.disabled = false;
    }
}

function base64ToArrayBuffer(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

function escapeAttr(s) { return escapeHtml(s); }

// Re-populate when the tab gets re-activated.
export function refreshPreviewTab() {
    populateMaterialList();
}
