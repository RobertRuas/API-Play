// -----------------------------------------------------------------------------
// API backend da aplicação Xtream
// -----------------------------------------------------------------------------
// Este servidor Express centraliza:
// 1) Conexão com Xtream
// 2) Cache em memória
// 3) Paginação/filtros
// 4) Endpoints de catálogo e detalhes de séries
// -----------------------------------------------------------------------------
require("dotenv").config();

const express = require("express");
const os = require("os");
const path = require("path");
const {
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
} = require("./userStore");

const app = express();
const PORT = 3000;
const HOST = "0.0.0.0";
const CACHE_TTL_MS = 60 * 1000;

let activeConnection = {
  serverUrl: process.env.XTREAM_SERVER_URL || "",
  username: process.env.XTREAM_USERNAME || "",
  password: process.env.XTREAM_PASSWORD || ""
};

const cache = new Map();

app.use(express.json());
app.use("/js", express.static(path.join(__dirname, "app/src/js")));
app.use(express.static(path.join(__dirname, "app/public")));

async function authUserFromReq(req) {
  const token = String(req.headers["x-auth-token"] || "").trim();
  if (!token) return null;
  return getUserByToken(token);
}

async function requireAuth(req, res, next) {
  try {
    const user = await authUserFromReq(req);
    if (!user) return fail(res, 401, "Nao autenticado.");
    req.authUser = user;
    return next();
  } catch (error) {
    return fail(res, 500, "Falha ao validar sessao.", error.message);
  }
}

function requireAdmin(req, res, next) {
  if (!req.authUser || req.authUser.role !== "admin") {
    return fail(res, 403, "Acesso restrito a administradores.");
  }
  return next();
}

// Valida se o valor é um objeto real (não nulo).
function isObject(value) {
  return typeof value === "object" && value !== null;
}

// Normaliza URL base removendo barras finais duplicadas.
function normalizeBaseUrl(serverUrl) {
  return String(serverUrl || "").trim().replace(/\/+$/, "");
}

// Resolve credenciais a partir da requisição ou da conexão ativa.
function getConnection(input = {}) {
  const baseUrl = normalizeBaseUrl(input.serverUrl || activeConnection.serverUrl);
  const username = String(input.username || activeConnection.username || "").trim();
  const password = String(input.password || activeConnection.password || "").trim();

  if (!baseUrl || !username || !password) {
    throw new Error("serverUrl, username e password sao obrigatorios.");
  }

  return { baseUrl, username, password };
}

// Gera chave única para cache por conexão + ação + parâmetros extras.
function cacheKey(conn, action, extraParams = {}) {
  const extras = new URLSearchParams(extraParams).toString();
  return `${conn.baseUrl}|${conn.username}|${conn.password}|${action || "summary"}|${extras}`;
}

// Limpa entradas de cache de uma conexão específica.
function clearConnectionCache(conn) {
  const prefix = `${conn.baseUrl}|${conn.username}|${conn.password}|`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

// Consulta Xtream com retry simples e cache TTL em memória.
async function fetchXtream(conn, action, extraParams = {}) {
  const key = cacheKey(conn, action, extraParams);
  const now = Date.now();
  const fromCache = cache.get(key);
  if (fromCache && fromCache.expiresAt > now) {
    return { data: fromCache.data, cache: "HIT" };
  }

  const params = new URLSearchParams({
    username: conn.username,
    password: conn.password
  });
  if (action) params.set("action", action);
  for (const [paramKey, paramValue] of Object.entries(extraParams)) {
    if (paramValue != null && paramValue !== "") {
      params.set(paramKey, String(paramValue));
    }
  }

  const url = `${conn.baseUrl}/player_api.php?${params.toString()}`;
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!response.ok) {
        throw new Error(`Falha ao consultar Xtream (${response.status})`);
      }
      const data = await response.json();
      cache.set(key, { data, expiresAt: now + CACHE_TTL_MS });
      return { data, cache: "MISS" };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

// Extrai paginação e busca textual da query.
function parsePaging(req) {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limitRaw = Number.parseInt(req.query.limit, 10) || 50;
  const limit = Math.min(200, Math.max(1, limitRaw));
  const q = String(req.query.q || "").trim().toLowerCase();
  return { page, limit, q };
}

// Extrai filtro de categoria da query.
function parseCategory(req) {
  const raw = req.query.category_id;
  if (raw == null || raw === "") return null;
  return String(raw).trim();
}

// Pagina lista em memória.
function paginateList(items, page, limit) {
  const total = items.length;
  const start = (page - 1) * limit;
  const end = start + limit;
  return {
    rows: items.slice(start, end),
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit))
  };
}

