import type { EmbeddingProvider } from './provider.js';
/**
 * Embed `texts` with the active provider.
 *
 * `isQuery` distinguishes search queries from indexed documents. HTTP providers
 * (OpenAI/Vercel) ignore it — they use the same model for both. Asymmetric
 * local models (see [[cli#search#Local Mode]]) prepend a query instruction
 * prefix to QUERIES ONLY; documents get no prefix. Defaults to `false`
 * (document) so the indexing path is unaffected.
 */
export declare function embed(texts: string[], provider: EmbeddingProvider, key: string, isQuery?: boolean): Promise<number[][]>;
