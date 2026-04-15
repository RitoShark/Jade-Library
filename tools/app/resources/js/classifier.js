// Material category classifier.
//
// Classification is based on the material's **name** only (its entry key
// and the `materialName`). The ritobin body is too noisy to use — Riot's
// shader templates list every feature switch as defined even when they're
// set to `false`, so a plain body material still has DISSOLVE_ON,
// OUTLINE_ON, BLOOM_TINTCOLOR_ON etc. in its switches list. Using those
// as signals would mis-classify nearly everything.
//
// Priority order matters: effects beat functional buckets so something
// named `Ahri_Hair_Dissolve_inst` lands in `dissolve` rather than `body`.
// First matching rule wins — no scoring.

export const CATEGORIES = [
    { id: 'dissolve',   name: 'Dissolve Effects' },
    { id: 'toon',       name: 'Toon Shading' },
    { id: 'glass',      name: 'Glass & Refraction' },
    { id: 'distortion', name: 'Distortion' },
    { id: 'glow',       name: 'Glow & Emissive' },
    { id: 'body',       name: 'Body & Character' },
    { id: 'special',    name: 'Special' },
];

// Rule order = priority. The first category whose keyword list matches
// any token in the material name wins. The `body` bucket sweeps up both
// character parts and accessories — anything character-shaped lives here
// since keeping a separate accessories bucket offered no practical value.
const RULES = [
    ['dissolve',   ['dissolve', 'burn', 'erode', 'disintegrat']],
    ['toon',       ['toon', 'matcap', 'cel_shad', 'celshad']],
    ['glass',      ['glass', 'refract', 'crystal', 'ice_', '_ice']],
    ['distortion', ['distort', 'panner', 'scroll', 'warp', 'wave_', 'ripple']],
    ['glow',       ['fresnel', 'emissive', 'glow', 'rim_light', 'rimlight', 'bloom']],
    ['body',       [
        'body', 'hair', 'eye', 'face', 'head', 'skin', 'torso', 'arm_', 'leg_',
        'tail', 'wing', 'cape', 'armor', 'weapon', 'prop', 'hat', 'horn',
        'crown', 'belt', 'boot', 'glove', 'shoulder', 'staff', 'sword',
        'shield', 'gun',
    ]],
];

/**
 * Classify a material by its name. `nameSource` should be the most
 * specific string available — typically the original `source.entryKey`
 * (e.g. `Characters/Ahri/Skins/Skin0/Materials/MAT_Body_inst`) or a
 * fallback to `materialName` / `id`. Everything gets lowercased before
 * matching.
 */
export function classifyByName(nameSource) {
    if (typeof nameSource !== 'string' || !nameSource) return 'special';
    const haystack = nameSource.toLowerCase();

    for (const [category, keywords] of RULES) {
        for (const kw of keywords) {
            if (haystack.includes(kw)) return category;
        }
    }
    return 'special';
}

/**
 * Extractor-facing entry point. Accepts a repathed material object and
 * classifies it using whichever name it has available. Prefers the
 * original entry key since it retains the full `Characters/.../Skin42/
 * Materials/MAT_Body_inst` path — more specific than the kebab id.
 */
export function classifyFromMaterial(material) {
    const candidates = [
        material?.entryKey,
        material?.materialName,
        material?.id,
    ];
    for (const c of candidates) {
        if (typeof c === 'string' && c.length > 0) {
            const cat = classifyByName(c);
            if (cat !== 'special') return cat;
        }
    }
    // Nothing matched any specific candidate — fall back to the first
    // available name's classification (which will be 'special').
    for (const c of candidates) {
        if (typeof c === 'string' && c.length > 0) return classifyByName(c);
    }
    return 'special';
}

/**
 * Manage-tab entry point. Classifies using whatever name fields are in
 * the saved snippet.json metadata. Prefers `source.entryKey` since it's
 * the raw game path, falling back to `materialName` or `id`.
 */
export function classifyFromSnippetMeta(meta) {
    const candidates = [
        meta?.source?.entryKey,
        meta?.materialName,
        meta?.id,
        meta?.name,
    ];
    for (const c of candidates) {
        if (typeof c === 'string' && c.length > 0) {
            const cat = classifyByName(c);
            if (cat !== 'special') return cat;
        }
    }
    for (const c of candidates) {
        if (typeof c === 'string' && c.length > 0) return classifyByName(c);
    }
    return 'special';
}