// Filtra lista por nome.
function filterByQuery(items, q) {
  if (!q) return items;
  return items.filter((item) => String(item?.name || "").toLowerCase().includes(q));
}

// Filtra lista por category_id.
function filterByCategory(items, categoryId) {
  if (!categoryId) return items;
  return items.filter((item) => String(item?.category_id || "") === categoryId);
}

// Resposta padrão de sucesso.
function ok(res, data, meta = {}) {
  return res.json({ ok: true, data, meta });
}

// Resposta padrão de erro.
function fail(res, status, message, detail) {
  return res.status(status).json({
    ok: false,
    error: message,
    detail: detail || null
  });
}

function isFavoriteForUser(user, type, streamId) {
  if (!user?.preferences) return false;
  return isFavoriteFromPreferences(user.preferences, type, streamId);
}

function progressForUser(user, type, streamId) {
  if (!user?.preferences) return null;
  return progressForFromPreferences(user.preferences, type, streamId);
}

// ---------------------------------------------------------------------------
// API de acesso/usuário/preferências
// ---------------------------------------------------------------------------
app.post("/api/auth/login", async (req, res) => {
  try {
    const data = await login(req.body || {});
    return ok(res, data);
  } catch (error) {
    return fail(res, 401, error.message || "Falha de autenticacao.");
  }
});

app.post("/api/auth/logout", async (req, res) => {
  try {
    const token = String(req.headers["x-auth-token"] || "").trim();
    await logoutByToken(token);
    return ok(res, { logged_out: true });
  } catch (error) {
    return fail(res, 400, "Falha ao encerrar sessao.", error.message);
  }
});

app.get("/api/auth/auto-login", async (_req, res) => {
  try {
    const data = await tryAutoLogin();
    if (!data) return ok(res, { enabled: false });
    return ok(res, { enabled: true, ...data });
  } catch (error) {
    return fail(res, 400, "Falha no auto-login.", error.message);
  }
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  return ok(res, {
    user: req.authUser,
    preferences: await getPreferences(req.authUser.id)
  });
});

app.get("/api/admin/auth-config", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const data = await getAuthConfig();
    return ok(res, data);
  } catch (error) {
    return fail(res, 400, "Falha ao carregar configuracao de autenticacao.", error.message);
  }
});

app.put("/api/admin/auth-config", requireAuth, requireAdmin, async (req, res) => {
  try {
    const data = await updateAuthConfig(req.body || {}, req.authUser.id);
    return ok(res, data);
  } catch (error) {
    return fail(res, 400, "Falha ao salvar configuracao de autenticacao.", error.message);
  }
});

app.get("/api/users", async (req, res) => {
  return ok(res, await listUsers());
});

app.post("/api/users", async (req, res) => {
  try {
    const user = await createUser(req.body || {});
    return ok(res, user);
  } catch (error) {
    return fail(res, 400, error.message || "Falha ao criar usuario.");
  }
});

app.get("/api/settings", requireAuth, async (req, res) => {
  return ok(res, await getPreferences(req.authUser.id));
});

app.put("/api/settings", requireAuth, async (req, res) => {
  try {
    const prefs = await updateSettings(req.authUser.id, req.body || {});
    return ok(res, prefs);
  } catch (error) {
    return fail(res, 400, error.message || "Falha ao atualizar configuracoes.");
  }
});

app.post("/api/settings/reset", requireAuth, async (req, res) => {
  try {
    const prefs = await resetPreferences(req.authUser.id);
    return ok(res, prefs);
  } catch (error) {
    return fail(res, 400, error.message || "Falha ao restaurar configuracoes.");
  }
});

app.get("/api/favorites", requireAuth, async (req, res) => {
  const type = String(req.query.type || "").trim();
  const data = await listFavorites(req.authUser.id, type || null);
  if (!type) return ok(res, data);
  const rows = (Array.isArray(data) ? data : []).map((item) => {
    const progress = progressForFromPreferences(req.authUser.preferences, type, item.stream_id);
    return {
      ...item,
      progress_percent: progress?.progress_percent || 0,
      position_seconds: progress?.position_seconds || 0,
      duration_seconds: progress?.duration_seconds || 0
    };
  });
  return ok(res, rows);
});

