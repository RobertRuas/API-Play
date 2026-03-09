// -----------------------------------------------------------------------------
// Camada de servicos da aplicacao (frontend)
// -----------------------------------------------------------------------------
// Este modulo centraliza:
// - chamadas HTTP para o backend Xtream;
// - cache de requests no cliente;
// - persistencia local (localStorage) para:
//   favoritos, progresso, configuracoes e auto-login;
// - contratos publicos consumidos pelas views.
//
// Importante:
// - nao ha banco de dados;
// - tudo que e estado do usuario fica no navegador.
// -----------------------------------------------------------------------------

import { API_CACHE_TTL_MS, DEFAULT_CONN } from "../config.js";
import { withPageLoader } from "../ui/pageLoader.js";

const cache = new Map();
let connected = false;
let currentSession = null;

const DEFAULT_USER = {
  id: "local-admin",
  name: "Robert Ruas",
  email: "local@browser.session",
  username: "robert",
  role: "admin"
};

const STORAGE = {
  settings: "app_local_settings",
  favorites: "app_local_favorites",
  progress: "app_local_progress",
  authConfig: "app_local_auth_config"
};

// Utilitario para limpar fatias do cache por prefixo de chave.
function clearCachePrefix(prefix) {
  for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key);
}

// Limpa cache completo de requests.
function clearAllCache() {
  cache.clear();
}

// Leitura segura de JSON no localStorage.
function getJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

// Escrita de JSON no localStorage.
function setJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// Configuracao padrao aplicada na primeira execucao.
function defaultSettings() {
  return {
    hiddenCategories: { live: [], vod: [], series: [] },
    player: { showBufferOverlay: false },
    catalog: {
      itemsPerPage: 20,
      defaultCategory: {
        live: { id: "", name: "Canais | Aberto" },
        vod: { id: "", name: "Filmes I Lancamentos" },
        series: { id: "", name: "Todas" }
      }
    }
  };
}

// Garante shape esperado das configuracoes para evitar erros nas views.
function ensureSettingsShape(value) {
  const s = value && typeof value === "object" ? value : {};
  if (!s.hiddenCategories || typeof s.hiddenCategories !== "object") s.hiddenCategories = {};
  for (const type of ["live", "vod", "series"]) {
    if (!Array.isArray(s.hiddenCategories[type])) s.hiddenCategories[type] = [];
  }
  if (!s.player || typeof s.player !== "object") s.player = {};
  if (typeof s.player.showBufferOverlay !== "boolean") s.player.showBufferOverlay = false;
  if (!s.catalog || typeof s.catalog !== "object") s.catalog = {};
  const per = Number.parseInt(s.catalog.itemsPerPage, 10);
  s.catalog.itemsPerPage = Number.isInteger(per) ? Math.min(50, Math.max(5, per)) : 20;
  if (!s.catalog.defaultCategory || typeof s.catalog.defaultCategory !== "object") s.catalog.defaultCategory = {};
  for (const type of ["live", "vod", "series"]) {
    const row = s.catalog.defaultCategory[type] && typeof s.catalog.defaultCategory[type] === "object" ? s.catalog.defaultCategory[type] : {};
    s.catalog.defaultCategory[type] = {
      id: String(row.id || "").trim(),
      name: String(row.name || (type === "series" ? "Todas" : "")).trim()
    };
  }
  return s;
}

// Le configuracoes locais e aplica shape padrao.
function getSettingsLocal() {
  const settings = ensureSettingsShape(getJson(STORAGE.settings, defaultSettings()));
  setJson(STORAGE.settings, settings);
  return settings;
}

// Persiste configuracoes locais.
function setSettingsLocal(next) {
  const settings = ensureSettingsShape(next);
  setJson(STORAGE.settings, settings);
  return settings;
}

