// First-run setup wizard
//
// Shown when config.json is missing or any required path is empty.
// Walks the user through pointing at ritobin, wad-extract, wad-list, hashes,
// and the local jade-library repo folder.

import { getConfig, saveConfig, isConfigComplete } from './config.js';
import { probeTool } from './toolRunner.js';

const FIELDS = [
    {
        key: 'ritobinPath',
        label: 'ritobin.exe',
        hint: 'Used to convert .bin files to JSON.',
        keyword: 'ritobin',
        ext: ['exe'],
    },
    {
        key: 'wadExtractPath',
        label: 'wad-extract.exe',
        hint: 'Used to extract files from WAD archives (cslol-tools).',
        keyword: 'wad',
        ext: ['exe'],
    },
    {
        key: 'hashesDir',
        label: 'Hashes folder',
        hint: 'League hash tables. Reuse Jade\'s existing %APPDATA%\\FrogTools\\hashes if you have it.',
        directory: true,
    },
    {
        key: 'repoPath',
        label: 'jade-library folder',
        hint: 'Local clone of the jade-library repo where extracted materials get written.',
        directory: true,
    },
];

let validationState = {};

export function initSetupWizard() {
    // Install the "save with persistence" handler as a global override for
    // the boot-guard in index.html. Using a global means we don't depend on
    // direct addEventListener (which can miss if the bootstrap chain fails).
    window.__wizardSave = async function () {
        const wizard = document.getElementById('setup-wizard');
        const updates = {};
        for (const f of FIELDS) {
            const input = document.getElementById(`wizard-${f.key}`);
            if (input) updates[f.key] = input.value.trim();
        }
        try {
            await saveConfig(updates);
        } catch (e) {
            console.error('Failed to save wizard config:', e);
        }
        if (wizard) wizard.hidden = true;
    };
}

export function runSetupWizard() {
    const wizard = document.getElementById('setup-wizard');
    const body = document.getElementById('wizard-body');
    if (!wizard || !body) return;

    const cfg = getConfig();
    body.innerHTML = '';

    for (const f of FIELDS) {
        const row = document.createElement('div');
        row.className = 'form-row';
        row.innerHTML = `
            <label class="form-label">${f.label}</label>
            <div class="form-input-group">
                <input type="text" id="wizard-${f.key}" value="${cfg[f.key] || ''}" placeholder="Click Browse" />
                <button class="btn btn-secondary" type="button" data-wizard-browse="${f.key}">Browse</button>
            </div>
            <span class="form-hint" id="wizard-${f.key}-status">${f.hint}</span>
        `;
        body.appendChild(row);
    }

    // Wire browse buttons
    body.querySelectorAll('[data-wizard-browse]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const key = btn.getAttribute('data-wizard-browse');
            const field = FIELDS.find(f => f.key === key);
            if (!field) return;
            const path = await pickPath(field);
            if (path) {
                document.getElementById(`wizard-${key}`).value = path;
                await validateField(field, path);
            }
        });
    });

    // Re-validate all fields with current values on initial render
    for (const f of FIELDS) {
        const val = (document.getElementById(`wizard-${f.key}`) || {}).value || '';
        if (val) validateField(f, val);
    }

    wizard.hidden = false;
}

async function pickPath(field) {
    if (typeof Neutralino === 'undefined') return null;
    try {
        if (field.directory) {
            const dir = await Neutralino.os.showFolderDialog(`Select ${field.label}`);
            return dir || null;
        }
        const filters = field.ext
            ? [{ name: field.label, extensions: field.ext }]
            : undefined;
        const file = await Neutralino.os.showOpenDialog(`Select ${field.label}`, {
            filters,
            multiSelections: false,
        });
        if (Array.isArray(file) && file.length > 0) return file[0];
        return null;
    } catch (e) {
        console.error('Path picker failed:', e);
        return null;
    }
}

async function validateField(field, path) {
    const status = document.getElementById(`wizard-${field.key}-status`);
    if (!status) return;

    if (field.directory) {
        // Check directory exists via filesystem.getStats
        try {
            const stats = await Neutralino.filesystem.getStats(path);
            if (stats.isDirectory) {
                status.textContent = '✓ Folder found';
                status.className = 'form-hint success';
                validationState[field.key] = true;
                return;
            }
        } catch (e) {
            // fall through
        }
        status.textContent = '✗ Folder not found';
        status.className = 'form-hint error';
        validationState[field.key] = false;
        return;
    }

    // Executable: probe via --help
    const probe = await probeTool(path, field.keyword);
    if (probe.ok) {
        status.textContent = `✓ ${probe.reason}`;
        status.className = 'form-hint success';
        validationState[field.key] = true;
    } else {
        status.textContent = `✗ ${probe.reason}`;
        status.className = 'form-hint error';
        validationState[field.key] = false;
    }
}

export function _isConfigComplete() { return isConfigComplete(); }