app.post("/api/favorites/toggle", requireAuth, async (req, res) => {
  try {
    const result = await toggleFavorite(req.authUser.id, req.body || {});
    return ok(res, result);
  } catch (error) {
    return fail(res, 400, error.message || "Falha ao atualizar favorito.");
  }
});

app.get("/api/progress", requireAuth, async (req, res) => {
  return ok(res, await listContinueWatching(req.authUser.id));
});

app.post("/api/progress/upsert", requireAuth, async (req, res) => {
  try {
    const row = await upsertContinueWatching(req.authUser.id, req.body || {});
    return ok(res, row);
  } catch (error) {
    return fail(res, 400, error.message || "Falha ao salvar progresso.");
  }
});

// Enriquecimento de stream com play_url final.
function withPlayUrl(kind, conn, item) {
  const id = item.stream_id ?? item.series_id;
  if (id == null) return null;

  if (kind === "live") {
    return {
      ...item,
      play_url: `${conn.baseUrl}/live/${conn.username}/${conn.password}/${id}.m3u8`
    };
  }
  if (kind === "vod") {
    const ext = item.container_extension || "mp4";
    return {
      ...item,
      play_url: `${conn.baseUrl}/movie/${conn.username}/${conn.password}/${id}.${ext}`
    };
  }
  const ext = item.container_extension || item.ext || "mp4";
  return {
    ...item,
    play_url: `${conn.baseUrl}/series/${conn.username}/${conn.password}/${id}.${ext}`
  };
}

// Enriquecimento de episódio de série com play_url.
function parseSeriesEpisode(episode, conn) {
  const episodeId = episode?.id ?? episode?.stream_id ?? episode?.episode_id;
  if (episodeId == null) return null;
  const ext =
    episode?.container_extension ||
    episode?.info?.container_extension ||
    episode?.episode_info?.container_extension ||
    "mp4";

  return {
    ...episode,
    play_url: `${conn.baseUrl}/series/${conn.username}/${conn.password}/${episodeId}.${ext}`
  };
}

// Conecta com credenciais e salva sessão ativa.
app.post("/api/connect", async (req, res) => {
  try {
    const conn = getConnection(req.body || {});
    const result = await fetchXtream(conn);
    activeConnection = {
      serverUrl: conn.baseUrl,
      username: conn.username,
      password: conn.password
    };
    clearConnectionCache(conn);
    return ok(res, {
      connection: activeConnection,
      user_info: result.data?.user_info || null,
      server_info: result.data?.server_info || null
    });
  } catch (error) {
    return fail(res, 502, "Nao foi possivel conectar ao Xtream.", error.message);
  }
});

// Resumo da conta e do servidor Xtream.
app.get("/api/summary", async (req, res) => {
  try {
    const conn = getConnection(req.query);
    const { data, cache: cacheStatus } = await fetchXtream(conn);
    return ok(
      res,
      {
        user_info: data?.user_info || null,
        server_info: data?.server_info || null
      },
      { cache: cacheStatus }
    );
  } catch (error) {
    return fail(res, 502, "Falha ao carregar resumo.", error.message);
  }
});

// Handler genérico de listas (live/vod).
async function handleListEndpoint(req, res, action, kind) {
  try {
    const conn = getConnection(req.query);
    const authUser = await authUserFromReq(req);
    const { page, limit, q } = parsePaging(req);
    const categoryId = parseCategory(req);
    const { data, cache: cacheStatus } = await fetchXtream(conn, action);
    const list = Array.isArray(data) ? data : [];
    const filtered = filterByCategory(filterByQuery(list, q), categoryId)
      .map((item) => {
        const row = withPlayUrl(kind, conn, item);
        if (!row) return null;
        if (!authUser) return row;
        const streamId = row.stream_id ?? row.series_id;
        const progress = progressForUser(authUser, kind, streamId);
        return {
          ...row,
          is_favorite: isFavoriteForUser(authUser, kind, streamId),
          progress_percent: progress?.progress_percent || 0,
          position_seconds: progress?.position_seconds || 0,
          duration_seconds: progress?.duration_seconds || 0
        };
      })
      .filter(Boolean);
    const pageData = paginateList(filtered, page, limit);
    return ok(res, pageData.rows, {
      cache: cacheStatus,
      page: pageData.page,
      limit: pageData.limit,
      total: pageData.total,
      totalPages: pageData.totalPages,
      q: q || null,
      category_id: categoryId
    });
  } catch (error) {
    return fail(res, 502, "Falha ao carregar lista.", error.message);
  }
}

