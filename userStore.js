const crypto = require("crypto");
const fs = require("fs");
const admin = require("firebase-admin");

// -----------------------------------------------------------------------------
// Store com persistência em Firestore
// -----------------------------------------------------------------------------
let db = null;
let seedPromise = null;

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(String(password || "")).digest("hex");
}

function normalizeType(type) {
  if (type === "movies") return "vod";
  if (type === "movie") return "vod";
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

function isObject(value) {
  return typeof value === "object" && value !== null;
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash: _, ...safe } = user;
  return clone(safe);
}

function initFirestore() {
  if (db) return db;

  if (!admin.apps.length) {
    const inlineJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const servicePath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    const googleCredPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const projectId = process.env.FIREBASE_PROJECT_ID || "play-tv-db";

    if (inlineJson) {
      const credentials = JSON.parse(inlineJson);
      admin.initializeApp({
        credential: admin.credential.cert(credentials),
        projectId
      });
    } else if (servicePath && fs.existsSync(servicePath)) {
      const credentials = JSON.parse(fs.readFileSync(servicePath, "utf8"));
      admin.initializeApp({
        credential: admin.credential.cert(credentials),
        projectId
      });
    } else if (googleCredPath && fs.existsSync(googleCredPath)) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId
      });
    } else {
      throw new Error(
        "Firebase nao configurado para backend. Defina FIREBASE_SERVICE_ACCOUNT_PATH " +
          "(ex: ./keys/play-tv-db-service-account.json) ou GOOGLE_APPLICATION_CREDENTIALS."
      );
    }
  }

  db = admin.firestore();
  db.settings({ ignoreUndefinedProperties: true });
  return db;
}

function usersCollection() {
  return initFirestore().collection("users");
}

function sessionsCollection() {
  return initFirestore().collection("sessions");
}

function appConfigCollection() {
  return initFirestore().collection("app_config");
}