// Le favoritos locais com fallback seguro.
function getFavoritesLocal() {
  const fav = getJson(STORAGE.favorites, { live: [], vod: [], series: [] });
  if (!Array.isArray(fav.live)) fav.live = [];
  if (!Array.isArray(fav.vod)) fav.vod = [];
  if (!Array.isArray(fav.series)) fav.series = [];
  setJson(STORAGE.favorites, fav);
  return fav;
}

// Persiste favoritos locais.
function setFavoritesLocal(value) {
  const current = getFavoritesLocal();
  const next = {
    live: Array.isArray(value?.live) ? value.live : current.live,
    vod: Array.isArray(value?.vod) ? value.vod : current.vod,
    series: Array.isArray(value?.series) ? value.series : current.series
  };
  setJson(STORAGE.favorites, next);
  return next;
}

// Chave unica para progresso/favorito por tipo e stream.
function progressKey(type, streamId) {
  return `${String(type || "")}:${String(streamId || "")}`;
}

// Le progresso local.
function getProgressLocal() {
  const p = getJson(STORAGE.progress, {});
  if (!p || typeof p !== "object") return {};
  return p;
}

// Persiste progresso local.
function setProgressLocal(value) {
  setJson(STORAGE.progress, value && typeof value === "object" ? value : {});
}

// Le configuracao local de auto-login (escopo apenas navegador atual).
function getAuthConfigLocal() {
  const fallback = { auto_login_enabled: true, auto_login_username: "robert" };
  const row = getJson(STORAGE.authConfig, fallback);
  if (!row || typeof row !== "object") return fallback;
  const enabled = Boolean(row.auto_login_enabled);
  const username = String(row.auto_login_username || "robert").trim().toLowerCase() || "robert";
  const next = { auto_login_enabled: enabled, auto_login_username: username };
  setJson(STORAGE.authConfig, next);
  return next;
}

// Persiste configuracao local de auto-login.
function setAuthConfigLocal(value) {
  const next = {
    auto_login_enabled: Boolean(value?.auto_login_enabled),
    auto_login_username: String(value?.auto_login_username || "robert").trim().toLowerCase() || "robert"
  };
  setJson(STORAGE.authConfig, next);
  return next;
}

// Normaliza nome de tipo para contrato interno.
function normalizedType(type) {
  if (type === "movie" || type === "movies") return "vod";
  if (type === "tv") return "live";
  return type;
}

// Indexa favoritos em mapa para lookup rapido.
function favoriteMap() {
  const fav = getFavoritesLocal();
  const map = new Map();
  for (const type of ["live", "vod", "series"]) {
    for (const row of fav[type]) {
      map.set(progressKey(type, row.stream_id), true);
    }
  }
  return map;
}

// Indexa progresso em mapa para lookup rapido.
function progressMap() {
  const p = getProgressLocal();
  return new Map(Object.entries(p));
}

// Enriquecimento de itens de catalogo com metadados locais (favorito/progresso).
function applyLocalMetaToCatalog(type, rows) {
  const fav = favoriteMap();
  const progress = progressMap();
  const normalized = normalizedType(type);
  return (Array.isArray(rows) ? rows : []).map((item) => {
    const streamId = String(item.stream_id ?? item.series_id ?? "");
    const key = progressKey(normalized, streamId);
    const progressRow = progress.get(key) || {};
    return {
      ...item,
      is_favorite: Boolean(fav.get(key)),
      progress_percent: Number(progressRow.progress_percent || 0),
      position_seconds: Number(progressRow.position_seconds || 0),
      duration_seconds: Number(progressRow.duration_seconds || 0)
    };
  });
}

