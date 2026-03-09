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
  },
  firebase: {
    apiKey: "AIzaSyCEsQeDFAiRnDOYk1CQ70gS9UGUqwqis_o",
    authDomain: "play-tv-db.firebaseapp.com",
    projectId: "play-tv-db",
    storageBucket: "play-tv-db.firebasestorage.app",
    messagingSenderId: "779618863140",
    appId: "1:779618863140:web:323986699a21fc0614f0b1",
    measurementId: "G-8V1CVL05V7"
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
