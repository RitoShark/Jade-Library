// Manage tab — bulk reclassification + per-material metadata editor.
//
// Walks <repoPath>/materials/** looking for snippet.json files. For each
// one, the user can:
//   - click to load it into the editor panel
//   - change category / featured / name / description / tags and save
//   - click "Reclassify all" to rerun the classifier over every material
//     at once (uses the snippet.txt content + snippet.json metadata as
//     input since the original ritobin tree isn't on disk).

import { getConfig } from './config.js';
import { CATEGORIES, classifyFromSnippetMeta } from './classifier.js';

let listEl, editorEl, filterEl, logEl;
let allMaterials = []; // [{path, dir, meta}]
let selectedPath = null;

export function initManageTab() {
    listEl   = document.getElementById('manage-list');
    editorEl = document.getElementById('manage-editor');
    filterEl = document.getElementById('manage-filter');
    logEl    = document.getElementById('manage-log');

    document.getElementById('reclassify-all')?.addEventListener('click', handleReclassifyAll);
    document.getElementById('manage-refresh')?.addEventListener('click', refreshList);
    filterEl?.addEventListener('input', renderList);

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
                results.push({
                    path: relParts.join('/'),
                    dir,
                    meta,
                });
            } catch (e) {
                console.warn(`Failed to read ${dir}/snippet.json:`, e);
            }
            return; // Materials don't nest
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
    try {
        allMaterials = await walkMaterials(`${cfg.repoPath}/materials`);
        renderList();
    } catch (e) {
        listEl.innerHTML = `<div class="empty-state">Failed to scan: ${e}</div>`;
    }
}

function renderList() {
    if (!allMaterials.length) {
        listEl.innerHTML = '<div class="empty-state">No materials found.</div>';
        return;
    }
    const q = (filterEl?.value || '').trim().toLowerCase();
    const tokens = q.split(/\s+/).filter(Boolean);
    const filtered = allMaterials.filter(m => {
        if (tokens.length === 0) return true;
        const hay = [
            m.path, m.meta.id || '', m.meta.name || '', m.meta.category || '',
            (m.meta.tags || []).join(' '),
        ].join(' ').toLowerCase();
        return tokens.every(tok => hay.includes(tok));
    });

    if (!filtered.length) {
        listEl.innerHTML = '<div class="empty-state">No matches.</div>';
        return;
    }

    listEl.innerHTML = '';
    for (const mat of filtered) {
        const row = document.createElement('div');
        row.className = 'manage-list-row';
        if (mat.path === selectedPath) row.classList.add('selected');
        row.innerHTML = `
            <span class="row-name">${escapeHtml(mat.meta.name || mat.meta.id || mat.path)}</span>
            <span class="row-meta">${escapeHtml(mat.path)} · <span class="row-cat">${escapeHtml(mat.meta.category || 'special')}</span>${mat.meta.featured ? ' · ★' : ''}</span>
        `;
        row.addEventListener('click', () => selectMaterial(mat));
        listEl.appendChild(row);
    }
}

// ─── Per-material editor ───────────────────────────────────────────────────
function selectMaterial(mat) {
    selectedPath = mat.path;
    // Refresh row selection
    for (const row of listEl.querySelectorAll('.manage-list-row')) {
        row.classList.remove('selected');
    }
    renderEditor(mat);
    // Re-highlight after re-render
    renderList();
}

function renderEditor(mat) {
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
                <span>Featured (show in the "Featured" tab in Jade)</span>
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
            <button class="btn btn-secondary" id="edit-reclassify">Reclassify this one</button>
            <span class="manage-save-status" id="edit-status"></span>
        </div>
    `;

    document.getElementById('edit-save').addEventListener('click', () => saveEditor(mat));
    document.getElementById('edit-reclassify').addEventListener('click', () => reclassifyOne(mat, true));
}

async function saveEditor(mat) {
    const status = document.getElementById('edit-status');
    status.textContent = '';
    status.className = 'manage-save-status';

    const name = document.getElementById('edit-name').value.trim();
    const category = document.getElementById('edit-category').value;
    const featured = document.getElementById('edit-featured').checked;
    const description = document.getElementById('edit-description').value;
    const tags = document.getElementById('edit-tags').value
        .split(',').map(t => t.trim()).filter(Boolean);

    const updated = {
        ...mat.meta,
        name: name || mat.meta.id,
        category,
        featured,
        description,
        tags,
        updatedAt: new Date().toISOString(),
    };

    try {
        await Neutralino.filesystem.writeFile(
            `${mat.dir}/snippet.json`,
            JSON.stringify(updated, null, 2)
        );
        mat.meta = updated;
        status.textContent = 'Saved';
        status.classList.add('success');
        renderList();
    } catch (e) {
        status.textContent = `Error: ${e}`;
        status.classList.add('error');
    }
}

// ─── Reclassification ──────────────────────────────────────────────────────
async function reclassifyOne(mat, showStatus) {
    const newCat = classifyFromSnippetMeta(mat.meta);
    const oldCat = mat.meta.category || 'special';

    if (newCat === oldCat) {
        if (showStatus) {
            const status = document.getElementById('edit-status');
            if (status) {
                status.textContent = `Unchanged (still ${oldCat})`;
                status.className = 'manage-save-status';
            }
        }
        return false;
    }

    const updated = {
        ...mat.meta,
        category: newCat,
        updatedAt: new Date().toISOString(),
    };
    await Neutralino.filesystem.writeFile(
        `${mat.dir}/snippet.json`,
        JSON.stringify(updated, null, 2)
    );
    mat.meta = updated;

    if (showStatus) {
        const status = document.getElementById('edit-status');
        if (status) {
            status.textContent = `Reclassified: ${oldCat} → ${newCat}`;
            status.className = 'manage-save-status success';
        }
        renderEditor(mat);
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

        let changed = 0;
        let unchanged = 0;
        const counts = {};

        for (let i = 0; i < allMaterials.length; i++) {
            const mat = allMaterials[i];
            try {
                const didChange = await reclassifyOne(mat, false);
                if (didChange) changed++;
                else unchanged++;
                const cat = mat.meta.category || 'special';
                counts[cat] = (counts[cat] || 0) + 1;
                if ((i + 1) % 25 === 0 || i === allMaterials.length - 1) {
                    log(`  ${i + 1}/${allMaterials.length}…`);
                }
            } catch (e) {
                log(`  ${mat.path}: ${e}`, 'warning');
            }
        }

        log(`Done — ${changed} changed, ${unchanged} unchanged.`, 'success');
        const summary = Object.entries(counts)
            .sort(([, a], [, b]) => b - a)
            .map(([cat, n]) => `${cat}:${n}`).join(' · ');
        log(`Categories: ${summary}`);
        renderList();
    } catch (e) {
        log(`Error: ${e}`, 'error');
    } finally {
        btn.disabled = false;
    }
}

// ─── Utils ─────────────────────────────────────────────────────────────────
function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function escapeAttr(s) {
    return escapeHtml(s);
}
