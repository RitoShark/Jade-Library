// Fingerprint-based deduplication.
//
// Many champion skins reuse the same material structure with only the user
// texture path differing. Generate a stable hash of the material body with
// texturePath values normalized out so two materials with the same shader
// setup but different skin textures collapse into one entry.
//
// The hash is computed off `_raw` (the ritobin JSON entry node) since the
// walker no longer exposes individual field arrays on the material.

export function dedupeMaterials(materials) {
    const byFingerprint = new Map();

    for (const mat of materials) {
        const fp = fingerprint(mat);
        const existing = byFingerprint.get(fp);
        if (existing) {
            existing.usedBy.push({
                champion: mat.sourceChampion,
                skin: mat.sourceSkin,
                bin: mat.sourceBin,
            });
        } else {
            byFingerprint.set(fp, {
                ...mat,
                usedBy: [{
                    champion: mat.sourceChampion,
                    skin: mat.sourceSkin,
                    bin: mat.sourceBin,
                }],
            });
        }
    }

    return [...byFingerprint.values()];
}

function fingerprint(mat) {
    // Deep-clone the raw body so we can wipe texturePath values without
    // mutating the original. Also wipe the outer entry key and the inner
    // `name` field (both are path-specific per champion).
    const body = mat?._raw?.value;
    if (!body) return `empty-${mat?.name || 'x'}`;

    const snapshot = JSON.parse(JSON.stringify(body));
    wipeDiscriminators(snapshot);
    return cheapHash(JSON.stringify(snapshot));
}

function wipeDiscriminators(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
        for (const n of node) wipeDiscriminators(n);
        return;
    }
    // Field-like node: {key, type, value}
    if (typeof node.key === 'string') {
        const k = node.key.toLowerCase();
        // Strip texture paths so user-slot variants collapse.
        if (k === 'texturepath') {
            node.value = '';
            return;
        }
        // Strip the entry-level name field (path-specific).
        if (k === 'name' && node.type === 'string') {
            node.value = '';
            return;
        }
    }
    // Recurse into any nested objects/arrays.
    for (const key of Object.keys(node)) {
        wipeDiscriminators(node[key]);
    }
}

function cheapHash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    }
    return h.toString(36);
}
