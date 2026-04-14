// Writes snippet.json + snippet.txt + textures/ for a single repathed material
// into <repoPath>/materials/<id>/.
//
// Renders ritobin-style text directly from the cloned raw entry node produced
// by the repather. This avoids a second ritobin subprocess round-trip and
// gives us exact control over the output shape, which matters because we want
// snippet.txt to be copy-pasted directly into a champion's .bin file.

export async function emitSnippet(material, repoPath /*, jsonToTextFn */) {
    if (!repoPath) throw new Error('repo path not configured');
    if (!material.id) throw new Error('material has no id');

    // `relPath` is set by the extractor (e.g. "ahri/skin77/ahri-tails-inst")
    // so that champion-specific materials land in nested folders. Curated
    // materials dropped into the tree by hand just use their id.
    const rel = material.relPath || material.id;
    const matDir = `${repoPath}/materials/${rel}`;

    // Create the full parent chain — createDirectory only makes leaf dirs
    // in Neutralino, so we walk upward.
    await ensureDirRecursive(matDir);
    await ensureDir(`${matDir}/textures`);

    const snippetText = renderEntryToText(material._raw);

    await writeText(`${matDir}/snippet.txt`, snippetText);

    const meta = {
        id: material.id,
        name: humanizeName(material.id),
        category: classifyCategory(material),
        version: 1,
        updatedAt: new Date().toISOString(),
        description: '',
        userSlots: material.userSlots || [],
        materialName: material.materialName,
        textureFiles: (material.textureFiles || []).map(t => ({
            name: t.name,
            updatedAt: t.updatedAt,
        })),
        snippetFile: 'snippet.txt',
        // Traceability — which champion/skin/bin this material was pulled from.
        source: {
            champion: material.sourceChampion || null,
            skin: material.sourceSkin || null,
            bin: material.sourceBin || null,
            entryKey: material.entryKey || null,
        },
        usedBy: material.usedBy || [],
    };
    await writeText(`${matDir}/snippet.json`, JSON.stringify(meta, null, 2));
}

// ── Ritobin text renderer ──────────────────────────────────────────────────
//
// The repather gives us a cloned entry node of shape:
//   { key: "jadelib_foo", value: { name: "StaticMaterialDef", items: [...] } }
//
// Each item inside is either a field `{key, type, value}` or an inline value
// (for list items). The value shape depends on the type:
//
//   string / link         : primitive string
//   u32 / s32 / u64 / ...  : number
//   f32                    : number
//   bool                   : boolean
//   vec2/vec3/vec4/rgba    : array of numbers
//   embed                  : { name: "ClassName", items: [...] }
//   list / list2           : { valueType, items: [...] }
//   map                    : { keyType, valueType, items: [{key, value}, ...] }
//   pointer                : { name, items } or null
//
// The text format mirrors moonshadow565/ritobin's output:
//   "key" = StaticMaterialDef {
//       name: string = "value"
//       samplerValues: list2[embed] = {
//           StaticMaterialShaderSamplerDef {
//               TextureName: string = "..."
//           }
//       }
//   }

function renderEntryToText(entry) {
    const key = entry?.key ?? '';
    const body = entry?.value;
    if (!body || !body.name) return '';

    const lines = [];
    lines.push(`"${key}" = ${body.name} {`);
    for (const field of body.items || []) {
        lines.push(...renderField(field, 1));
    }
    lines.push('}');
    return lines.join('\n');
}

function renderField(field, depth) {
    const indent = '    '.repeat(depth);
    const name = field?.key ?? '';
    const type = field?.type ?? '';
    const value = field?.value;

    // Composite types with their own line layout
    if (type === 'embed' || type === 'pointer') {
        if (!value) return [`${indent}${name}: ${type} = null`];
        const head = `${indent}${name}: ${type} = ${value.name || ''} {`;
        const inner = (value.items || []).flatMap(f => renderField(f, depth + 1));
        if (inner.length === 0) return [`${head.replace(' {', ` {}`)}`];
        return [head, ...inner, `${indent}}`];
    }

    if (type === 'list' || type === 'list2') {
        const inner = renderListBody(value, depth + 1);
        const valueType = value?.valueType || '';
        const typeStr = `${type}[${valueType}]`;
        if (inner.length === 0) return [`${indent}${name}: ${typeStr} = {}`];
        return [`${indent}${name}: ${typeStr} = {`, ...inner, `${indent}}`];
    }

    if (type === 'map') {
        const inner = renderMapBody(value, depth + 1);
        const keyType = value?.keyType || '';
        const valueType = value?.valueType || '';
        const typeStr = `map[${keyType},${valueType}]`;
        if (inner.length === 0) return [`${indent}${name}: ${typeStr} = {}`];
        return [`${indent}${name}: ${typeStr} = {`, ...inner, `${indent}}`];
    }

    // Primitive types
    return [`${indent}${name}: ${type} = ${formatPrimitive(type, value)}`];
}

