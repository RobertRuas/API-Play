// -----------------------------------------------------------------------------
// Configuracoes globais do frontend (carregadas em runtime)
// -----------------------------------------------------------------------------
// As configuracoes sao injetadas pelo backend em /app-config.js com base no .env.
// -----------------------------------------------------------------------------

const runtime = window.__APP_ENV || {};

export const APP_CONFIG = {
  xtream: {
    serverUrl: String(runtime?.xtream?.serverUrl || "").trim(),
    username: String(runtime?.xtream?.username || "").trim(),
    password: String(runtime?.xtream?.password || "").trim()
  },
  client: {
    apiCacheTtlMs: Number.parseInt(runtime?.client?.apiCacheTtlMs, 10) || 60 * 1000,
    loginUsername: String(runtime?.client?.loginUsername || "robert").trim().toLowerCase(),
    loginPassword: String(runtime?.client?.loginPassword || "sempre"),
    autoLoginEnabled: Boolean(runtime?.client?.autoLoginEnabled ?? true)
  }
};

export const DEFAULT_CONN = {
  serverUrl: APP_CONFIG.xtream.serverUrl,
  username: APP_CONFIG.xtream.username,
  password: APP_CONFIG.xtream.password
};

export const API_CACHE_TTL_MS = APP_CONFIG.client.apiCacheTtlMs;
