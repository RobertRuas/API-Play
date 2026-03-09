// -----------------------------------------------------------------------------
// Configuracoes globais da aplicacao (frontend)
// -----------------------------------------------------------------------------
// Este arquivo centraliza configuracoes editaveis por ambiente.
// Para deploy em producao, prefira injetar valores via processo de build/env.
// -----------------------------------------------------------------------------

export const APP_CONFIG = {
  xtream: {
    serverUrl: "",
    username: "",
    password: ""
  },
  firebase: {
    apiKey: "",
    authDomain: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: "",
    measurementId: ""
  }
};

export const DEFAULT_CONN = {
  serverUrl: APP_CONFIG.xtream.serverUrl,
  username: APP_CONFIG.xtream.username,
  password: APP_CONFIG.xtream.password
};

export const FIREBASE_CLIENT_CONFIG = { ...APP_CONFIG.firebase };

// TTL do cache no cliente (em milissegundos).
export const API_CACHE_TTL_MS = 60 * 1000;
