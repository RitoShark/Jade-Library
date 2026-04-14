// Local config persistence
//
// Stores tool paths and hash folder location in `tools/app/config.json`
// (gitignored). Loaded once at startup, written whenever the user changes a
// setting via the Settings tab or setup wizard.

const CONFIG_FILE = 'config.json';

const DEFAULT_CONFIG = {
    ritobinPath: '',
    wadExtractPath: '',
    hashesDir: '',
    repoPath: '',
    leaguePath: '',
    lastPatchVersion: null,
};

let currentConfig = { ...DEFAULT_CONFIG };

export function getConfig() {
    return { ...currentConfig };
}

export function isConfigComplete() {
    return Boolean(
        currentConfig.ritobinPath &&
        currentConfig.wadExtractPath &&
        currentConfig.hashesDir &&
        currentConfig.repoPath
    );
}

export async function loadConfig() {
    if (typeof Neutralino === 'undefined') return;
    try {
        const data = await Neutralino.filesystem.readFile(
            `${NL_PATH}/${CONFIG_FILE}`
        );
        const parsed = JSON.parse(data);
        currentConfig = { ...DEFAULT_CONFIG, ...parsed };
    } catch (e) {
        // File doesn't exist yet — keep defaults
        currentConfig = { ...DEFAULT_CONFIG };
    }
}

export async function saveConfig(updates) {
    currentConfig = { ...currentConfig, ...updates };
    if (typeof Neutralino === 'undefined') return;
    try {
        await Neutralino.filesystem.writeFile(
            `${NL_PATH}/${CONFIG_FILE}`,
            JSON.stringify(currentConfig, null, 2)
        );
    } catch (e) {
        console.error('Failed to save config:', e);
    }
}