// Enriquecimento de series com metadados locais por episodio.
function applyLocalMetaToSeriesDetail(data) {
  const progress = progressMap();
  const seasons = Array.isArray(data?.seasons) ? data.seasons : [];
  return {
    ...data,
    seasons: seasons.map((season) => ({
      ...season,
      episodes: (Array.isArray(season.episodes) ? season.episodes : []).map((episode) => {
        const episodeId = String(episode.id ?? episode.stream_id ?? episode.episode_id ?? "");
        const key = progressKey("series", episodeId);
        const row = progress.get(key) || {};
        return {
          ...episode,
          progress_percent: Number(row.progress_percent || 0),
          position_seconds: Number(row.position_seconds || 0),
          duration_seconds: Number(row.duration_seconds || 0)
        };
      })
    }))
  };
}

// Parse padrao de resposta da API backend.
async function parseResponse(response) {
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data?.error || "Falha na API");
  return data;
}

// GET com cache e loader opcional.
async function apiGet(path, { useLoader = true } = {}) {
  const cacheKey = `GET:${path}`;
  const now = Date.now();
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > now) return hit.data;

  const runFetch = () => fetch(path);
  const response = useLoader ? await withPageLoader(runFetch) : await runFetch();
  const data = await parseResponse(response);
  cache.set(cacheKey, { data, expiresAt: now + API_CACHE_TTL_MS });
  return data;
}

// POST com loader opcional.
async function apiPost(path, body, { useLoader = true } = {}) {
  const runFetch = () =>
    fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    });
  const response = useLoader ? await withPageLoader(runFetch) : await runFetch();
  return parseResponse(response);
}

// Estado de sessao local (no navegador atual).
export function isAuthenticated() {
  return Boolean(currentSession?.user);
}

export function getSession() {
  return currentSession;
}

export async function loginApp({ username, password }) {
  const user = String(username || "").trim().toLowerCase();
  const pass = String(password || "");
  if (user !== "robert" || pass !== "sempre") {
    throw new Error("Credenciais invalidas.");
  }
  currentSession = { user: { ...DEFAULT_USER }, preferences: getSettingsLocal() };
  return currentSession;
}

// Auto-login local controlado por configuracao local (admin settings).
export async function tryAutoLogin() {
  const cfg = getAuthConfigLocal();
  if (!cfg.auto_login_enabled) return null;
  currentSession = { user: { ...DEFAULT_USER, username: cfg.auto_login_username || "robert" }, preferences: getSettingsLocal() };
  return currentSession;
}

export async function logoutApp() {
  currentSession = null;
  connected = false;
  clearAllCache();
}

export async function ensureSession() {
  if (currentSession?.user) return currentSession;
  const auto = await tryAutoLogin();
  if (auto) return auto;
  return null;
}

export async function ensureConnected() {
  if (connected) return;
  await apiPost("/api/connect", DEFAULT_CONN);
  connected = true;
}

export async function getCurrentUser() {
  const session = await ensureSession();
  if (!session) throw new Error("Nao autenticado.");
  return session;
}

export async function getUserSettings() {
  const settings = getSettingsLocal();
  if (currentSession) currentSession.preferences = settings;
  return settings;
}

export async function updateUserSettings(settingsPatch) {
  const current = getSettingsLocal();
  const next = {
    ...current,
    ...settingsPatch,
    player: { ...(current.player || {}), ...(settingsPatch?.player || {}) },
    catalog: { ...(current.catalog || {}), ...(settingsPatch?.catalog || {}) },
    hiddenCategories: { ...(current.hiddenCategories || {}), ...(settingsPatch?.hiddenCategories || {}) }
  };
  const saved = setSettingsLocal(next);
  if (currentSession) currentSession.preferences = saved;
  return saved;
}

export async function resetUserSettings() {
  const saved = setSettingsLocal(defaultSettings());
  if (currentSession) currentSession.preferences = saved;
  return saved;
}

export async function getAdminAuthConfig() {
  return getAuthConfigLocal();
}

export async function updateAdminAuthConfig(payload) {
  return setAuthConfigLocal(payload || {});
}

export async function listFavorites(type = "") {
  const fav = getFavoritesLocal();
  if (!type) return fav;
  const t = normalizedType(type);
  return fav[t] || [];
}

