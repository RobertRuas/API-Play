const crypto = require("crypto");

// -----------------------------------------------------------------------------
// Store em memoria (sem banco de dados)
// -----------------------------------------------------------------------------
// Observacao:
// - dados sao perdidos quando o processo reinicia;
// - ideal para ambiente simples/testes sem dependencias externas.
// -----------------------------------------------------------------------------

const usersById = new Map();
const userIdByUsername = new Map();
const userIdByEmail = new Map();
const sessionsByToken = new Map();

const authConfig = {
  auto_login_enabled: true,
  auto_login_username: "robert",
  updated_at: null,
  updated_by: "system"
};

let seedDone = false;

// Override opcional por ambiente:
// - AUTO_LOGIN_OVERRIDE=off|false|0|disabled   => desativa
// - AUTO_LOGIN_OVERRIDE=on|true|1|enabled      => ativa com usuario configurado (ou robert)
// - AUTO_LOGIN_OVERRIDE=<username>              => ativa e força este usuario
function resolveEnvAutoLoginOverride(currentUsername = "robert") {
  const raw = String(process.env.AUTO_LOGIN_OVERRIDE || "").trim();
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  if (["off", "false", "0", "disabled"].includes(normalized)) {
    return { enabled: false, username: "", overridden: true };
  }
  if (["on", "true", "1", "enabled"].includes(normalized)) {
    return {
      enabled: true,
      username: String(currentUsername || "robert").trim().toLowerCase() || "robert",
      overridden: true
    };
  }
  return { enabled: true, username: normalized, overridden: true };
}

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return typeof value === "object" && value !== null;
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(String(password || "")).digest("hex");
}

function normalizeType(type) {
  if (type === "movies" || type === "movie") return "vod";
  if (type === "tv") return "live";
  return type;
}

