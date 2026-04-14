// Preview Image Submission tab.
//
// Drag-and-drop a PNG/JPG/WEBP, the canvas resizes it to a standard 512×288
// (16:9 thumbnail) for consistency, and saves it next to the selected
// material's snippet.json as preview.<ext>.

import { getConfig } from './config.js';

const PREVIEW_W = 512;
const PREVIEW_H = 288;

let materialSelect, dropZone, fileInput, saveBtn, previewThumb;
let pickedFile = null;
let pickedDataUrl = null;

export function initPreviewTab() {
    materialSelect = document.getElementById('preview-material-select');
    dropZone = document.getElementById('preview-drop-zone');
    fileInput = document.getElementById('preview-file-input');
    saveBtn = document.getElementById('save-preview');
    previewThumb = document.getElementById('preview-preview');

    populateMaterialList();

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

async function populateMaterialList() {
    if (!materialSelect) return;
    materialSelect.innerHTML = '<option value="">— Select a material —</option>';

    const cfg = getConfig();
    if (!cfg.repoPath || typeof Neutralino === 'undefined') return;

    try {
        const dirs = await Neutralino.filesystem.readDirectory(`${cfg.repoPath}/materials`);
        for (const d of dirs) {
            if (d.type !== 'DIRECTORY') continue;
            const opt = document.createElement('option');
            opt.value = d.entry;
            opt.textContent = d.entry;
            materialSelect.appendChild(opt);
        }
    } catch (e) {
        console.warn('Failed to list materials:', e);
    }
}

function handleFile(file) {
    pickedFile = file;
    const reader = new FileReader();
    reader.onload = () => {
        // Show a thumbnail before resizing
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
        // Strip the data URL prefix and decode to bytes via fetch
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

// Re-populate when the tab gets re-activated. The current tab routing
// only inits a tab once, but we expose this so a manual refresh hook can
// call it later.
export function refreshPreviewTab() {
    populateMaterialList();
}
