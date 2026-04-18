// Diff tab — reads the most recent extraction's diff.json and shows
// new/changed/removed as collapsible summary sections.

const DIFF_FILENAME = 'diff.json';

let diffContentEl;

let initialized = false;

export function initDiffTab() {
    diffContentEl = document.getElementById('diff-content');
    if (!initialized) {
        document.getElementById('clear-diff')?.addEventListener('click', clearDiff);
        initialized = true;
    }
    refreshDiffView();
}

async function clearDiff() {
    try {
        await Neutralino.filesystem.remove(`${NL_PATH}/${DIFF_FILENAME}`);
    } catch (e) { /* already gone */ }
    if (diffContentEl) {
        diffContentEl.innerHTML = '<p class="empty-state">Diff cleared. Run an extraction to generate a new one.</p>';
    }
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
        { id: 'added',   label: 'New',     tagClass: 'new',     items: diff.added || [] },
        { id: 'changed', label: 'Changed', tagClass: 'changed', items: diff.changed || [] },
        { id: 'removed', label: 'Removed', tagClass: 'removed', items: diff.removed || [] },
    ];

    const total = sections.reduce((s, sec) => s + sec.items.length, 0);
    if (total === 0) {
        diffContentEl.innerHTML = '<p class="empty-state">No changes detected.</p>';
        return;
    }

    // Summary bar
    const summaryParts = sections
        .filter(s => s.items.length > 0)
        .map(s => `<span class="diff-summary-tag ${s.tagClass}">${s.items.length} ${s.label.toLowerCase()}</span>`);

    diffContentEl.innerHTML = `<div class="diff-summary-bar">${summaryParts.join('')}</div>`;

    for (const section of sections) {
        if (section.items.length === 0) continue;

        const wrap = document.createElement('details');
        wrap.className = 'diff-section';

        const summary = document.createElement('summary');
        summary.className = 'diff-section-header';
        summary.innerHTML = `
            <span class="diff-section-title">${section.label}</span>
            <span class="diff-tag ${section.tagClass}">${section.items.length}</span>
        `;
        wrap.appendChild(summary);

        const list = document.createElement('div');
        list.className = 'diff-section-list';

        for (const item of section.items) {
            const row = document.createElement('div');
            row.className = 'diff-row';
            row.innerHTML = `
                <div class="diff-row-text">
                    <span class="diff-row-name">${escape(item.name || item.id || '(unknown)')}</span>
                    <span class="diff-row-meta">${escape(item.id || item.name || '')}${item.changes ? ' · ' + item.changes.join(', ') : ''}</span>
                </div>
                <span class="diff-tag ${section.tagClass}">${section.label}</span>
            `;
            list.appendChild(row);
        }
        wrap.appendChild(list);
        diffContentEl.appendChild(wrap);
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

    const existingIds = new Set();
    const materialsRoot = `${repoPath}/materials`;
    try {
        const dirs = await Neutralino.filesystem.readDirectory(materialsRoot);
        for (const d of dirs) {
            if (d.type === 'DIRECTORY') existingIds.add(d.entry);
        }
    } catch (e) { /* No materials folder yet */ }

    const newIds = new Set(newMaterials.map(m => m.id));

    for (const m of newMaterials) {
        if (!existingIds.has(m.id)) {
            diff.added.push({ id: m.id, name: m.materialName || m.name || m.id });
        } else {
            diff.changed.push({ id: m.id, name: m.materialName || m.name || m.id, changes: ['re-emitted'] });
        }
    }
    for (const id of existingIds) {
        if (!newIds.has(id)) {
            diff.removed.push({ id, name: id });
        }
    }

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