function defaultPreferences() {
  return {
    favorites: {
      live: [],
      vod: [],
      series: []
    },
    continueWatching: [],
    hiddenCategories: {
      live: [],
      vod: [],
      series: []
    },
    player: {
      showBufferOverlay: false
    },
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

function ensurePreferences(pref) {
  const p = isObject(pref) ? pref : {};
  if (!isObject(p.favorites)) p.favorites = {};
  if (!Array.isArray(p.favorites.live)) p.favorites.live = [];
  if (!Array.isArray(p.favorites.vod)) p.favorites.vod = [];
  if (!Array.isArray(p.favorites.series)) p.favorites.series = [];
  if (!Array.isArray(p.continueWatching)) p.continueWatching = [];

  if (!isObject(p.hiddenCategories)) p.hiddenCategories = {};
  if (!Array.isArray(p.hiddenCategories.live)) p.hiddenCategories.live = [];
  if (!Array.isArray(p.hiddenCategories.vod)) p.hiddenCategories.vod = [];
  if (!Array.isArray(p.hiddenCategories.series)) p.hiddenCategories.series = [];

  if (!isObject(p.player)) p.player = {};
  if (typeof p.player.showBufferOverlay !== "boolean") p.player.showBufferOverlay = false;

  if (!isObject(p.catalog)) p.catalog = {};
  const perPage = Number.parseInt(p.catalog.itemsPerPage, 10);
  p.catalog.itemsPerPage = Number.isInteger(perPage) ? Math.min(50, Math.max(5, perPage)) : 20;

  if (!isObject(p.catalog.defaultCategory)) p.catalog.defaultCategory = {};
  for (const type of ["live", "vod", "series"]) {
    const raw = isObject(p.catalog.defaultCategory[type]) ? p.catalog.defaultCategory[type] : {};
    p.catalog.defaultCategory[type] = {
      id: String(raw.id || "").trim(),
      name: String(raw.name || (type === "series" ? "Todas" : "")).trim()
    };
  }

  return p;
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash: _discard, ...safe } = user;
  return clone(safe);
}

function requireUserById(userId) {
  const user = usersById.get(String(userId));
  if (!user) throw new Error("Usuario nao encontrado.");
  return user;
}

async function createUser({ name, email, username, password, role = "user", phone = "", avatar_url = "" }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedUsername = String(username || "").trim().toLowerCase();
  if (!name || !normalizedEmail || !normalizedUsername || !password) {
    throw new Error("name, email, username e password sao obrigatorios.");
  }
  if (userIdByEmail.has(normalizedEmail)) throw new Error("Email ja cadastrado.");
  if (userIdByUsername.has(normalizedUsername)) throw new Error("Usuario ja cadastrado.");

  const userId = crypto.randomUUID();
  const user = {
    id: userId,
    name: String(name || "").trim(),
    email: normalizedEmail,
    username: normalizedUsername,
    password_hash: hashPassword(password),
    role: String(role || "user"),
    status: "active",
    phone: String(phone || "").trim(),
    avatar_url: String(avatar_url || "").trim(),
    created_at: nowIso(),
    updated_at: nowIso(),
    last_login_at: null,
    preferences: defaultPreferences()
  };
  usersById.set(userId, user);
  userIdByUsername.set(normalizedUsername, userId);
  userIdByEmail.set(normalizedEmail, userId);
  return sanitizeUser(user);
}

async function ensureSeedDefaultUser() {
  if (seedDone) return;
  const existingId = userIdByUsername.get("robert");
  if (!existingId) {
    await createUser({
      name: "Robert Ruas",
      email: "92ruas@gmail.com",
      username: "robert",
      password: "sempre",
      role: "admin"
    });
  } else {
    const user = requireUserById(existingId);
    if (user.role !== "admin") user.role = "admin";
    user.updated_at = nowIso();
  }
  // Mantem auto-login padrao sempre apontando para usuario existente.
  if (!authConfig.auto_login_username) authConfig.auto_login_username = "robert";
  if (typeof authConfig.auto_login_enabled !== "boolean") authConfig.auto_login_enabled = true;
  seedDone = true;
}

async function listUsers() {
  await ensureSeedDefaultUser();
  const rows = Array.from(usersById.values()).sort((a, b) =>
    String(a.created_at || "").localeCompare(String(b.created_at || ""))
  );
  return rows.map((row) => sanitizeUser(row));
}

async function createSessionForUser(userId) {
  const token = crypto.randomBytes(24).toString("hex");
  const stamp = nowIso();
  sessionsByToken.set(token, {
    token,
    user_id: String(userId),
    created_at: stamp,
    updated_at: stamp
  });
  const user = requireUserById(userId);
  user.last_login_at = stamp;
  user.updated_at = stamp;
  return token;
}

async function login({ username, email, password }) {
  await ensureSeedDefaultUser();
  const normalizedUsername = String(username || "").trim().toLowerCase();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const pwdHash = hashPassword(password);
  const userId = normalizedUsername
    ? userIdByUsername.get(normalizedUsername)
    : userIdByEmail.get(normalizedEmail);
  const user = userId ? usersById.get(userId) : null;
  if (!user) throw new Error("Credenciais invalidas.");
  if (user.password_hash !== pwdHash) throw new Error("Credenciais invalidas.");
  if (user.status !== "active") throw new Error("Usuario inativo.");

  const token = await createSessionForUser(user.id);
  user.preferences = ensurePreferences(user.preferences);
  return {
    token,
    user: sanitizeUser(user),
    preferences: clone(user.preferences)
  };
}

async function logoutByToken(token) {
  await ensureSeedDefaultUser();
  if (!token) return;
  sessionsByToken.delete(String(token));
}

async function getUserByToken(token) {
  await ensureSeedDefaultUser();
  const session = sessionsByToken.get(String(token || "").trim());
  if (!session || !session.user_id) return null;
  const user = usersById.get(String(session.user_id));
  if (!user) return null;
  user.preferences = ensurePreferences(user.preferences);
  return sanitizeUser(user);
}

async function getAuthConfig() {
  await ensureSeedDefaultUser();
  const envOverride = resolveEnvAutoLoginOverride(authConfig.auto_login_username || "robert");
  if (envOverride) {
    return {
      auto_login_enabled: envOverride.enabled,
      auto_login_username: envOverride.username
    };
  }
  return {
    auto_login_enabled: Boolean(authConfig.auto_login_enabled),
    auto_login_username: String(authConfig.auto_login_username || "")
  };
}

async function updateAuthConfig({ auto_login_enabled, auto_login_username }, actorUserId) {
  await ensureSeedDefaultUser();
  const enabled = Boolean(auto_login_enabled);
  const username = String(auto_login_username || "").trim().toLowerCase();
  if (enabled && !username) {
    throw new Error("Informe o usuario para auto-login.");
  }
  if (enabled) {
    const id = userIdByUsername.get(username);
    const user = id ? usersById.get(id) : null;
    if (!user) throw new Error("Usuario de auto-login nao encontrado.");
    if (user.status !== "active") throw new Error("Usuario de auto-login inativo.");
  }
  authConfig.auto_login_enabled = enabled;
  authConfig.auto_login_username = enabled ? username : "";
  authConfig.updated_at = nowIso();
  authConfig.updated_by = String(actorUserId || "system");
  return {
    auto_login_enabled: authConfig.auto_login_enabled,
    auto_login_username: authConfig.auto_login_username
  };
}

async function tryAutoLogin() {
  await ensureSeedDefaultUser();
  const effective = resolveEnvAutoLoginOverride(authConfig.auto_login_username || "robert") || {
    enabled: authConfig.auto_login_enabled,
    username: authConfig.auto_login_username
  };
  if (!effective.enabled || !effective.username) return null;
  const userId = userIdByUsername.get(String(effective.username));
  const user = userId ? usersById.get(userId) : null;
  if (!user || user.status !== "active") return null;
  const token = await createSessionForUser(user.id);
  user.preferences = ensurePreferences(user.preferences);
  return {
    token,
    user: sanitizeUser(user),
    preferences: clone(user.preferences)
  };
}

async function getPreferences(userId) {
  await ensureSeedDefaultUser();
  const user = requireUserById(userId);
  user.preferences = ensurePreferences(user.preferences);
  return clone(user.preferences);
}

async function resetPreferences(userId) {
  await ensureSeedDefaultUser();
  const user = requireUserById(userId);
  user.preferences = defaultPreferences();
  user.updated_at = nowIso();
  return clone(user.preferences);
}

async function updateSettings(userId, patch = {}) {
  await ensureSeedDefaultUser();
  const user = requireUserById(userId);
  const prefs = ensurePreferences(user.preferences);

  if (patch?.player && typeof patch.player.showBufferOverlay === "boolean") {
    prefs.player.showBufferOverlay = patch.player.showBufferOverlay;
  }

  if (patch?.hiddenCategories && isObject(patch.hiddenCategories)) {
    for (const rawType of ["live", "vod", "series"]) {
      const ids = patch.hiddenCategories[rawType];
      if (Array.isArray(ids)) {
        prefs.hiddenCategories[rawType] = ids.map((id) => String(id)).filter(Boolean);
      }
    }
  }

  if (patch?.catalog && isObject(patch.catalog)) {
    const perPage = Number.parseInt(patch.catalog.itemsPerPage, 10);
    if (Number.isInteger(perPage)) {
      prefs.catalog.itemsPerPage = Math.min(50, Math.max(5, perPage));
    }
    if (isObject(patch.catalog.defaultCategory)) {
      for (const type of ["live", "vod", "series"]) {
        const row = patch.catalog.defaultCategory[type];
        if (!isObject(row)) continue;
        prefs.catalog.defaultCategory[type] = {
          id: String(row.id || "").trim(),
          name: String(row.name || "").trim()
        };
      }
    }
  }

  user.preferences = prefs;
  user.updated_at = nowIso();
  return clone(prefs);
}

async function toggleFavorite(userId, item = {}) {
  await ensureSeedDefaultUser();
  const user = requireUserById(userId);
  const prefs = ensurePreferences(user.preferences);
  const type = normalizeType(String(item.type || "").trim());
  if (!["live", "vod", "series"].includes(type)) throw new Error("type invalido para favorito.");

  const streamId = String(item.stream_id || item.series_id || "").trim();
  if (!streamId) throw new Error("stream_id/series_id obrigatorio.");

  const list = Array.isArray(prefs.favorites[type]) ? prefs.favorites[type] : [];
  const index = list.findIndex((fav) => String(fav.stream_id) === streamId);
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
      updated_at: nowIso()
    });
    favorite = true;
  }
  prefs.favorites[type] = list;
  user.preferences = prefs;
  user.updated_at = nowIso();
  return { favorite };
}

