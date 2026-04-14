// Diff tab — reads the most recent extraction's diff.json and shows
// new/changed/removed lists with accept/reject controls.
//
// Also exports a runtime function the extractor calls to compute the diff
// during a pipeline run.

const DIFF_FILENAME = 'diff.json';

let diffContentEl;

export function initDiffTab() {
    diffContentEl = document.getElementById('diff-content');
    refreshDiffView();
}

async function refreshDiffView() {
    if (!diffContentEl) return;
    if (typeof Neutralino === 'undefined') {
        diffContentEl.innerHTML = '<p class="empty-state">Neutralino runtime not available.</p>';
        return;
    }

    try {
        const path = `${NL_PATH}/${DIFF_FILENAME}`;
        const text = await Neutralino.filesystem.readFile(path);
        const diff = JSON.parse(text);
        renderDiff(diff);
    } catch (e) {
        diffContentEl.innerHTML = '<p class="empty-state">No diff available. Run an extraction first.</p>';
    }
}

function renderDiff(diff) {
    const sections = [
        { id: 'added',   label: 'New', tagClass: 'new', items: diff.added || [] },
        { id: 'changed', label: 'Changed', tagClass: 'changed', items: diff.changed || [] },
        { id: 'removed', label: 'Removed', tagClass: 'removed', items: diff.removed || [] },
    ];

    diffContentEl.innerHTML = '';
    for (const section of sections) {
        if (section.items.length === 0) continue;
        const wrap = document.createElement('div');
        wrap.className = 'diff-section';
        wrap.innerHTML = `
            <div class="diff-section-title">${section.label} (${section.items.length})</div>
        `;
        for (const item of section.items) {
            const row = document.createElement('div');
            row.className = 'diff-row';
            row.innerHTML = `
                <div>
                    <div class="diff-row-name">${escape(item.name || item.id)}</div>
                    <div class="diff-row-meta">${escape(item.id || '')}${item.changes ? ' · ' + item.changes.join(', ') : ''}</div>
                </div>
                <span class="diff-tag ${section.tagClass}">${section.label}</span>
            `;
            wrap.appendChild(row);
        }
        diffContentEl.appendChild(wrap);
    }

    if (diffContentEl.children.length === 0) {
        diffContentEl.innerHTML = '<p class="empty-state">No changes detected.</p>';
    }
}

function escape(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

// ── Runtime API used by extractor.js ──

export async function diffAgainstExisting(repoPath, newMaterials) {
    const diff = { added: [], changed: [], removed: [], generatedAt: new Date().toISOString() };
    if (!repoPath || typeof Neutralino === 'undefined') return diff;

    // Load existing material ids from disk
    const existingIds = new Set();
    const materialsRoot = `${repoPath}/materials`;
    try {
        const dirs = await Neutralino.filesystem.readDirectory(materialsRoot);
        for (const d of dirs) {
            if (d.type === 'DIRECTORY') existingIds.add(d.entry);
        }
    } catch (e) {
        // No materials folder yet — everything is added
    }

    const newIds = new Set(newMaterials.map(m => m.id));

    for (const m of newMaterials) {
        if (!existingIds.has(m.id)) {
            diff.added.push({ id: m.id, name: m.materialName });
        } else {
            // Detect "changed" via fingerprint comparison against existing snippet.json
            // For now we just flag everything that exists in both as potentially-changed
            // — the snippet emitter writes fresh files anyway.
            diff.changed.push({ id: m.id, name: m.materialName, changes: ['re-emitted'] });
        }
    }
    for (const id of existingIds) {
        if (!newIds.has(id)) {
            diff.removed.push({ id, name: id });
        }
    }

    // Persist diff so the Diff tab can render it later
    try {
        await Neutralino.filesystem.writeFile(
            `${NL_PATH}/${DIFF_FILENAME}`,
            JSON.stringify(diff, null, 2)
        );
    } catch (e) {
        console.warn('Failed to write diff.json:', e);
    }

    return diff;
}
