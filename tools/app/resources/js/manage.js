// Manage tab — multi-select material list + bulk category assignment.
//
// Walks <repoPath>/materials/** looking for snippet.json files.
// Users can select multiple materials and assign a category in one go.

import { getConfig } from './config.js';
import { CATEGORIES, classifyFromSnippetMeta } from './classifier.js';

let listEl, editorEl, filterEl, logEl;
let allMaterials = []; // [{path, dir, meta}]
let selected = new Set(); // paths of selected materials

export function initManageTab() {
    listEl   = document.getElementById('manage-list');
    editorEl = document.getElementById('manage-editor');
    filterEl = document.getElementById('manage-filter');
    logEl    = document.getElementById('manage-log');

    document.getElementById('reclassify-all')?.addEventListener('click', handleReclassifyAll);
    document.getElementById('manage-refresh')?.addEventListener('click', refreshList);
    document.getElementById('bulk-apply')?.addEventListener('click', handleBulkApply);
    document.getElementById('select-all')?.addEventListener('change', handleSelectAll);
    filterEl?.addEventListener('input', () => { selected.clear(); renderList(); renderEditor(); });

    refreshList();
}

function log(msg, kind = '') {
    if (!logEl) return;
    const div = document.createElement('div');
    div.className = `log-line ${kind ? 'log-' + kind : ''}`;
    div.textContent = msg;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
}

// ─── Walk materials/** looking for snippet.json files ──────────────────────
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
                results.push({ path: relParts.join('/'), dir, meta });
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

async function refreshList() {
    const cfg = getConfig();
    if (!cfg.repoPath) {
        listEl.innerHTML = '<div class="empty-state">Repo path not configured — open Settings.</div>';
        return;
    }
    listEl.innerHTML = '<div class="empty-state">Loading…</div>';
    selected.clear();
    try {
        allMaterials = await walkMaterials(`${cfg.repoPath}/materials`);
        renderList();
        renderEditor();
    } catch (e) {
        listEl.innerHTML = `<div class="empty-state">Failed to scan: ${e}</div>`;
    }
}

function getFiltered() {
    const q = (filterEl?.value || '').trim().toLowerCase();
    const tokens = q.split(/\s+/).filter(Boolean);
    return allMaterials.filter(m => {
        if (tokens.length === 0) return true;
        const hay = [
            m.path, m.meta.id || '', m.meta.name || '', m.meta.category || '',
            (m.meta.tags || []).join(' '),
        ].join(' ').toLowerCase();
        return tokens.every(tok => hay.includes(tok));
    });
}

function renderList() {
    if (!allMaterials.length) {
        listEl.innerHTML = '<div class="empty-state">No materials found.</div>';
        updateSelectionCount();
        return;
    }
    const filtered = getFiltered();
    if (!filtered.length) {
        listEl.innerHTML = '<div class="empty-state">No matches.</div>';
        updateSelectionCount();
        return;
    }

    listEl.innerHTML = '';
    for (const mat of filtered) {
        const row = document.createElement('div');
        row.className = 'manage-list-row';
        if (selected.has(mat.path)) row.classList.add('selected');

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'row-checkbox';
        cb.checked = selected.has(mat.path);
        cb.addEventListener('change', (e) => {
            e.stopPropagation();
            if (cb.checked) selected.add(mat.path);
            else selected.delete(mat.path);
            row.classList.toggle('selected', cb.checked);
            updateSelectionCount();
            renderEditor();
        });

        const label = document.createElement('div');
        label.className = 'row-label';
        label.innerHTML = `
            <span class="row-name">${escapeHtml(mat.meta.name || mat.meta.id || mat.path)}</span>
            <span class="row-meta">${escapeHtml(mat.path)} · <span class="row-cat">${escapeHtml(mat.meta.category || 'special')}</span>${mat.meta.featured ? ' · ★' : ''}</span>
        `;

        row.appendChild(cb);
        row.appendChild(label);
        row.addEventListener('click', (e) => {
            if (e.target === cb) return;
            cb.checked = !cb.checked;
            cb.dispatchEvent(new Event('change'));
        });
        listEl.appendChild(row);
    }
    updateSelectionCount();
}