async function listFavorites(userId, type) {
  await ensureSeedDefaultUser();
  const prefs = await getPreferences(userId);
  if (!type) return clone(prefs.favorites);
  const normalizedType = normalizeType(type);
  return clone(prefs.favorites[normalizedType] || []);
}

async function upsertContinueWatching(userId, payload = {}) {
  await ensureSeedDefaultUser();
  const user = requireUserById(userId);
  const prefs = ensurePreferences(user.preferences);
  const type = normalizeType(String(payload.type || "").trim());
  const streamId = String(payload.stream_id || payload.series_id || "").trim();
  if (!streamId || !["live", "vod", "series"].includes(type)) {
    throw new Error("Dados de progresso invalidos.");
  }

  const durationSeconds = Math.max(0, Number(payload.duration_seconds) || 0);
  const positionSeconds = Math.max(0, Number(payload.position_seconds) || 0);
  const progressPercent =
    durationSeconds > 0 ? Math.min(100, Math.round((positionSeconds / durationSeconds) * 100)) : 0;

  const key = `${type}:${streamId}`;
  const list = Array.isArray(prefs.continueWatching) ? prefs.continueWatching : [];
  const index = list.findIndex((row) => row.key === key);
  const row = {
    key,
    type,
    stream_id: streamId,
    title: String(payload.title || "").trim(),
    image: String(payload.image || "").trim(),
    play_url: String(payload.play_url || "").trim(),
    duration_seconds: durationSeconds,
    position_seconds: positionSeconds,
    progress_percent: progressPercent,
    updated_at: nowIso()
  };

  if (index >= 0) list.splice(index, 1);
  list.unshift(row);
  prefs.continueWatching = list.slice(0, 300);
  user.preferences = prefs;
  user.updated_at = nowIso();
  return clone(row);
}

async function listContinueWatching(userId) {
  await ensureSeedDefaultUser();
  const prefs = await getPreferences(userId);
  return clone(prefs.continueWatching);
}

function isFavoriteFromPreferences(preferences, type, streamId) {
  const prefs = ensurePreferences(preferences);
  const normalizedType = normalizeType(type);
  const list = prefs.favorites[normalizedType] || [];
  return list.some((fav) => String(fav.stream_id) === String(streamId));
}

function progressForFromPreferences(preferences, type, streamId) {
  const prefs = ensurePreferences(preferences);
  const key = `${normalizeType(type)}:${streamId}`;
  const row = (prefs.continueWatching || []).find((item) => item.key === key);
  return row ? clone(row) : null;
}

module.exports = {
  createUser,
  listUsers,
  login,
  logoutByToken,
  getAuthConfig,
  updateAuthConfig,
  tryAutoLogin,
  getUserByToken,
  getPreferences,
  resetPreferences,
  updateSettings,
  toggleFavorite,
  listFavorites,
  upsertContinueWatching,
  listContinueWatching,
  isFavoriteFromPreferences,
  progressForFromPreferences
};