async function findUserByUsername(username) {
  const normalized = String(username || "").trim().toLowerCase();
  if (!normalized) return null;
  const snap = await usersCollection().where("username", "==", normalized).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

async function findUserByEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return null;
  const snap = await usersCollection().where("email", "==", normalized).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

async function getUserById(userId) {
  const doc = await usersCollection().doc(String(userId)).get();
  if (!doc.exists) throw new Error("Usuario nao encontrado.");
  return { id: doc.id, ...doc.data() };
}

async function ensureSeedDefaultUser() {
  if (seedPromise) return seedPromise;
  seedPromise = (async () => {
    const existing = await findUserByUsername("robert");
    if (!existing) {
      await createUser({
        name: "Robert Ruas",
        email: "92ruas@gmail.com",
        username: "robert",
        password: "sempre",
        role: "admin"
      });
    } else if (existing.role !== "admin") {
      await usersCollection().doc(existing.id).update({
        role: "admin",
        updated_at: nowIso()
      });
    }

    const authConfigRef = appConfigCollection().doc("auth");
    const authConfigDoc = await authConfigRef.get();
    if (!authConfigDoc.exists) {
      await authConfigRef.set({
        auto_login_enabled: false,
        auto_login_username: "",
        updated_at: nowIso(),
        updated_by: "system"
      });
    }
  })();
  await seedPromise;
}

async function createSessionForUser(userId) {
  const token = crypto.randomBytes(24).toString("hex");
  const stamp = nowIso();
  await sessionsCollection().doc(token).set({
    token,
    user_id: userId,
    created_at: stamp,
    updated_at: stamp
  });
  await usersCollection().doc(String(userId)).update({
    last_login_at: stamp,
    updated_at: stamp
  });
  return token;
}

async function createUser({ name, email, username, password, role = "user", phone = "", avatar_url = "" }) {
  initFirestore();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedUsername = String(username || "").trim().toLowerCase();
  if (!name || !normalizedEmail || !normalizedUsername || !password) {
    throw new Error("name, email, username e password sao obrigatorios.");
  }

  const [byEmail, byUsername] = await Promise.all([
    findUserByEmail(normalizedEmail),
    findUserByUsername(normalizedUsername)
  ]);
  if (byEmail) throw new Error("Email ja cadastrado.");
  if (byUsername) throw new Error("Usuario ja cadastrado.");

  const userId = crypto.randomUUID();
  const user = {
    id: userId,
    name: String(name).trim(),
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
  await usersCollection().doc(userId).set(user);
  return sanitizeUser(user);
}

async function listUsers() {
  initFirestore();
  await ensureSeedDefaultUser();
  const snap = await usersCollection().orderBy("created_at", "asc").limit(500).get();
  return snap.docs.map((doc) => sanitizeUser({ id: doc.id, ...doc.data() }));
}

async function login({ username, email, password }) {
  initFirestore();
  await ensureSeedDefaultUser();
  const normalizedUsername = String(username || "").trim().toLowerCase();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const pwdHash = hashPassword(password);
  const user = normalizedUsername ? await findUserByUsername(normalizedUsername) : await findUserByEmail(normalizedEmail);
  if (!user) throw new Error("Credenciais invalidas.");
  if (user.password_hash !== pwdHash) throw new Error("Credenciais invalidas.");
  if (user.status !== "active") throw new Error("Usuario inativo.");

  const token = await createSessionForUser(user.id);

  const fullUser = await getUserById(user.id);
  fullUser.preferences = ensurePreferences(fullUser.preferences);
  return {
    token,
    user: sanitizeUser(fullUser),
    preferences: clone(fullUser.preferences)
  };
}

async function getUserByToken(token) {
  initFirestore();
  await ensureSeedDefaultUser();
  const sessionDoc = await sessionsCollection().doc(String(token || "")).get();
  if (!sessionDoc.exists) return null;
  const session = sessionDoc.data() || {};
  if (!session.user_id) return null;
  const userDoc = await usersCollection().doc(String(session.user_id)).get();
  if (!userDoc.exists) return null;
  const user = { id: userDoc.id, ...userDoc.data() };
  user.preferences = ensurePreferences(user.preferences);
  return sanitizeUser(user);
}

async function logoutByToken(token) {
  await ensureSeedDefaultUser();
  if (!token) return;
  await sessionsCollection().doc(String(token)).delete();
}

async function getAuthConfig() {
  await ensureSeedDefaultUser();
  const doc = await appConfigCollection().doc("auth").get();
  if (!doc.exists) {
    return {
      auto_login_enabled: false,
      auto_login_username: ""
    };
  }
  const data = doc.data() || {};
  return {
    auto_login_enabled: Boolean(data.auto_login_enabled),
    auto_login_username: String(data.auto_login_username || "")
  };
}

async function updateAuthConfig({ auto_login_enabled, auto_login_username }, actorUserId) {
  await ensureSeedDefaultUser();
  const username = String(auto_login_username || "").trim().toLowerCase();
  const enabled = Boolean(auto_login_enabled);
  if (enabled && !username) {
    throw new Error("Informe o usuario para auto-login.");
  }
  if (enabled) {
    const user = await findUserByUsername(username);
    if (!user) throw new Error("Usuario de auto-login nao encontrado.");
    if (user.status !== "active") throw new Error("Usuario de auto-login inativo.");
  }

  const nextConfig = {
    auto_login_enabled: enabled,
    auto_login_username: enabled ? username : "",
    updated_at: nowIso(),
    updated_by: String(actorUserId || "system")
  };
  await appConfigCollection().doc("auth").set(nextConfig);
  return {
    auto_login_enabled: nextConfig.auto_login_enabled,
    auto_login_username: nextConfig.auto_login_username
  };
}

async function tryAutoLogin() {
  await ensureSeedDefaultUser();
  const config = await getAuthConfig();
  if (!config.auto_login_enabled || !config.auto_login_username) return null;
  const user = await findUserByUsername(config.auto_login_username);
  if (!user || user.status !== "active") return null;
  const token = await createSessionForUser(user.id);
  const fullUser = await getUserById(user.id);
  fullUser.preferences = ensurePreferences(fullUser.preferences);
  return {
    token,
    user: sanitizeUser(fullUser),
    preferences: clone(fullUser.preferences)
  };
}

async function getPreferences(userId) {
  await ensureSeedDefaultUser();
  const user = await getUserById(userId);
  return clone(ensurePreferences(user.preferences));
}

async function resetPreferences(userId) {
  await ensureSeedDefaultUser();
  const preferences = defaultPreferences();
  await usersCollection().doc(String(userId)).update({
    preferences,
    updated_at: nowIso()
  });
  return clone(preferences);
}

async function updateSettings(userId, patch = {}) {
  await ensureSeedDefaultUser();
  const user = await getUserById(userId);
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

  await usersCollection().doc(String(userId)).update({
    preferences: prefs,
    updated_at: nowIso()
  });
  return clone(prefs);
}

async function toggleFavorite(userId, item = {}) {
  await ensureSeedDefaultUser();
  const user = await getUserById(userId);
  const prefs = ensurePreferences(user.preferences);
  const type = normalizeType(String(item.type || "").trim());
  if (!["live", "vod", "series"].includes(type)) throw new Error("type invalido para favorito.");

  const streamId = String(item.stream_id || item.series_id || "").trim();
  if (!streamId) throw new Error("stream_id/series_id obrigatorio.");

  const favs = Array.isArray(prefs.favorites[type]) ? prefs.favorites[type] : [];
  const index = favs.findIndex((fav) => String(fav.stream_id) === streamId);
  let favorite = false;
  if (index >= 0) {
    favs.splice(index, 1);
    favorite = false;
  } else {
    favs.unshift({
      stream_id: streamId,
      type,
      title: String(item.title || "").trim(),
      image: String(item.image || "").trim(),
      play_url: String(item.play_url || "").trim(),
      updated_at: nowIso()
    });
    favorite = true;
  }
  prefs.favorites[type] = favs;
  await usersCollection().doc(String(userId)).update({
    preferences: prefs,
    updated_at: nowIso()
  });
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
  const user = await getUserById(userId);
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
  const item = {
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
  list.unshift(item);
  prefs.continueWatching = list.slice(0, 300);

  await usersCollection().doc(String(userId)).update({
    preferences: prefs,
    updated_at: nowIso()
  });
  return clone(item);
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
  const item = (prefs.continueWatching || []).find((row) => row.key === key);
  return item ? clone(item) : null;
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
