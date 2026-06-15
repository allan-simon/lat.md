import type { EmbeddingProvider } from './provider.js';
/**
 * In-process local embedding provider backed by a GGUF model run through
 * node-llama-cpp (an optional, lazily-imported native dependency). Selected via
 * `LAT_LLM_KEY=local:qwen3-0.6b` or `LAT_EMBED_PROVIDER=local`. Runs entirely
 * offline — no API key, no daemon. See [[cli#search#Local Mode]].
 *
 * Default model: Qwen3-Embedding-0.6B (Q8_0 GGUF, 1024-dim). Qwen embedding
 * models are asymmetric: queries get an instruction prefix, documents do not.
 */
/** Built-in local model registry, keyed by the `local:<id>` selector. */
type LocalModelSpec = {
    /** Selector suffix, e.g. `qwen3-0.6b` for `local:qwen3-0.6b`. */
    id: string;
    model: string;
    dimensions: number;
    /** HuggingFace download URL for the GGUF file. */
    url: string;
    /** File name the GGUF is cached under. */
    file: string;
    /**
     * Instruction prefix prepended to QUERIES ONLY. Documents are embedded raw.
     * Qwen3-Embedding expects this exact one-line-instruct + `\nQuery: ` form.
     */
    queryPrefix: string;
};
/** Resolve a `local:<id>` key (or bare `local`) to a model spec. */
export declare function resolveLocalModel(idOrKey: string): LocalModelSpec;
/** Build the `EmbeddingProvider` descriptor for a local model spec. */
export declare function localProvider(spec: LocalModelSpec): EmbeddingProvider;
/** Cache directory for downloaded GGUF model files (XDG cache home). */
export declare function modelCacheDir(): string;
/**
 * Ensure the model's GGUF file is present locally, downloading it lazily on
 * first use to the XDG cache dir. Streams to a unique per-attempt temp file
 * (`<dest>.<pid>.<uuid>.part`) and renames it onto `dest` only on full success,
 * so an interrupted/failed download leaves no partial GGUF in place (the temp
 * is unlinked on error) and concurrent first-use processes never clobber each
 * other's in-progress file. Not resumable — a failed download restarts.
 */
export declare function ensureModelFile(spec: LocalModelSpec): Promise<string>;
/**
 * Dispose the in-process model + embedding context and reset the singleton.
 * The model holds ~639MB of native memory and the context a native handle;
 * the long-lived MCP server ([[src/mcp/server.ts#startMcpServer]]) registers
 * this on shutdown so they are freed rather than leaked. If the model is still
 * loading the in-flight init is awaited first; if it failed (singleton already
 * reset) this is a no-op. Safe to call when local mode was never used.
 */
export declare function disposeLocal(): Promise<void>;
/**
 * Embed `texts` in-process via the GGUF. Queries get the model's instruction
 * prefix; documents are embedded raw. Outputs are L2-normalized so cosine
 * comparisons (and the chunk mean-pooling) behave. Runs sequentially — the
 * embedding context handles one input at a time.
 */
export declare function embedLocal(texts: string[], provider: EmbeddingProvider, isQuery: boolean): Promise<number[][]>;
export {};
