export declare function getConfigDir(): string;
export declare function getConfigPath(): string;
export type LatConfig = {
    llm_key?: string;
};
export declare function readConfig(): LatConfig;
export declare function writeConfig(config: LatConfig): void;
/**
 * Returns the LLM key from (in priority order):
 * 1. LAT_LLM_KEY environment variable
 * 2. LAT_LLM_KEY_FILE — path to a file containing the key
 * 3. LAT_LLM_KEY_HELPER — shell command that prints the key
 * 4. llm_key field in ~/.config/lat/config.json
 *
 * As a special case, `LAT_EMBED_PROVIDER=local` selects the in-process local
 * embedding model (see [[cli#search#Local Mode]]) without any API key — it
 * synthesizes a `local:<id>` key (honoring an explicit `LAT_LLM_KEY=local:<id>`
 * if also set). Returns undefined if nothing is configured.
 */
export declare function getLlmKey(): string | undefined;
/**
 * The key actually used for embeddings. lat.md is **local-first**: with nothing
 * configured it returns `'local'`, selecting the in-process GGUF model (see
 * [[cli#search#Local Mode]]) so semantic search works out of the box with no
 * token. A remote provider is used only when an OpenAI (`sk-...`) or Vercel
 * (`vck_...`) key is explicitly configured via [[src/config.ts#getLlmKey]].
 *
 * Returns `undefined` only when the user explicitly opts out of embeddings with
 * `LAT_EMBED_PROVIDER=none` — search then falls back to keyword/heading
 * matching with no model download.
 */
export declare function getEffectiveKey(): string | undefined;
