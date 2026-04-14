// Wraps Neutralino's os.execCommand for running ritobin and the cslol-tools
// WAD utilities. Each helper returns the captured stdout on success or throws
// with stderr on failure.

import { getConfig } from './config.js';

function ensureNeutralino() {
    if (typeof Neutralino === 'undefined') {
        throw new Error('Neutralino runtime not available');
    }
}

function quote(p) {
    if (!p) return '""';
    if (p.includes(' ')) return `"${p}"`;
    return p;
}

async function exec(cmd, options = {}) {
    ensureNeutralino();
    const result = await Neutralino.os.execCommand(cmd, {
        background: false,
        ...options,
    });
    if (result.exitCode !== 0) {
        throw new Error(
            `Command failed (exit ${result.exitCode}): ${result.stdErr || result.stdOut || cmd}`
        );
    }
    return result.stdOut || '';
}

export async function probeTool(path, expectedKeyword) {
    if (!path) return { ok: false, reason: 'No path set' };
    try {
        const result = await Neutralino.os.execCommand(`${quote(path)} --help`, {
            background: false,
        });
        const out = `${result.stdOut || ''}${result.stdErr || ''}`.toLowerCase();
        if (expectedKeyword && !out.includes(expectedKeyword.toLowerCase())) {
            return { ok: false, reason: `Output didn't match "${expectedKeyword}"` };
        }
        return { ok: true, reason: 'Detected' };
    } catch (e) {
        return { ok: false, reason: String(e) };
    }
}

/**
 * Convert a single .bin file to JSON via ritobin.
 * Returns the parsed JSON tree.
 */
export async function ritobinToJson(binPath, outJsonPath) {
    const cfg = getConfig();
    if (!cfg.ritobinPath) throw new Error('ritobin path not configured');
    if (!cfg.hashesDir) throw new Error('hashes dir not configured');

    // ritobin CLI: <input> <output> [-d <hashes_dir>]
    // -i/-o set input/output FORMAT (not paths); -h is --help.
    // Format is auto-detected from file extension.
    const cmd = `${quote(cfg.ritobinPath)} ${quote(binPath)} ${quote(outJsonPath)} -d ${quote(cfg.hashesDir)}`;
    await exec(cmd);

    const text = await Neutralino.filesystem.readFile(outJsonPath);
    return JSON.parse(text);
}

/**
 * Recursively convert every .bin file inside `dir` to a sibling .json file
 * using a single ritobin invocation. Much faster than spawning the exe per
 * bin, since hashes only get loaded once.
 *
 * Output JSON files are written next to their sources with the same base
 * name (e.g. skin0.bin → skin0.bin.json if ritobin appends, or skin0.json
 * if it replaces the extension). Either naming is handled downstream.
 */
export async function ritobinBatchDir(dir) {
    const cfg = getConfig();
    if (!cfg.ritobinPath) throw new Error('ritobin path not configured');
    if (!cfg.hashesDir) throw new Error('hashes dir not configured');

    // `-r` = recursive, `-i bin -o json` pins the formats so ritobin doesn't
    // try to re-interpret existing .json files in the tree on second passes.
    const cmd = `${quote(cfg.ritobinPath)} ${quote(dir)} ${quote(dir)} -r -i bin -o json -d ${quote(cfg.hashesDir)}`;
    await exec(cmd);
}

/**
 * Run ritobin in text-output mode to render a JSON tree back as ritobin text.
 * Used by the snippet emitter to produce human-readable snippet.txt files.
 */
export async function jsonToRitobinText(jsonPath, outTxtPath) {
    const cfg = getConfig();
    if (!cfg.ritobinPath) throw new Error('ritobin path not configured');
    if (!cfg.hashesDir) throw new Error('hashes dir not configured');

    const cmd = `${quote(cfg.ritobinPath)} ${quote(jsonPath)} ${quote(outTxtPath)} -d ${quote(cfg.hashesDir)}`;
    await exec(cmd);

    return await Neutralino.filesystem.readFile(outTxtPath);
}

/**
 * Extract a WAD into a target folder via cslol-tools wad-extract.
 */
export async function wadExtract(wadPath, outputDir) {
    const cfg = getConfig();
    if (!cfg.wadExtractPath) throw new Error('wad-extract path not configured');

    // cslol wad-extract does not accept a hashes arg — it loads
    // `hashes.game.txt` from its own exe folder. The hash installer is
    // responsible for placing the file there.
    const cmd = `${quote(cfg.wadExtractPath)} ${quote(wadPath)} ${quote(outputDir)}`;
    await exec(cmd);
}