function updateSelectionCount() {
    const countEl = document.getElementById('selection-count');
    const bulkBar = document.getElementById('bulk-bar');
    const selectAllCb = document.getElementById('select-all');
    if (countEl) countEl.textContent = selected.size > 0 ? `${selected.size} selected` : '';
    if (bulkBar) bulkBar.classList.toggle('visible', selected.size > 0);
    if (selectAllCb) {
        const filtered = getFiltered();
        selectAllCb.checked = filtered.length > 0 && filtered.every(m => selected.has(m.path));
        selectAllCb.indeterminate = !selectAllCb.checked && filtered.some(m => selected.has(m.path));
    }
}

function handleSelectAll(e) {
    const filtered = getFiltered();
    if (e.target.checked) {
        for (const m of filtered) selected.add(m.path);
    } else {
        for (const m of filtered) selected.delete(m.path);
    }
    renderList();
    renderEditor();
}

// ─── Editor panel — single or bulk ───────────────────────────────────────
function renderEditor() {
    if (selected.size === 0) {
        editorEl.innerHTML = '<div class="empty-state">Select materials to edit</div>';
        return;
    }

    const mats = allMaterials.filter(m => selected.has(m.path));

    if (mats.length === 1) {
        renderSingleEditor(mats[0]);
        return;
    }

    // Bulk mode — show category counts + assign
    const catCounts = {};
    for (const m of mats) {
        const cat = m.meta.category || 'special';
        catCounts[cat] = (catCounts[cat] || 0) + 1;
    }
    const summary = Object.entries(catCounts)
        .sort(([, a], [, b]) => b - a)
        .map(([cat, n]) => `<span class="bulk-cat-tag">${escapeHtml(cat)} <span class="bulk-cat-count">${n}</span></span>`)
        .join(' ');

    const options = CATEGORIES.map(c =>
        `<option value="${c.id}">${escapeHtml(c.name)}</option>`
    ).join('');

    editorEl.innerHTML = `
        <div class="bulk-summary">
            <div class="bulk-summary-title">${mats.length} materials selected</div>
            <div class="bulk-summary-cats">${summary}</div>
        </div>

        <div class="form-row">
            <label class="form-label">Set category for all selected</label>
            <div class="form-input-group">
                <select id="bulk-category">${options}</select>
                <button class="btn btn-primary" id="bulk-apply-inline">Apply</button>
            </div>
        </div>

        <div class="form-row">
            <label class="form-label">Toggle featured</label>
            <div class="form-actions">
                <button class="btn btn-secondary" id="bulk-feature-on">Mark all featured</button>
                <button class="btn btn-secondary" id="bulk-feature-off">Unmark all featured</button>
            </div>
        </div>

        <div class="form-row">
            <label class="form-label">Danger zone</label>
            <div class="form-actions">
                <button class="btn btn-danger" id="bulk-delete">Delete ${mats.length} materials…</button>
            </div>
        </div>

        <span class="manage-save-status" id="edit-status"></span>
    `;

    document.getElementById('bulk-apply-inline')?.addEventListener('click', handleBulkApply);
    document.getElementById('bulk-feature-on')?.addEventListener('click', () => handleBulkFeatured(true));
    document.getElementById('bulk-feature-off')?.addEventListener('click', () => handleBulkFeatured(false));
    document.getElementById('bulk-delete')?.addEventListener('click', handleBulkDelete);
}

