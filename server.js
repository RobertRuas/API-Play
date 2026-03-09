// -----------------------------------------------------------------------------
// Backend Express minimo para integracao com Xtream
// -----------------------------------------------------------------------------
// Este servidor:
// - serve os arquivos estaticos da SPA;
// - oferece endpoints de catalogo/series/load baseados em Xtream;
// - utiliza cache simples em memoria para reduzir latencia e carga no provedor.
//
// Nao ha:
// - banco de dados;
// - autenticacao no backend;
// - persistencia de usuario no servidor.
// -----------------------------------------------------------------------------

require("dotenv").config();

const express = require("express");
const os = require("os");
const path = require("path");

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

function normalizeBaseUrl(serverUrl) {
  return String(serverUrl || "").trim().replace(/\/+$/, "");
}

// Resolve credenciais de conexao:
// 1) request atual (quando informado)
// 2) conexao ativa do servidor (env/conexao anterior)
function getConnection(input = {}) {
  const baseUrl = normalizeBaseUrl(input.serverUrl || activeConnection.serverUrl);
  const username = String(input.username || activeConnection.username || "").trim();
  const password = String(input.password || activeConnection.password || "").trim();
  if (!baseUrl || !username || !password) {
    throw new Error("serverUrl, username e password sao obrigatorios.");
  }
  return { baseUrl, username, password };
}

function cacheKey(conn, action, extraParams = {}) {
  const extras = new URLSearchParams(extraParams).toString();
  return `${conn.baseUrl}|${conn.username}|${conn.password}|${action || "summary"}|${extras}`;
}

function clearConnectionCache(conn) {
  const prefix = `${conn.baseUrl}|${conn.username}|${conn.password}|`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

// Chamada principal ao Xtream com timeout + retry + cache.
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
      if (!response.ok) throw new Error(`Falha ao consultar Xtream (${response.status})`);
      const data = await response.json();
      cache.set(key, { data, expiresAt: now + CACHE_TTL_MS });
      return { data, cache: "MISS" };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function parsePaging(req) {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limitRaw = Number.parseInt(req.query.limit, 10) || 50;
  const limit = Math.min(200, Math.max(1, limitRaw));
  const q = String(req.query.q || "").trim().toLowerCase();
  return { page, limit, q };
}

function parseCategory(req) {
  const raw = req.query.category_id;
  if (raw == null || raw === "") return null;
  return String(raw).trim();
}

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

function filterByQuery(items, q) {
  if (!q) return items;
  return items.filter((item) => String(item?.name || "").toLowerCase().includes(q));
}

function filterByCategory(items, categoryId) {
  if (!categoryId) return items;
  return items.filter((item) => String(item?.category_id || "") === categoryId);
}

function ok(res, data, meta = {}) {
  return res.json({ ok: true, data, meta });
}

function fail(res, status, message, detail) {
  return res.status(status).json({
    ok: false,
    error: message,
    detail: detail || null
  });
}

function withPlayUrl(kind, conn, item) {
  const id = item.stream_id ?? item.series_id;
  if (id == null) return null;
  if (kind === "live") {
    return { ...item, play_url: `${conn.baseUrl}/live/${conn.username}/${conn.password}/${id}.m3u8` };
  }
  if (kind === "vod") {
    const ext = item.container_extension || "mp4";
    return { ...item, play_url: `${conn.baseUrl}/movie/${conn.username}/${conn.password}/${id}.${ext}` };
  }
  const ext = item.container_extension || item.ext || "mp4";
  return { ...item, play_url: `${conn.baseUrl}/series/${conn.username}/${conn.password}/${id}.${ext}` };
}

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

function catalogConfig(type) {
  if (type === "live") return { action: "get_live_streams", kind: "live", categoriesAction: "get_live_categories" };
  if (type === "vod") return { action: "get_vod_streams", kind: "vod", categoriesAction: "get_vod_categories" };
  if (type === "series")
    return { action: "get_series", kind: "series", categoriesAction: "get_series_categories" };
  return null;
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/api/connect", async (req, res) => {
  try {
    const conn = getConnection(req.body || {});
    const result = await fetchXtream(conn);
    activeConnection = { serverUrl: conn.baseUrl, username: conn.username, password: conn.password };
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

app.get("/api/catalog", async (req, res) => {
  try {
    const type = String(req.query.type || "").trim();
    const config = catalogConfig(type);
    if (!config) return fail(res, 400, "type invalido. Use live, vod ou series.");
    const conn = getConnection(req.query);
    const { page, limit, q } = parsePaging(req);
    const categoryId = parseCategory(req);
    const { data, cache: cacheStatus } = await fetchXtream(conn, config.action);
    const list = Array.isArray(data) ? data : [];
    const filtered = filterByCategory(filterByQuery(list, q), categoryId);
    const pageData = paginateList(filtered, page, limit);
    const rows =
      config.kind === "series"
        ? pageData.rows.map((item) => ({ ...item, detail_endpoint: `/api/series/${item.series_id}` }))
        : pageData.rows.map((item) => withPlayUrl(config.kind, conn, item)).filter(Boolean);
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

app.get("/api/series/:seriesId", async (req, res) => {
  try {
    const conn = getConnection(req.query);
    const seriesId = Number.parseInt(req.params.seriesId, 10);
    if (!Number.isInteger(seriesId) || seriesId <= 0) return fail(res, 400, "seriesId invalido.");
    const { data, cache: cacheStatus } = await fetchXtream(conn, "get_series_info", { series_id: seriesId });
    const episodesMap = typeof data?.episodes === "object" && data?.episodes ? data.episodes : {};
    const seasons = Object.entries(episodesMap).map(([season, episodes]) => {
      const items = Array.isArray(episodes) ? episodes : [];
      return {
        season: Number.parseInt(season, 10) || season,
        episodes: items.map((episode) => parseSeriesEpisode(episode, conn)).filter(Boolean)
      };
    });
    return ok(res, { series_id: seriesId, info: data?.info || {}, seasons }, { cache: cacheStatus });
  } catch (error) {
    return fail(res, 502, "Falha ao carregar detalhes da serie.", error.message);
  }
});

app.post("/api/load", async (req, res) => {
  try {
    const conn = getConnection(req.body || {});
    const { data: summary } = await fetchXtream(conn);
    const { data: live } = await fetchXtream(conn, "get_live_streams");
    const { data: vod } = await fetchXtream(conn, "get_vod_streams");
    const { data: series } = await fetchXtream(conn, "get_series");

    return ok(res, {
      raw: {
        serverInfo: summary,
        liveStreams: live,
        vodStreams: vod,
        series
      },
      urls: {
        live: (Array.isArray(live) ? live : []).map((item) => withPlayUrl("live", conn, item)).filter(Boolean),
        movie: (Array.isArray(vod) ? vod : []).map((item) => withPlayUrl("vod", conn, item)).filter(Boolean),
        series: (Array.isArray(series) ? series : []).map((item) => withPlayUrl("series", conn, item)).filter(Boolean)
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
        if (info && info.family === "IPv4" && !info.internal) lanIps.push(info.address);
      }
    }
    console.log(`Servidor em http://localhost:${PORT}`);
    for (const ip of lanIps) {
      console.log(`Rede local: http://${ip}:${PORT}`);
    }
  });
}
