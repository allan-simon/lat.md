import { mkdirSync, existsSync, createWriteStream, statSync } from 'node:fs';
import { rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import xdg from '@folder/xdg';
const QWEN3_06B = {
    id: 'qwen3-0.6b',
    model: 'Qwen3-Embedding-0.6B-Q8_0',
    dimensions: 1024,
    url: 'https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF/resolve/main/Qwen3-Embedding-0.6B-Q8_0.gguf?download=true',
    file: 'Qwen3-Embedding-0.6B-Q8_0.gguf',
    queryPrefix: 'Instruct: Given a search query, retrieve relevant documentation sections\nQuery: ',
};
const MODELS = {
    [QWEN3_06B.id]: QWEN3_06B,
};
/** Default selector used when `LAT_EMBED_PROVIDER=local` with no explicit id. */
const DEFAULT_LOCAL_ID = QWEN3_06B.id;
/** Resolve a `local:<id>` key (or bare `local`) to a model spec. */
export function resolveLocalModel(idOrKey) {
    const id = idOrKey.startsWith('local:')
        ? idOrKey.slice('local:'.length)
        : idOrKey === 'local'
            ? DEFAULT_LOCAL_ID
            : idOrKey;
    const spec = MODELS[id];
    if (!spec) {
        const known = Object.keys(MODELS).join(', ');
        throw new Error(`Unknown local embedding model "${id}". Known: ${known}. Use LAT_LLM_KEY=local:${DEFAULT_LOCAL_ID}.`);
    }
    return spec;
}
/** Build the `EmbeddingProvider` descriptor for a local model spec. */
export function localProvider(spec) {
    return {
        name: 'local',
        apiBase: 'local',
        model: spec.model,
        dimensions: spec.dimensions,
        headers: () => ({}),
    };
}
/** Cache directory for downloaded GGUF model files (XDG cache home). */
export function modelCacheDir() {
    return join(xdg().cache, 'lat', 'models');
}
/**
 * Ensure the model's GGUF file is present locally, downloading it lazily on
 * first use to the XDG cache dir. Streams to a unique per-attempt temp file
 * (`<dest>.<pid>.<uuid>.part`) and renames it onto `dest` only on full success,
 * so an interrupted/failed download leaves no partial GGUF in place (the temp
 * is unlinked on error) and concurrent first-use processes never clobber each
 * other's in-progress file. Not resumable — a failed download restarts.
 */
export async function ensureModelFile(spec) {
    const dir = modelCacheDir();
    mkdirSync(dir, { recursive: true });
    const dest = join(dir, spec.file);
    if (existsSync(dest))
        return dest;
    process.stderr.write(`Downloading local embedding model ${spec.model} (first use, ~639MB)...\n`);
    const resp = await fetch(spec.url);
    if (!resp.ok || !resp.body) {
        throw new Error(`Failed to download model ${spec.model} (${resp.status}). ` +
            `Set LAT_LLM_KEY to a hosted provider, or download the GGUF manually to ${dest}.`);
    }
    // Unique per attempt + process so concurrent first-use runs and retries never
    // share or clobber the same partial file.
    const tmp = `${dest}.${process.pid}.${randomUUID()}.part`;
    try {
        await pipeline(Readable.fromWeb(resp.body), createWriteStream(tmp));
        // Guard against a silently-truncated download: if the server advertised a
        // length, the streamed file must match it before we trust it.
        const expected = Number(resp.headers.get('content-length'));
        if (expected > 0) {
            const got = statSync(tmp).size;
            if (got !== expected) {
                throw new Error(`Downloaded model ${spec.model} is ${got} bytes but Content-Length was ${expected} — incomplete download.`);
            }
        }
    }
    catch (err) {
        // Never leave a partial GGUF behind; ignore unlink errors (e.g. it was
        // never created) and surface the original failure.
        await unlink(tmp).catch(() => { });
        throw err;
    }
    // Atomic publish: the GGUF only ever appears at `dest` fully written.
    await rename(tmp, dest);
    process.stderr.write(`Model ready at ${dest}\n`);
    return dest;
}
let statePromise = null;
/**
 * Lazy-`import()` node-llama-cpp. The module specifier is held in a variable so
 * the TypeScript compiler does not try to resolve its (uninstalled, optional)
 * type declarations — the package is an `optionalDependency` and HTTP-only
 * users must not pay the native cost. Returns the module typed loosely.
 */
async function loadLlama() {
    const specifier = 'node-llama-cpp';
    try {
        return (await import(/* @vite-ignore */ specifier));
    }
    catch (err) {
        throw new Error('Local embedding mode needs the optional dependency "node-llama-cpp". ' +
            'Install it with `npm i node-llama-cpp`, or use a hosted provider via LAT_LLM_KEY. ' +
            `(${err.message})`);
    }
}
async function getState(spec) {
    if (statePromise)
        return statePromise;
    // Cache the success singleton but reset on rejection so one transient
    // failure (GGUF download / native load) doesn't permanently disable local
    // embeddings for the process — the next call retries.
    statePromise = (async () => {
        const mod = await loadLlama();
        const modelPath = await ensureModelFile(spec);
        const llama = await mod.getLlama();
        const model = await llama.loadModel({ modelPath });
        const context = await model.createEmbeddingContext();
        return { model, context };
    })();
    statePromise.catch(() => {
        statePromise = null;
    });
    return statePromise;
}
/**
 * Dispose the in-process model + embedding context and reset the singleton.
 * The model holds ~639MB of native memory and the context a native handle;
 * the long-lived MCP server ([[src/mcp/server.ts#startMcpServer]]) registers
 * this on shutdown so they are freed rather than leaked. If the model is still
 * loading the in-flight init is awaited first; if it failed (singleton already
 * reset) this is a no-op. Safe to call when local mode was never used.
 */
export async function disposeLocal() {
    const pending = statePromise;
    if (!pending)
        return;
    statePromise = null;
    try {
        const state = await pending;
        await state.context.dispose();
        await state.model.dispose?.();
    }
    catch {
        // Init never resolved (or dispose itself failed) — nothing usable to free.
    }
}
/** L2-normalize a vector, returning a new array. */
function l2normalize(vec) {
    let norm = 0;
    for (const v of vec)
        norm += v * v;
    norm = Math.sqrt(norm);
    if (norm === 0)
        return vec.slice();
    return vec.map((v) => v / norm);
}
/**
 * Embed `texts` in-process via the GGUF. Queries get the model's instruction
 * prefix; documents are embedded raw. Outputs are L2-normalized so cosine
 * comparisons (and the chunk mean-pooling) behave. Runs sequentially — the
 * embedding context handles one input at a time.
 */
export async function embedLocal(texts, provider, isQuery) {
    const spec = findSpecByModel(provider.model);
    const state = await getState(spec);
    const out = [];
    for (const text of texts) {
        const input = isQuery ? spec.queryPrefix + text : text;
        const { vector } = await state.context.getEmbeddingFor(input);
        out.push(l2normalize([...vector]));
    }
    return out;
}
/** Map a provider's resolved model name back to its spec. */
function findSpecByModel(model) {
    for (const spec of Object.values(MODELS)) {
        if (spec.model === model)
            return spec;
    }
    throw new Error(`No local model spec for "${model}".`);
}
