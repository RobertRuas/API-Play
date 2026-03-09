// -----------------------------------------------------------------------------
// Configuracoes globais da aplicacao (frontend)
// -----------------------------------------------------------------------------
// Este arquivo centraliza configuracoes editaveis por ambiente.
// Para deploy em producao, prefira injetar valores via processo de build/env.
// -----------------------------------------------------------------------------

export const APP_CONFIG = {
  xtream: {
    serverUrl: "http://playprime.top",
    username: "717770178",
    password: "778822612"
  }
};

export const DEFAULT_CONN = {
  serverUrl: APP_CONFIG.xtream.serverUrl,
  username: APP_CONFIG.xtream.username,
  password: APP_CONFIG.xtream.password
};

// TTL do cache no cliente (em milissegundos).
export const API_CACHE_TTL_MS = 60 * 1000;
