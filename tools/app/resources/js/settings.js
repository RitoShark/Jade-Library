// Settings tab — same fields as the setup wizard plus the hash installer.

import { getConfig, saveConfig } from './config.js';
import { probeTool } from './toolRunner.js';

const FIELD_SPECS = {
    ritobin: { input: 'ritobin-path', status: 'ritobin-status', cfgKey: 'ritobinPath', keyword: 'ritobin', exec: true },
    'wad-extract': { input: 'wad-extract-path', status: 'wad-extract-status', cfgKey: 'wadExtractPath', keyword: 'wad', exec: true },
    hashes: { input: 'hashes-path', status: 'hashes-status', cfgKey: 'hashesDir', exec: false },
    repo: { input: 'repo-path', status: null, cfgKey: 'repoPath', exec: false },
};

export function initSettingsTab() {
    const cfg = getConfig();
    Object.values(FIELD_SPECS).forEach(spec => {
        const el = document.getElementById(spec.input);
        if (el) {
            el.value = cfg[spec.cfgKey] || '';
            el.addEventListener('change', () => handleManualEdit(spec));
        }
    });

    // Browse buttons
    document.querySelectorAll('[data-tool-browse]').forEach(btn => {
        const tool = btn.getAttribute('data-tool-browse');
        btn.addEventListener('click', () => browseFor(tool));
    });

    // Hash installer buttons
    document.getElementById('use-jade-hashes')?.addEventListener('click', useJadeHashes);
    document.getElementById('install-hashes')?.addEventListener('click', installHashes);

    // Re-validate every field with the saved value
    for (const spec of Object.values(FIELD_SPECS)) {
        const val = cfg[spec.cfgKey];
        if (val && spec.status) validateField(spec, val);
    }
}

async function browseFor(tool) {
    const spec = FIELD_SPECS[tool];
    if (!spec) return;
    if (typeof Neutralino === 'undefined') return;

    let path = null;
    try {
        if (spec.exec) {
            const file = await Neutralino.os.showOpenDialog(`Select ${tool}.exe`, {
                filters: [{ name: tool, extensions: ['exe'] }],
                multiSelections: false,
            });
            if (Array.isArray(file) && file.length > 0) path = file[0];
        } else {
            path = await Neutralino.os.showFolderDialog(`Select ${tool} folder`);
        }
    } catch (e) {
        console.error(e);
        return;
    }

    if (!path) return;
    document.getElementById(spec.input).value = path;
    await saveConfig({ [spec.cfgKey]: path });
    if (spec.status) await validateField(spec, path);
}

async function handleManualEdit(spec) {
    const val = document.getElementById(spec.input).value.trim();
    await saveConfig({ [spec.cfgKey]: val });
    if (spec.status && val) await validateField(spec, val);
}

async function validateField(spec, path) {
    const status = document.getElementById(spec.status);
    if (!status) return;

    if (spec.exec) {
        const result = await probeTool(path, spec.keyword);
        status.textContent = result.ok ? '✓ Detected' : `✗ ${result.reason}`;
        status.className = result.ok ? 'form-hint success' : 'form-hint error';
        return;
    }

    // Folder check
    try {
        const stats = await Neutralino.filesystem.getStats(path);
        if (stats.isDirectory) {
            status.textContent = '✓ Folder found';
            status.className = 'form-hint success';
            return;
        }
    } catch (e) {}
    status.textContent = '✗ Folder not found';
    status.className = 'form-hint error';
}

async function useJadeHashes() {
    if (typeof Neutralino === 'undefined') return;
    const log = document.getElementById('hashes-log');
    log.textContent = '';
    try {
        // Resolve %APPDATA%\FrogTools\hashes
        const env = await Neutralino.os.getEnv('APPDATA');
        if (!env) {
            log.textContent = 'APPDATA env var not found';
            return;
        }
        const path = `${env}\\FrogTools\\hashes`;
        try {
            const stats = await Neutralino.filesystem.getStats(path);
            if (!stats.isDirectory) throw new Error('not a directory');
        } catch (e) {
            log.textContent = `Jade hashes folder not found at ${path}`;
            return;
        }
        document.getElementById('hashes-path').value = path;
        await saveConfig({ hashesDir: path });
        await validateField(FIELD_SPECS.hashes, path);
        log.textContent = `Using Jade's existing hashes at ${path}`;
    } catch (e) {
        log.textContent = `Error: ${e}`;
    }
}

const COMMUNITY_DRAGON_BASE =
    'https://raw.githubusercontent.com/CommunityDragon/Data/master/hashes/lol/';
// Files hosted at Community Dragon as a single .txt.
const HASH_FILES = [
    'hashes.binentries.txt',
    'hashes.binfields.txt',
    'hashes.binhashes.txt',
    'hashes.bintypes.txt',
    'hashes.lcu.txt',
];

// Files too large to host as one file — Community Dragon splits them into
// `<name>.0`, `<name>.1`, ... chunks. The installer downloads each chunk in
// order, concatenates, and writes them as a single combined .txt so cslol's
// wad-extract (which expects one flat file) can read them.
const HASH_SPLIT_FILES = [
    'hashes.game.txt',
];

