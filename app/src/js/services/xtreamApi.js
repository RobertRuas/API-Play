// -----------------------------------------------------------------------------
// Camada de acesso à API do backend
// -----------------------------------------------------------------------------
import { API_CACHE_TTL_MS, DEFAULT_CONN } from "../config.js";
import { withPageLoader } from "../ui/pageLoader.js";

const cache = new Map();
let connected = false;
let authToken = localStorage.getItem("app_auth_token") || "";
let currentSession = null;

function authHeaders() {
  return authToken ? { "x-auth-token": authToken } : {};
}

function clearCachePrefix(prefix) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

function clearAllCache() {
  cache.clear();
}

async function parseResponse(response) {
  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(data?.error || "Falha na API");
  }
  return data;
}

async function apiGet(path, { useLoader = true } = {}) {
  const cacheKey = `GET:${path}`;
  const now = Date.now();
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > now) return hit.data;

  const runFetch = () => fetch(path, { headers: { ...authHeaders() } });
  const response = useLoader ? await withPageLoader(runFetch) : await runFetch();
  const data = await parseResponse(response);
  cache.set(cacheKey, { data, expiresAt: now + API_CACHE_TTL_MS });
  return data;
}

async function apiPost(path, body, { useLoader = true } = {}) {
  const runFetch = () =>
    fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body || {})
    });
  const response = useLoader ? await withPageLoader(runFetch) : await runFetch();
  return parseResponse(response);
}

async function apiPut(path, body, { useLoader = true } = {}) {
  const runFetch = () =>
    fetch(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body || {})
    });
  const response = useLoader ? await withPageLoader(runFetch) : await runFetch();
  return parseResponse(response);
}

function setToken(token) {
  authToken = String(token || "");
  if (authToken) localStorage.setItem("app_auth_token", authToken);
  else localStorage.removeItem("app_auth_token");
}

function clearAuthState() {
  setToken("");
  currentSession = null;
  connected = false;
  clearAllCache();
}

export function isAuthenticated() {
  return Boolean(authToken && currentSession?.user);
}

export function getSession() {
  return currentSession;
}

export async function loginApp({ username, password }) {
  const data = await apiPost("/api/auth/login", { username, password });
  setToken(data.data.token);
  currentSession = {
    user: data.data.user,
    preferences: data.data.preferences
  };
  connected = false;
  clearAllCache();
  return currentSession;
}

export async function tryAutoLogin() {
  const data = await apiGet("/api/auth/auto-login", { useLoader: false });
  if (!data.data?.enabled) return null;
  setToken(data.data.token);
  currentSession = {
    user: data.data.user,
    preferences: data.data.preferences
  };
  connected = false;
  clearAllCache();
  return currentSession;
}

export async function logoutApp() {
  try {
    if (authToken) {
      await apiPost("/api/auth/logout", {}, { useLoader: false });
    }
  } catch {}
  clearAuthState();
}

export async function ensureSession() {
  if (currentSession?.user && authToken) return currentSession;
  if (!authToken) return null;
  try {
    const data = await apiGet("/api/auth/me", { useLoader: false });
    currentSession = data.data;
    return currentSession;
  } catch {
    clearAuthState();
    return null;
  }
}

export async function ensureConnected() {
  const session = await ensureSession();
  if (!session) throw new Error("Nao autenticado.");
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
  const session = await ensureSession();
  if (!session) throw new Error("Nao autenticado.");
  const data = await apiGet("/api/settings");
  currentSession = { ...currentSession, preferences: data.data };
  return data.data;
}

export async function updateUserSettings(settingsPatch) {
  await ensureSession();
  const data = await apiPut("/api/settings", settingsPatch);
  clearCachePrefix("GET:/api/settings");
  currentSession = { ...currentSession, preferences: data.data };
  return data.data;
}

export async function resetUserSettings() {
  await ensureSession();
  const data = await apiPost("/api/settings/reset", {});
  clearCachePrefix("GET:/api/settings");
  currentSession = { ...currentSession, preferences: data.data };
  return data.data;
}

export async function getAdminAuthConfig() {
  await ensureSession();
  const data = await apiGet("/api/admin/auth-config");
  return data.data;
}

export async function updateAdminAuthConfig(payload) {
  await ensureSession();
  const data = await apiPut("/api/admin/auth-config", payload);
  return data.data;
}

export async function listFavorites(type = "") {
  await ensureSession();
  const qs = type ? `?type=${encodeURIComponent(type)}` : "";
  const data = await apiGet(`/api/favorites${qs}`);
  return data.data;
}

export async function toggleFavorite(item) {
  await ensureSession();
  const data = await apiPost("/api/favorites/toggle", item);
  clearCachePrefix("GET:/api/favorites");
  return data.data;
}

export async function listContinueWatching() {
  await ensureSession();
  const data = await apiGet("/api/progress");
  return data.data;
}

export async function saveProgress(payload) {
  await ensureSession();
  const data = await apiPost("/api/progress/upsert", payload);
  clearCachePrefix("GET:/api/progress");
  return data.data;
}

export async function getSeriesDetail(seriesId) {
  await ensureConnected();
  const data = await apiGet(`/api/series/${seriesId}`);
  return data.data;
}

export async function getCatalogCategories(type) {
  await ensureConnected();
  const data = await apiGet(`/api/catalog/categories?type=${encodeURIComponent(type)}`);
  return data.data;
}

export async function getCatalogPage({ type, categoryId = "", page = 1, limit = 20, q = "" }) {
  await ensureConnected();
  const params = new URLSearchParams({
    type,
    page: String(page),
    limit: String(limit)
  });
  if (categoryId) params.set("category_id", String(categoryId));
  if (q) params.set("q", q);
  const data = await apiGet(`/api/catalog?${params.toString()}`);
  return data;
}

// Busca global nas três categorias principais.
export async function searchGlobal({ q, limit = 20 }) {
  await ensureConnected();
  const term = String(q || "").trim();
  if (!term) {
    return { live: [], vod: [], series: [] };
  }
  const [live, vod, series] = await Promise.all([
    getCatalogPage({ type: "live", q: term, limit, page: 1 }),
    getCatalogPage({ type: "vod", q: term, limit, page: 1 }),
    getCatalogPage({ type: "series", q: term, limit, page: 1 })
  ]);
  return {
    live: live.data || [],
    vod: vod.data || [],
    series: series.data || []
  };
}

export async function getEffectiveItemsPerPage() {
  const settings = await getUserSettings();
  const raw = Number.parseInt(settings?.catalog?.itemsPerPage, 10);
  if (Number.isInteger(raw)) return Math.min(50, Math.max(5, raw));
  return 20;
}
