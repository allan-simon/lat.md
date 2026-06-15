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
