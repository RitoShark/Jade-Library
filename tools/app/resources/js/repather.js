// Rewrites texture paths so each material's shader textures live under
// `assets/jadelib/<material-id>/` instead of pointing at game-specific paths
// that change between patches.
//
// User-facing texture slots (Diffuse_Texture, Normal_Map, etc.) get a
// placeholder path so the inserter can fill them in later via SKN matching.
//
// Works on the raw ritobin JSON entry shape — each sampler is an embed body
// { name: "StaticMaterialShaderSamplerDef", items: [{key,type,value}...] }.

// Only exact TextureName matches trigger the user-slot placeholder. The
// inserter will fill these in from the user's SKN. Everything else is a
// shader-owned texture and gets shipped with the material.
const KNOWN_USER_SLOTS = new Set([
    'diffuse_texture',
]);

const SLOT_KIND = {
    diffuse_texture: 'diffuse',
};

const PLACEHOLDER = 'ASSETS/Characters/YOURCHAMP/Skins/SKINID/Maintexture.dds';

export function repathMaterial(mat) {
    // Material `name` fields are usually full entry paths like
    // "Characters/Ahri/Skins/Skin77/Materials/Ahri_Tails_Panner_Fresnel_inst".
    // Only the trailing segment is the actual identifier — strip the rest.
    const rawName = mat.name || mat.entryKey || 'untitled';
    const lastSegment = String(rawName).split(/[\\/]/).pop() || 'untitled';
    const id = toKebabCase(lastSegment);
    const materialName = `jadelib_${id.replace(/-/g, '_')}`;

    // Deep-clone the whole raw entry so we can rewrite in place without
    // mutating the source tree.
    const cloned = JSON.parse(JSON.stringify(mat._raw));
    // Rewrite the outer entry key so ritobin's text output header becomes
    // `"jadelib_foo" = StaticMaterialDef {` directly.
    cloned.key = materialName;
    const body = cloned?.value;
    const bodyItems = Array.isArray(body?.items) ? body.items : [];

    // Rewrite the inner `name` field to match.
    const nameField = bodyItems.find(f => f?.key === 'name' || f?.key === 'Name');
    if (nameField) nameField.value = materialName;

    const userSlots = [];
    const textureFiles = [];

    const samplerField = bodyItems.find(
        f => f?.key === 'samplerValues' || f?.key === 'SamplerValues'
    );
    const samplerItems = samplerField?.value?.items;
    if (Array.isArray(samplerItems)) {
        for (const sampler of samplerItems) {
            // Each sampler is an embed body: { name, items: [{key,type,value}] }
            const sItems = Array.isArray(sampler?.items) ? sampler.items : [];
            const texNameField = sItems.find(
                f => f?.key === 'TextureName' || f?.key === 'textureName'
            );
            const texPathField = sItems.find(
                f => f?.key === 'texturePath' || f?.key === 'TexturePath'
            );
            if (!texPathField) continue;

            const texName = String(texNameField?.value ?? '');
            const origPath = String(texPathField.value ?? '');
            const lower = texName.toLowerCase();

            if (isUserSlot(lower)) {
                userSlots.push({
                    name: texName,
                    kind: SLOT_KIND[lower] || 'other',
                    description: '',
                });
                texPathField.value = PLACEHOLDER;
            } else {
                const filename = origPath.split(/[\\/]/).pop() || `${texName}.tex`;
                texPathField.value = `assets/jadelib/${id}/${filename}`;
                textureFiles.push({
                    name: filename,
                    originalGamePath: origPath,
                    updatedAt: new Date().toISOString(),
                });
            }
        }
    }

    return {
        ...mat,
        id,
        materialName,
        userSlots,
        textureFiles,
        // The rewritten raw entry — emitter feeds this back through ritobin.
        _raw: cloned,
    };
}

function isUserSlot(lowerTextureName) {
    return KNOWN_USER_SLOTS.has(lowerTextureName);
}

function toKebabCase(s) {
    return String(s)
        .replace(/[_\s]+/g, '-')
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-');
}