app.get("/api/live", (req, res) => handleListEndpoint(req, res, "get_live_streams", "live"));
app.get("/api/vod", (req, res) => handleListEndpoint(req, res, "get_vod_streams", "vod"));
app.get("/api/series", async (req, res) => {
  try {
    const conn = getConnection(req.query);
    const authUser = await authUserFromReq(req);
    const { page, limit, q } = parsePaging(req);
    const categoryId = parseCategory(req);
    const { data, cache: cacheStatus } = await fetchXtream(conn, "get_series");
    const list = Array.isArray(data) ? data : [];
    const filtered = filterByCategory(filterByQuery(list, q), categoryId);
    const pageData = paginateList(filtered, page, limit);
    const rows = pageData.rows.map((item) => {
      const streamId = item.series_id;
      const progress = progressForUser(authUser, "series", streamId);
      return {
        ...item,
        detail_endpoint: `/api/series/${item.series_id}`,
        is_favorite: isFavoriteForUser(authUser, "series", streamId),
        progress_percent: progress?.progress_percent || 0,
        position_seconds: progress?.position_seconds || 0,
        duration_seconds: progress?.duration_seconds || 0
      };
    });
    return ok(res, rows, {
      cache: cacheStatus,
      page: pageData.page,
      limit: pageData.limit,
      total: pageData.total,
      totalPages: pageData.totalPages,
      q: q || null,
      category_id: categoryId
    });
  } catch (error) {
    return fail(res, 502, "Falha ao carregar series.", error.message);
  }
});

// Mapeia tipo de catálogo para ações Xtream.
function catalogConfig(type) {
  if (type === "live") return { action: "get_live_streams", kind: "live", categoriesAction: "get_live_categories" };
  if (type === "vod") return { action: "get_vod_streams", kind: "vod", categoriesAction: "get_vod_categories" };
  if (type === "series") return { action: "get_series", kind: "series", categoriesAction: "get_series_categories" };
  return null;
}

// Catálogo unificado por tipo (live, vod, series).
app.get("/api/catalog", async (req, res) => {
  try {
    const type = String(req.query.type || "").trim();
    const config = catalogConfig(type);
    if (!config) return fail(res, 400, "type invalido. Use live, vod ou series.");

    const conn = getConnection(req.query);
    const authUser = await authUserFromReq(req);
    const { page, limit, q } = parsePaging(req);
    const categoryId = parseCategory(req);
    const { data, cache: cacheStatus } = await fetchXtream(conn, config.action);

    const list = Array.isArray(data) ? data : [];
    const filtered = filterByCategory(filterByQuery(list, q), categoryId);
    const pageData = paginateList(filtered, page, limit);
    const rows =
      config.kind === "series"
        ? pageData.rows.map((item) => {
            const streamId = item.series_id;
            const progress = progressForUser(authUser, "series", streamId);
            return {
              ...item,
              detail_endpoint: `/api/series/${item.series_id}`,
              is_favorite: isFavoriteForUser(authUser, "series", streamId),
              progress_percent: progress?.progress_percent || 0,
              position_seconds: progress?.position_seconds || 0,
              duration_seconds: progress?.duration_seconds || 0
            };
          })
        : pageData.rows
            .map((item) => {
              const row = withPlayUrl(config.kind, conn, item);
              if (!row) return null;
              if (!authUser) return row;
              const streamId = row.stream_id ?? row.series_id;
              const progress = progressForUser(authUser, config.kind, streamId);
              return {
                ...row,
                is_favorite: isFavoriteForUser(authUser, config.kind, streamId),
                progress_percent: progress?.progress_percent || 0,
                position_seconds: progress?.position_seconds || 0,
                duration_seconds: progress?.duration_seconds || 0
              };
            })
            .filter(Boolean);

    return ok(res, rows, {
      cache: cacheStatus,
      type,
      page: pageData.page,
      limit: pageData.limit,
      total: pageData.total,
      totalPages: pageData.totalPages,
      q: q || null,
      category_id: categoryId
    });
  } catch (error) {
    return fail(res, 502, "Falha ao carregar catalogo.", error.message);
  }
});

