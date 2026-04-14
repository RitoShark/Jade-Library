// Walks ritobin's JSON tree output and collects every StaticMaterialDef entry.
//
// Ritobin JSON shape (as produced by `ritobin in.bin out.json`):
//   {
//     "type": "PROP", "version": 3, "linked": [...],
//     "entries": {
//       "type": "map",
//       "value": {
//         "items": [
//           { "key": "Characters/.../Foo_inst",
//             "value": {
//               "name": "StaticMaterialDef",
//               "items": [
//                 { "key": "name", "type": "string", "value": "..." },
//                 { "key": "samplerValues", "type": "list2",
//                   "value": { "valueType": "embed", "items": [
//                     { "name": "StaticMaterialShaderSamplerDef",
//                       "items": [
//                         { "key": "TextureName", "type": "string", "value": "..." },
//                         { "key": "texturePath", "type": "string", "value": "..." }
//                       ]
//                     }, ... ] } },
//                 ...
//               ] } } ] } } }
//
// Field keys inside an entry body use lowercase first letter (`name`,
// `samplerValues`, `paramValues`, `switches`, `techniques`, `childTechniques`,
// `shaderMacros`). The embed class name on the outer entry body is still
// PascalCase ("StaticMaterialDef").

export function findMaterials(binTree, sourceChampion, sourceSkin, sourceBin) {
    const materials = [];
    const items = binTree?.entries?.value?.items;
    if (!Array.isArray(items)) return materials;

    for (const entry of items) {
        const body = entry?.value;
        if (!body || body.name !== 'StaticMaterialDef') continue;

        const fieldMap = buildFieldMap(body.items);
        const nameNode = fieldMap.name || fieldMap.Name;
        const name = nameNode?.value ?? entry.key ?? '';

        // The real "which skin does this material belong to" answer comes
        // from the entry key (e.g. "Characters/Ahri/Skins/Skin5/Materials/…")
        // — bin filenames get mangled by wad-extract when a bin nests
        // multiple skins. Extract "skin<N>" from entry.key, falling back to
        // the sourceSkin arg the extractor passed.
        const keyMatch = String(entry.key || '').match(/\/Skins\/(Skin\d+)\//i);
        const resolvedSkin = keyMatch ? keyMatch[1].toLowerCase() : sourceSkin;

        materials.push({
            sourceChampion,
            sourceSkin: resolvedSkin,
            sourceBin: sourceBin || sourceSkin,
            entryKey: entry.key,
            name: String(name),
            // Keep a reference to the raw entry node so the repather can
            // deep-clone and rewrite in place, and the snippet emitter can
            // feed the rewritten version back through ritobin.
            _raw: entry,
            // Carry top-level tree metadata so the emitter can rebuild a
            // valid minimal ritobin tree.
            _treeMeta: {
                type: binTree?.type ?? 'PROP',
                version: binTree?.version ?? 3,
                linked: binTree?.linked ?? [],
            },
        });
    }
    return materials;
}

function buildFieldMap(items) {
    const out = {};
    if (!Array.isArray(items)) return out;
    for (const f of items) {
        if (f && typeof f.key === 'string') out[f.key] = f;
    }
    return out;
}
