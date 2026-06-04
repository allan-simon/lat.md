import { resolveLocalModel, localProvider } from './local.js';

export type EmbeddingProvider = {
  name: string;
  apiBase: string;
  model: string;
  dimensions: number;
  headers: (key: string) => Record<string, string>;
};

/** Build the in-process local provider descriptor for a `local[:id]` key. */
function localProviderFor(key: string): EmbeddingProvider {
  return localProvider(resolveLocalModel(key));
}

const openai: EmbeddingProvider = {
  name: 'openai',
  apiBase: 'https://api.openai.com/v1',
  model: 'text-embedding-3-small',
  dimensions: 1536,
  headers: (key) => ({
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  }),
};

const vercel: EmbeddingProvider = {
  name: 'vercel',
  apiBase: 'https://ai-gateway.vercel.sh/v1',
  model: 'openai/text-embedding-3-small',
  dimensions: 1536,
  headers: (key) => ({
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  }),
};

export function detectProvider(key: string): EmbeddingProvider {
  if (key.startsWith('REPLAY_LAT_LLM_KEY::')) {
    const replayUrl = key.slice('REPLAY_LAT_LLM_KEY::'.length);
    return {
      name: 'replay',
      apiBase: replayUrl,
      model: 'replay',
      dimensions: 1536,
      headers: () => ({ 'Content-Type': 'application/json' }),
    };
  }
  // In-process local GGUF model (no API key, no daemon). Selected via
  // `LAT_LLM_KEY=local:<id>` (e.g. `local:qwen3-0.6b`) or `LAT_EMBED_PROVIDER=
  // local`. The actual model + node-llama-cpp are loaded lazily (see
  // [[cli#search#Local Mode]]); here we only need the provider descriptor, so
  // we build it from the static model registry without touching the native dep.
  if (key === 'local' || key.startsWith('local:')) {
    return localProviderFor(key);
  }
  if (key.startsWith('sk-ant-')) {
    throw new Error(
      "Anthropic doesn't offer an embedding model. Set LAT_LLM_KEY to an OpenAI (sk-...) or Vercel AI Gateway (vck_...) key.",
    );
  }
  if (key.startsWith('vck_')) return vercel;
  if (key.startsWith('sk-')) return openai;
  throw new Error(
    `Unrecognized LAT_LLM_KEY prefix. Supported: OpenAI (sk-...), Vercel AI Gateway (vck_...).`,
  );
}