// Categorias por tipo do catálogo.
app.get("/api/catalog/categories", async (req, res) => {
  try {
    const type = String(req.query.type || "").trim();
    const config = catalogConfig(type);
    if (!config) return fail(res, 400, "type invalido. Use live, vod ou series.");

    const conn = getConnection(req.query);
    const { data, cache: cacheStatus } = await fetchXtream(conn, config.categoriesAction);
    const rows = (Array.isArray(data) ? data : []).map((item) => ({
      category_id: String(item.category_id || ""),
      category_name: item.category_name || item.name || "Sem nome"
    }));
    return ok(res, rows, { cache: cacheStatus, type });
  } catch (error) {
    return fail(res, 502, "Falha ao carregar categorias.", error.message);
  }
});

// Página de detalhes da série (info + temporadas + episódios).
app.get("/api/series/:seriesId", async (req, res) => {
  try {
    const conn = getConnection(req.query);
    const authUser = await authUserFromReq(req);
    const seriesId = Number.parseInt(req.params.seriesId, 10);
    if (!Number.isInteger(seriesId) || seriesId <= 0) {
      return fail(res, 400, "seriesId invalido.");
    }

    const { data, cache: cacheStatus } = await fetchXtream(conn, "get_series_info", {
      series_id: seriesId
    });

    const episodesMap = isObject(data?.episodes) ? data.episodes : {};
    const seasons = Object.entries(episodesMap).map(([season, episodes]) => {
      const items = Array.isArray(episodes) ? episodes : [];
      return {
        season: Number.parseInt(season, 10) || season,
        episodes: items
          .map((episode) => {
            const row = parseSeriesEpisode(episode, conn);
            if (!row) return null;
            if (!authUser) return row;
            const streamId = row.id ?? row.stream_id ?? row.episode_id;
            const progress = progressForUser(authUser, "series", streamId);
            return {
              ...row,
              progress_percent: progress?.progress_percent || 0,
              position_seconds: progress?.position_seconds || 0,
              duration_seconds: progress?.duration_seconds || 0
            };
          })
          .filter(Boolean)
      };
    });

    return ok(
      res,
      {
        series_id: seriesId,
        info: data?.info || {},
        seasons,
        is_favorite: isFavoriteForUser(authUser, "series", seriesId)
      },
      { cache: cacheStatus, totalSeasons: seasons.length }
    );
  } catch (error) {
    return fail(res, 502, "Falha ao carregar detalhes da serie.", error.message);
  }
});

// Endpoint legado para diagnóstico (mantido por compatibilidade).
app.post("/api/load", async (req, res) => {
  try {
    const conn = getConnection(req.body || {});
    const { data: summary } = await fetchXtream(conn);
    const { data: live } = await fetchXtream(conn, "get_live_streams");
    const { data: vod } = await fetchXtream(conn, "get_vod_streams");
    const { data: series } = await fetchXtream(conn, "get_series");
    return res.json({
      ok: true,
      raw: {
        serverInfo: summary,
        liveStreams: live,
        vodStreams: vod,
        series
      },
      urls: {
        live: (Array.isArray(live) ? live : [])
          .map((item) => withPlayUrl("live", conn, item))
          .filter(Boolean),
        movie: (Array.isArray(vod) ? vod : [])
          .map((item) => withPlayUrl("vod", conn, item))
          .filter(Boolean),
        series: (Array.isArray(series) ? series : [])
          .map((item) => withPlayUrl("series", conn, item))
          .filter(Boolean)
      }
    });
  } catch (error) {
    return fail(res, 502, "Nao foi possivel carregar dados do Xtream.", error.message);
  }
});

module.exports = app;

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    const interfaces = os.networkInterfaces();
    const lanIps = [];
    for (const values of Object.values(interfaces)) {
      for (const info of values || []) {
        if (info && info.family === "IPv4" && !info.internal) {
          lanIps.push(info.address);
        }
      }
    }
    console.log(`Servidor em http://localhost:${PORT}`);
    for (const ip of lanIps) {
      console.log(`Rede local: http://${ip}:${PORT}`);
    }
    if (!activeConnection.serverUrl || !activeConnection.username || !activeConnection.password)
      console.warn("Aviso: defina XTREAM_SERVER_URL, XTREAM_USERNAME e XTREAM_PASSWORD no ambiente.");
  });
}