export async function toggleFavorite(item) {
  const type = normalizedType(String(item.type || ""));
  if (!["live", "vod", "series"].includes(type)) throw new Error("type invalido para favorito.");
  const streamId = String(item.stream_id || item.series_id || "").trim();
  if (!streamId) throw new Error("stream_id obrigatorio.");
  const fav = getFavoritesLocal();
  const list = Array.isArray(fav[type]) ? fav[type] : [];
  const index = list.findIndex((row) => String(row.stream_id) === streamId);
  let favorite = false;
  if (index >= 0) {
    list.splice(index, 1);
    favorite = false;
  } else {
    list.unshift({
      stream_id: streamId,
      type,
      title: String(item.title || "").trim(),
      image: String(item.image || "").trim(),
      play_url: String(item.play_url || "").trim(),
      updated_at: new Date().toISOString()
    });
    favorite = true;
  }
  fav[type] = list;
  setFavoritesLocal(fav);
  return { favorite };
}

export async function listContinueWatching() {
  const map = getProgressLocal();
  return Object.values(map).sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
}

export async function saveProgress(payload) {
  const type = normalizedType(String(payload.type || ""));
  const streamId = String(payload.stream_id || payload.series_id || "").trim();
  if (!streamId || !["live", "vod", "series"].includes(type)) return null;
  const duration = Math.max(0, Number(payload.duration_seconds) || 0);
  const position = Math.max(0, Number(payload.position_seconds) || 0);
  const percent = duration > 0 ? Math.min(100, Math.round((position / duration) * 100)) : 0;
  const key = progressKey(type, streamId);
  const current = getProgressLocal();
  const row = {
    key,
    type,
    stream_id: streamId,
    title: String(payload.title || "").trim(),
    image: String(payload.image || "").trim(),
    play_url: String(payload.play_url || "").trim(),
    duration_seconds: duration,
    position_seconds: position,
    progress_percent: percent,
    updated_at: new Date().toISOString()
  };
  current[key] = row;
  setProgressLocal(current);
  return row;
}

export async function getSeriesDetail(seriesId) {
  await ensureConnected();
  const data = await apiGet(`/api/series/${seriesId}`);
  const detail = applyLocalMetaToSeriesDetail(data.data);
  detail.is_favorite = Boolean(favoriteMap().get(progressKey("series", seriesId)));
  return detail;
}

export async function getCatalogCategories(type) {
  await ensureConnected();
  const data = await apiGet(`/api/catalog/categories?type=${encodeURIComponent(type)}`);
  return data.data;
}

export async function getCatalogPage({ type, categoryId = "", page = 1, limit = 20, q = "" }) {
  await ensureConnected();
  const params = new URLSearchParams({ type, page: String(page), limit: String(limit) });
  if (categoryId) params.set("category_id", String(categoryId));
  if (q) params.set("q", q);
  const data = await apiGet(`/api/catalog?${params.toString()}`);
  return {
    ...data,
    data: applyLocalMetaToCatalog(type, data.data || [])
  };
}

export async function searchGlobal({ q, limit = 20 }) {
  await ensureConnected();
  const term = String(q || "").trim();
  if (!term) return { live: [], vod: [], series: [] };
  const [live, vod, series] = await Promise.all([
    getCatalogPage({ type: "live", q: term, limit, page: 1 }),
    getCatalogPage({ type: "vod", q: term, limit, page: 1 }),
    getCatalogPage({ type: "series", q: term, limit, page: 1 })
  ]);
  return { live: live.data || [], vod: vod.data || [], series: series.data || [] };
}

export async function getEffectiveItemsPerPage() {
  const settings = getSettingsLocal();
  const raw = Number.parseInt(settings?.catalog?.itemsPerPage, 10);
  if (Number.isInteger(raw)) return Math.min(50, Math.max(5, raw));
  return 20;
}
