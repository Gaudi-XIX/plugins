// magpie plugin: raccoon (商汤小浣熊) — model discovery + object construction.
//
// The raccoon desktop client ships an OpenAI-compatible inference gateway at
// https://xiaohuanxiong.com/api/web/llm/v2 (found in the app's own
// /electron/config/default-llm-config.json as `apiBase`). It takes the
// client's own login JWT as a bearer credential and answers at the standard
// /chat/completions path — streaming or not. There is no /models endpoint
// (404), so the model list comes from /model_catalog, which the client itself
// renders its model picker from.

export const PROVIDER = 'raccoon';

export const SDK = {
  chat: '@ai-sdk/openai-compatible',
};

export const CATALOG_PATH = '/model_catalog';

// What the catalog does not say. `reasoning` is observed: these models
// answered with a non-empty reasoning_content, the raccoon-* ones with null
// (2026-10-16, one request each). `attachment` follows the catalog's own
// per-model description ("支持图像") where it had one.
const OBSERVED = {
  'raccoon-8c4485': { reasoning: false, attachment: true, name: '小浣熊 · 通用' },
  'raccoon-19b265': { reasoning: false, attachment: true, name: '小浣熊 · 通用 B' },
  'raccoon-405a1c': { reasoning: false, attachment: true, name: '小浣熊 · 通用 C' },
  'sn-sensenova-6-8-flash': { reasoning: true, attachment: false, name: 'SenseNova 6.8 Flash' },
  'sn-sensenova-6-8-flash-lite': { reasoning: true, attachment: false, name: 'SenseNova 6.8 Flash Lite' },
  'sn-glm-5-3': { reasoning: true, attachment: false, name: 'GLM-5.3' },
  'sn-kimi-k3': { reasoning: true, attachment: false, name: 'Kimi K3' },
  'sn-glm-5-3-flash': { reasoning: true, attachment: false, name: 'GLM-5.3 Flash' },
  'sn-deepseek-v4-1-flash': { reasoning: true, attachment: false, name: 'DeepSeek V4.1 Flash' },
};

// Names the catalog gives are hashes (raccoon-8c4485); a readable alias keeps
// the picker legible while the id stays the upstream one.
const FRIENDLY = (id) => OBSERVED[id]?.name ?? id;

function modalities(list) {
  const values = Array.isArray(list) && list.length ? list : ['text'];
  return Object.fromEntries(
    ['text', 'image', 'audio', 'video', 'pdf'].map((name) => [name, values.includes(name)]),
  );
}

// One magpie model object for one catalog entry.
export function buildModel(entry, baseURL) {
  const id = entry?.name ?? entry?.model_name ?? entry?.id;
  if (typeof id !== 'string' || !id || id === '__proto__') return null;
  const observed = OBSERVED[id] ?? {};
  const context = entry?.params?.context_window ?? 32768;
  const output = entry?.params?.max_tokens ?? 4096;
  return {
    id,
    providerID: PROVIDER,
    name: FRIENDLY(id),
    api: { id, url: baseURL, npm: SDK.chat },
    limit: { context, output },
    capabilities: {
      temperature: true,
      reasoning: observed.reasoning ?? true,
      attachment: observed.attachment ?? false,
      toolcall: true,
      input: modalities(['text']),
      output: modalities(['text']),
      interleaved: observed.reasoning ? { field: 'reasoning_content' } : false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    variants: {},
    options: {},
    headers: {},
    status: 'active',
    release_date: '',
    free: true,
  };
}

// The catalog is { data: { categories: [ { type, default_model, models: [...] } ] } }.
export function parseCatalog(json) {
  const models = {};
  const categories = json?.data?.categories ?? [];
  for (const category of categories) {
    for (const entry of category?.models ?? []) {
      const model = buildModel(entry, undefined);
      if (model) models[model.id] = model;
    }
  }
  return models;
}

// The config-layer shape magpie writes into providers' `models` key.
export function configModels(models) {
  return Object.fromEntries(
    Object.entries(models).map(([id, model]) => [
      id,
      {
        id,
        name: model.name,
        provider: { npm: model.api.npm, api: model.api.url },
        limit: model.limit,
        reasoning: model.capabilities.reasoning,
        tool_call: model.capabilities.toolcall,
        attachment: model.capabilities.attachment,
        modalities: {
          input: Object.keys(model.capabilities.input).filter((key) => model.capabilities.input[key]),
          output: Object.keys(model.capabilities.output).filter((key) => model.capabilities.output[key]),
        },
        cost: { input: 0, output: 0 },
        variants: model.variants,
        free: true,
      },
    ]),
  );
}

// Used before the catalog has ever been read, so the provider is never empty.
export const bootstrapModels = () => parseCatalog({ data: { categories: [{ type: 'chat', models: Object.keys(OBSERVED).map((name) => ({ name })) }] } });