function renderListBody(listNode, depth) {
    const indent = '    '.repeat(depth);
    const items = Array.isArray(listNode?.items) ? listNode.items : [];
    const valueType = listNode?.valueType || '';
    const lines = [];

    for (const item of items) {
        if (valueType === 'embed' || valueType === 'pointer') {
            if (!item) {
                lines.push(`${indent}null`);
                continue;
            }
            const inner = (item.items || []).flatMap(f => renderField(f, depth + 1));
            if (inner.length === 0) {
                lines.push(`${indent}${item.name || ''} {}`);
            } else {
                lines.push(`${indent}${item.name || ''} {`);
                lines.push(...inner);
                lines.push(`${indent}}`);
            }
        } else {
            // Primitive list element — just the raw value
            lines.push(`${indent}${formatPrimitive(valueType, item)}`);
        }
    }
    return lines;
}

function renderMapBody(mapNode, depth) {
    const indent = '    '.repeat(depth);
    const items = Array.isArray(mapNode?.items) ? mapNode.items : [];
    const keyType = mapNode?.keyType || 'string';
    const valueType = mapNode?.valueType || 'string';
    const lines = [];

    for (const item of items) {
        const k = formatPrimitive(keyType, item?.key);
        if (valueType === 'embed' || valueType === 'pointer') {
            const v = item?.value;
            if (!v) {
                lines.push(`${indent}${k} = null`);
                continue;
            }
            const inner = (v.items || []).flatMap(f => renderField(f, depth + 1));
            if (inner.length === 0) {
                lines.push(`${indent}${k} = ${v.name || ''} {}`);
            } else {
                lines.push(`${indent}${k} = ${v.name || ''} {`);
                lines.push(...inner);
                lines.push(`${indent}}`);
            }
        } else {
            lines.push(`${indent}${k} = ${formatPrimitive(valueType, item?.value)}`);
        }
    }
    return lines;
}

function formatPrimitive(type, value) {
    if (value === null || value === undefined) return 'null';

    switch (type) {
        case 'string':
        case 'link':
        case 'hash':
        case 'file':
            return `"${String(value).replace(/"/g, '\\"')}"`;

        case 'bool':
            return value ? 'true' : 'false';

        case 'f32':
        case 'f64':
        case 'u8': case 'u16': case 'u32': case 'u64':
        case 's8': case 's16': case 's32': case 's64':
            return String(value);

        case 'vec2':
        case 'vec3':
        case 'vec4':
        case 'rgba':
        case 'ivec2':
        case 'ivec3':
        case 'ivec4':
        case 'mtx44':
            if (Array.isArray(value)) return `{ ${value.join(', ')} }`;
            return String(value);

        default:
            if (typeof value === 'string') return `"${value}"`;
            if (typeof value === 'number' || typeof value === 'boolean') return String(value);
            return JSON.stringify(value);
    }
}

// ── Metadata helpers ───────────────────────────────────────────────────────

function humanizeName(id) {
    return id
        .replace(/-/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

function classifyCategory(material) {
    const name = (material.id || '').toLowerCase();
    if (name.includes('toon')) return 'toon';
    if (name.includes('glass') || name.includes('refract')) return 'glass';
    if (name.includes('fur') || name.includes('hair')) return 'fur';
    if (name.includes('dissolve') || name.includes('burn')) return 'dissolve';
    if (name.includes('glow') || name.includes('emissive')) return 'glow';
    if (name.includes('distort')) return 'distortion';
    return 'special';
}

async function ensureDir(path) {
    if (typeof Neutralino === 'undefined') return;
    try {
        await Neutralino.filesystem.createDirectory(path);
    } catch (e) {
        // already exists
    }
}

async function ensureDirRecursive(path) {
    if (typeof Neutralino === 'undefined') return;
    // Normalize separators, split, and create each ancestor.
    const norm = String(path).replace(/\\/g, '/');
    const parts = norm.split('/');
    let cur = '';
    for (const p of parts) {
        if (!p) { cur += '/'; continue; }
        // Preserve Windows drive root `C:/`.
        cur = cur ? (cur.endsWith('/') ? `${cur}${p}` : `${cur}/${p}`) : p;
        try {
            await Neutralino.filesystem.createDirectory(cur);
        } catch (e) {}
    }
}

async function writeText(path, content) {
    if (typeof Neutralino === 'undefined') return;
    await Neutralino.filesystem.writeFile(path, content);
}
