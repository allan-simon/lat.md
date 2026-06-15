import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import xdg from '@folder/xdg';
// ── XDG config directory ────────────────────────────────────────────
export function getConfigDir() {
    return join(xdg().config, 'lat');
}
export function getConfigPath() {
    return join(getConfigDir(), 'config.json');
}
export function readConfig() {
    const configPath = getConfigPath();
    if (!existsSync(configPath))
        return {};
    try {
        return JSON.parse(readFileSync(configPath, 'utf-8'));
    }
    catch (err) {
        process.stderr.write(`Error: failed to parse config ${configPath}: ${err.message}\n`);
        process.exit(1);
    }
}
export function writeConfig(config) {
    const dir = getConfigDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(getConfigPath(), JSON.stringify(config, null, 2) + '\n');
}
// ── Centralized LLM key resolution ─────────────────────────────────
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
export function getLlmKey() {
    const envKey = process.env.LAT_LLM_KEY;
    if (envKey)
        return envKey;
    // `LAT_EMBED_PROVIDER=local` opts into the local model with no API key.
    if (process.env.LAT_EMBED_PROVIDER === 'local')
        return 'local';
    const file = process.env.LAT_LLM_KEY_FILE;
    if (file) {
        const content = readFileSync(file, 'utf-8').trim();
        if (!content) {
            throw new Error(`LAT_LLM_KEY_FILE (${file}) is empty.`);
        }
        return content;
    }
    const helper = process.env.LAT_LLM_KEY_HELPER;
    if (helper) {
        const result = execSync(helper, {
            encoding: 'utf-8',
            timeout: 10_000,
        }).trim();
        if (!result) {
            throw new Error('LAT_LLM_KEY_HELPER command returned an empty string.');
        }
        return result;
    }
    const config = readConfig();
    if (config.llm_key)
        return config.llm_key;
    return undefined;
}