async function installHashes() {
    const log = document.getElementById('hashes-log');
    log.textContent = '';

    const cfg = getConfig();
    let target = cfg.hashesDir;
    if (!target) {
        // Default to a "hashes" folder next to the app
        target = `${NL_PATH}/hashes`;
        try {
            await Neutralino.filesystem.createDirectory(target);
        } catch (e) {
            // already exists
        }
        document.getElementById('hashes-path').value = target;
        await saveConfig({ hashesDir: target });
    }

    log.textContent = `Installing to ${target}\n`;

    for (const file of HASH_FILES) {
        log.textContent += `Downloading ${file}…\n`;
        try {
            const url = `${COMMUNITY_DRAGON_BASE}${file}`;
            const resp = await fetch(url);
            if (!resp.ok) {
                log.textContent += `  ✗ HTTP ${resp.status}\n`;
                continue;
            }
            const text = await resp.text();
            await Neutralino.filesystem.writeFile(`${target}/${file}`, text);
            log.textContent += `  ✓ ${(text.length / 1024).toFixed(0)} KB\n`;
        } catch (e) {
            log.textContent += `  ✗ ${e}\n`;
        }
    }

    // Split files — chunks can be ~100 MB each, way too big to marshal
    // through Neutralino's WebSocket IPC. Shell out to `curl` (bundled with
    // Windows 10+) to write each chunk directly to disk, then concat them
    // with `copy /b` and delete the chunk parts.
    //
    // hashes.game.txt is consumed by cslol's wad-extract only (ritobin
    // doesn't need it), and wad-extract loads it from its own exe folder.
    // So we download it directly next to wad-extract.exe — not into the
    // configured hashes dir.
    const MAX_CHUNKS = 20;
    const cfgForSplits = getConfig();
    for (const file of HASH_SPLIT_FILES) {
        let splitTargetDir = target;
        if (file === 'hashes.game.txt') {
            if (!cfgForSplits.wadExtractPath) {
                appendLog(log, `Skipping ${file}: wad-extract.exe path not configured\n`);
                continue;
            }
            splitTargetDir = cfgForSplits.wadExtractPath
                .replace(/\\/g, '/')
                .replace(/\/[^/]+$/, '');
            appendLog(log, `Downloading ${file} → ${splitTargetDir}\n`);
        } else {
            appendLog(log, `Downloading ${file} (chunked via curl)…\n`);
        }
        await yieldUI();

        const outPath = winPath(`${splitTargetDir}/${file}`);
        const chunkPaths = [];

        // Clean any old copy.
        try { await Neutralino.filesystem.remove(`${splitTargetDir}/${file}`); } catch (e) {}

        for (let i = 0; i < MAX_CHUNKS; i++) {
            const url = `${COMMUNITY_DRAGON_BASE}${file}.${i}`;
            const chunkOut = `${splitTargetDir}/${file}.${i}`;
            appendLog(log, `  chunk ${i}: curl…\n`);
            await yieldUI();

            // -f fails on HTTP errors (>=400) with exit 22 so we can detect
            // the end of the chunk sequence. -sS keeps it quiet but still
            // shows errors. -L follows redirects.
            const cmd = `curl -fsSL -o "${winPath(chunkOut)}" "${url}"`;
            const result = await Neutralino.os
                .execCommand(cmd, { background: false })
                .catch(e => ({ exitCode: -1, stdErr: String(e) }));

            if (result.exitCode !== 0) {
                if (i > 0) {
                    appendLog(log, `  chunk ${i}: (none, done)\n`);
                } else {
                    appendLog(log, `  ✗ chunk ${i}: curl exit ${result.exitCode} ${result.stdErr || ''}\n`);
                }
                // Clean any empty partial file curl may have left behind.
                try { await Neutralino.filesystem.remove(chunkOut); } catch (e) {}
                break;
            }

            // Verify the chunk is non-empty.
            let size = 0;
            try {
                const stats = await Neutralino.filesystem.getStats(chunkOut);
                size = stats.size || 0;
            } catch (e) {}
            if (size === 0) {
                appendLog(log, `  chunk ${i}: empty, stopping\n`);
                try { await Neutralino.filesystem.remove(chunkOut); } catch (e) {}
                break;
            }

            chunkPaths.push(chunkOut);
            appendLog(log, `  ✓ chunk ${i}: ${(size / 1024 / 1024).toFixed(1)} MB\n`);
            await yieldUI();
        }

        if (chunkPaths.length === 0) {
            appendLog(log, `  ✗ ${file}: no chunks downloaded\n`);
            continue;
        }

        // Concatenate with Windows `copy /b part0+part1+... out`.
        appendLog(log, `  Concatenating ${chunkPaths.length} chunks…\n`);
        await yieldUI();
        const copyArg = chunkPaths.map(p => `"${winPath(p)}"`).join('+');
        const concatCmd = `cmd /c copy /b /y ${copyArg} "${outPath}"`;
        const concatRes = await Neutralino.os
            .execCommand(concatCmd, { background: false })
            .catch(e => ({ exitCode: -1, stdErr: String(e) }));
        if (concatRes.exitCode !== 0) {
            appendLog(log, `  ✗ concat failed: ${concatRes.stdErr || concatRes.exitCode}\n`);
            continue;
        }

        // Remove the chunk parts — they've been merged.
        for (const p of chunkPaths) {
            try { await Neutralino.filesystem.remove(p); } catch (e) {}
        }

        // Report final size.
        let finalSize = 0;
        try {
            const stats = await Neutralino.filesystem.getStats(`${splitTargetDir}/${file}`);
            finalSize = stats.size || 0;
        } catch (e) {}
        appendLog(log, `  → ${file}: ${(finalSize / 1024 / 1024).toFixed(1)} MB\n`);
    }

    log.textContent += 'Done.';
    await validateField(FIELD_SPECS.hashes, target);
}

function appendLog(el, text) {
    if (!el) return;
    el.textContent += text;
    el.scrollTop = el.scrollHeight;
}

// Release the event loop so the browser can repaint log updates during a
// long sequence of synchronous fetches.
function yieldUI() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

// Normalize a path for Windows shell commands — curl and cmd both want
// backslashes, not the forward-slash mix Neutralino tends to hand back.
function winPath(p) {
    return String(p || '').replace(/\//g, '\\');
}