function renderSingleEditor(mat) {
    const m = mat.meta;
    const options = CATEGORIES.map(c =>
        `<option value="${c.id}" ${m.category === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
    ).join('');

    const tags = (m.tags || []).join(', ');
    const userSlots = (m.userSlots || [])
        .map(s => typeof s === 'string' ? s : s.name)
        .filter(Boolean)
        .join(', ');

    editorEl.innerHTML = `
        <div class="manage-meta-readonly">path: ${escapeHtml(mat.path)}\nid: ${escapeHtml(m.id || '')}\nmaterialName: ${escapeHtml(m.materialName || '')}\nchampion: ${escapeHtml(m.source?.champion || '—')}\nskin: ${escapeHtml(m.source?.skin || '—')}\nuserSlots: ${escapeHtml(userSlots || '(none)')}</div>

        <div class="form-row">
            <label class="form-label">Display name</label>
            <input type="text" id="edit-name" value="${escapeAttr(m.name || '')}" />
        </div>

        <div class="form-row">
            <label class="form-label">Category</label>
            <select id="edit-category">${options}</select>
        </div>

        <div class="form-row">
            <label class="checkbox-row">
                <input type="checkbox" id="edit-featured" ${m.featured ? 'checked' : ''} />
                <span>Featured</span>
            </label>
        </div>

        <div class="form-row">
            <label class="form-label">Description</label>
            <textarea id="edit-description">${escapeHtml(m.description || '')}</textarea>
        </div>

        <div class="form-row">
            <label class="form-label">Tags (comma-separated)</label>
            <input type="text" id="edit-tags" value="${escapeAttr(tags)}" />
        </div>

        <div class="form-actions">
            <button class="btn btn-primary" id="edit-save">Save</button>
            <button class="btn btn-secondary" id="edit-reclassify">Reclassify</button>
            <button class="btn btn-danger" id="edit-delete">Delete</button>
            <span class="manage-save-status" id="edit-status"></span>
        </div>
    `;

    document.getElementById('edit-save').addEventListener('click', () => saveSingle(mat));
    document.getElementById('edit-reclassify').addEventListener('click', () => reclassifyOne(mat, true));
    document.getElementById('edit-delete').addEventListener('click', () => handleBulkDelete());
}

// ─── Save / apply actions ─────────────────────────────────────────────────
async function saveSingle(mat) {
    const status = document.getElementById('edit-status');
    status.textContent = '';
    status.className = 'manage-save-status';

    const updated = {
        ...mat.meta,
        name: document.getElementById('edit-name').value.trim() || mat.meta.id,
        category: document.getElementById('edit-category').value,
        featured: document.getElementById('edit-featured').checked,
        description: document.getElementById('edit-description').value,
        tags: document.getElementById('edit-tags').value.split(',').map(t => t.trim()).filter(Boolean),
        updatedAt: new Date().toISOString(),
    };

    try {
        await Neutralino.filesystem.writeFile(`${mat.dir}/snippet.json`, JSON.stringify(updated, null, 2));
        mat.meta = updated;
        status.textContent = 'Saved';
        status.classList.add('success');
        renderList();
    } catch (e) {
        status.textContent = `Error: ${e}`;
        status.classList.add('error');
    }
}

async function handleBulkApply() {
    const catSelect = document.getElementById('bulk-category') || document.getElementById('bulk-cat-toolbar');
    if (!catSelect) return;
    const newCat = catSelect.value;
    const mats = allMaterials.filter(m => selected.has(m.path));
    if (!mats.length) return;

    const status = document.getElementById('edit-status');
    let changed = 0;

    for (const mat of mats) {
        if (mat.meta.category === newCat) continue;
        const updated = { ...mat.meta, category: newCat, updatedAt: new Date().toISOString() };
        try {
            await Neutralino.filesystem.writeFile(`${mat.dir}/snippet.json`, JSON.stringify(updated, null, 2));
            mat.meta = updated;
            changed++;
        } catch (e) {
            console.warn(`Failed to update ${mat.path}:`, e);
        }
    }

    if (status) {
        status.textContent = `Set ${changed} material${changed !== 1 ? 's' : ''} to ${newCat}`;
        status.className = 'manage-save-status success';
    }
    renderList();
    renderEditor();
}

async function handleBulkFeatured(value) {
    const mats = allMaterials.filter(m => selected.has(m.path));
    let changed = 0;

    for (const mat of mats) {
        if (mat.meta.featured === value) continue;
        const updated = { ...mat.meta, featured: value, updatedAt: new Date().toISOString() };
        try {
            await Neutralino.filesystem.writeFile(`${mat.dir}/snippet.json`, JSON.stringify(updated, null, 2));
            mat.meta = updated;
            changed++;
        } catch (e) {
            console.warn(`Failed to update ${mat.path}:`, e);
        }
    }

    const status = document.getElementById('edit-status');
    if (status) {
        status.textContent = `${value ? 'Featured' : 'Unfeatured'} ${changed} material${changed !== 1 ? 's' : ''}`;
        status.className = 'manage-save-status success';
    }
    renderList();
    renderEditor();
}

async function handleBulkDelete() {
    const mats = allMaterials.filter(m => selected.has(m.path));
    if (!mats.length) return;

    const ok = await Neutralino.os.showMessageBox(
        'Delete materials',
        `Permanently delete ${mats.length} material${mats.length === 1 ? '' : 's'}?\n\nThis removes their folders from the repo. The deletion only takes effect in the repo after you rebuild the index.`,
        'YES_NO',
        'WARNING'
    ).catch(() => 'NO');
    if (ok !== 'YES') return;

    let deleted = 0;
    let failed = 0;
    for (const mat of mats) {
        try {
            await Neutralino.filesystem.remove(mat.dir);
            deleted++;
        } catch (e) {
            console.warn(`Failed to delete ${mat.dir}:`, e);
            failed++;
        }
    }

    // Drop deleted materials from in-memory state
    allMaterials = allMaterials.filter(m => !selected.has(m.path));
    selected.clear();

    log(`Deleted ${deleted} material${deleted !== 1 ? 's' : ''}${failed ? ` (${failed} failed)` : ''}`, failed ? 'warning' : 'success');
    log('Rebuild the index on the Index tab to sync index.json with disk.');

    renderList();
    renderEditor();
}

// ─── Reclassification ─────────────────────────────────────────────────────
async function reclassifyOne(mat, showStatus) {
    const newCat = classifyFromSnippetMeta(mat.meta);
    const oldCat = mat.meta.category || 'special';

    if (newCat === oldCat) {
        if (showStatus) {
            const status = document.getElementById('edit-status');
            if (status) { status.textContent = `Unchanged (still ${oldCat})`; status.className = 'manage-save-status'; }
        }
        return false;
    }

    const updated = { ...mat.meta, category: newCat, updatedAt: new Date().toISOString() };
    await Neutralino.filesystem.writeFile(`${mat.dir}/snippet.json`, JSON.stringify(updated, null, 2));
    mat.meta = updated;

    if (showStatus) {
        const status = document.getElementById('edit-status');
        if (status) { status.textContent = `Reclassified: ${oldCat} → ${newCat}`; status.className = 'manage-save-status success'; }
        renderSingleEditor(mat);
        renderList();
    }
    return true;
}

async function handleReclassifyAll() {
    const btn = document.getElementById('reclassify-all');
    btn.disabled = true;
    logEl.innerHTML = '';

    try {
        if (!allMaterials.length) await refreshList();
        log(`Reclassifying ${allMaterials.length} materials…`);

        let changed = 0, unchanged = 0;
        const counts = {};

        for (let i = 0; i < allMaterials.length; i++) {
            const mat = allMaterials[i];
            try {
                const didChange = await reclassifyOne(mat, false);
                if (didChange) changed++; else unchanged++;
                counts[mat.meta.category || 'special'] = (counts[mat.meta.category || 'special'] || 0) + 1;
                if ((i + 1) % 25 === 0 || i === allMaterials.length - 1) log(`  ${i + 1}/${allMaterials.length}…`);
            } catch (e) {
                log(`  ${mat.path}: ${e}`, 'warning');
            }
        }

        log(`Done — ${changed} changed, ${unchanged} unchanged.`, 'success');
        const summary = Object.entries(counts).sort(([, a], [, b]) => b - a).map(([cat, n]) => `${cat}:${n}`).join(' · ');
        log(`Categories: ${summary}`);
        renderList();
    } catch (e) {
        log(`Error: ${e}`, 'error');
    } finally {
        btn.disabled = false;
    }
}

// ─── Utils ────────────────────────────────────────────────────────────────
function escapeHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function escapeAttr(s) { return escapeHtml(s); }
