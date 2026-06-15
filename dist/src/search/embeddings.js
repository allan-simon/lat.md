const MAX_BATCH = 2048;
/**
 * Embed `texts` with the active provider.
 *
 * `isQuery` distinguishes search queries from indexed documents. HTTP providers
 * (OpenAI/Vercel) ignore it — they use the same model for both. Asymmetric
 * local models (see [[cli#search#Local Mode]]) prepend a query instruction
 * prefix to QUERIES ONLY; documents get no prefix. Defaults to `false`
 * (document) so the indexing path is unaffected.
 */
export async function embed(texts, provider, key, isQuery = false) {
    // Asymmetric in-process providers run the GGUF locally and apply their own
    // query prefix + pooling; dispatch to them before the HTTP batch path.
    if (provider.name === 'local') {
        const { embedLocal } = await import('./local.js');
        return embedLocal(texts, provider, isQuery);
    }
    const results = [];
    for (let i = 0; i < texts.length; i += MAX_BATCH) {
        const batch = texts.slice(i, i + MAX_BATCH);
        const resp = await fetch(`${provider.apiBase}/embeddings`, {
            method: 'POST',
            headers: provider.headers(key),
            body: JSON.stringify({
                model: provider.model,
                input: batch,
            }),
        });
        if (!resp.ok) {
            const body = await resp.text();
            throw new Error(`Embedding API error (${resp.status}): ${body.slice(0, 200)}`);
        }
        const json = (await resp.json());
        const sorted = json.data.sort((a, b) => a.index - b.index);
        for (const item of sorted) {
            results.push(item.embedding);
        }
    }
    return results;
}
