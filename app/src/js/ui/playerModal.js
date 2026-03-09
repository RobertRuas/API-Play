// -----------------------------------------------------------------------------
// Player Global da Aplicação
// -----------------------------------------------------------------------------
// Funciona em qualquer página/view.
// Recursos:
// - ABR (hls.js) quando stream HLS
// - fallback nativo quando possível
// - fullscreen por padrão
// - buffer agressivo para reduzir travamento
// - loader amigável de carregamento
// -----------------------------------------------------------------------------
const modalEl = document.getElementById("player-modal");
const titleEl = document.getElementById("modal-title");
const metaEl = document.getElementById("player-meta");
const videoEl = document.getElementById("modal-player");
const loadingEl = document.getElementById("player-loading");
const closeBtn = document.getElementById("close-modal");
const bufferChipEl = document.getElementById("player-buffer-chip");

let hls = null;
let currentUrl = "";
let currentStreamType = "vod";
let showBufferOverlay = false;
let currentMediaMeta = null;
let lastProgressSaveAt = 0;
let resumeApplied = false;

// Ajusta perfil de buffer conforme qualidade de rede do dispositivo.
function networkProfile() {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!conn) {
    return { maxBufferLength: 80, maxMaxBufferLength: 180, liveSyncDurationCount: 6 };
  }
  if (conn.saveData || (conn.effectiveType || "").includes("2g")) {
    return { maxBufferLength: 25, maxMaxBufferLength: 60, liveSyncDurationCount: 4 };
  }
  if ((conn.effectiveType || "").includes("3g")) {
    return { maxBufferLength: 45, maxMaxBufferLength: 100, liveSyncDurationCount: 5 };
  }
  return { maxBufferLength: 100, maxMaxBufferLength: 240, liveSyncDurationCount: 8 };
}

// Detecta se URL é playlist HLS (.m3u8).
function isHls(url) {
  return /\.m3u8($|\?)/i.test(url);
}

// Atualiza texto auxiliar no modal.
function setMeta(text) {
  metaEl.textContent = text || "";
}

// Exibe/oculta loader do player.
function setLoading(visible) {
  loadingEl.hidden = !visible;
}

function setBufferChip(text) {
  if (!bufferChipEl) return;
  bufferChipEl.textContent = text;
}

function syncBufferChipVisibility() {
  if (!bufferChipEl) return;
  bufferChipEl.hidden = !showBufferOverlay;
}

function pushProgress(force = false) {
  if (!currentMediaMeta || typeof currentMediaMeta.onProgress !== "function") return;
  const now = Date.now();
  if (!force && now - lastProgressSaveAt < 10000) return;
  const duration = Number(videoEl.duration);
  const position = Number(videoEl.currentTime) || 0;
  if (!Number.isFinite(duration) || duration <= 0 || position <= 0) return;
  lastProgressSaveAt = now;
  currentMediaMeta.onProgress({
    type: currentMediaMeta.type,
    stream_id: currentMediaMeta.stream_id,
    title: currentMediaMeta.title,
    image: currentMediaMeta.image,
    play_url: currentMediaMeta.play_url,
    duration_seconds: Math.floor(duration),
    position_seconds: Math.floor(position)
  });
}

// Encerra engine HLS atual para evitar vazamentos.
function destroyEngine() {
  if (hls) {
    hls.destroy();
    hls = null;
  }
}

// Tenta abrir fullscreen com compatibilidade entre navegadores.
function requestFullscreenSafe() {
  const fn =
    videoEl.requestFullscreen ||
    videoEl.webkitRequestFullscreen ||
    videoEl.webkitEnterFullscreen ||
    videoEl.msRequestFullscreen;
  if (typeof fn === "function") {
    try {
      fn.call(videoEl);
    } catch {}
  }
}

// Fecha modal e limpa estado completo do player.
function close() {
  if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
  destroyEngine();
  videoEl.pause();
  videoEl.removeAttribute("src");
  videoEl.load();
  modalEl.hidden = true;
  currentUrl = "";
  currentStreamType = "vod";
  currentMediaMeta = null;
  lastProgressSaveAt = 0;
  setBufferChip("Buffer: --");
  syncBufferChipVisibility();
  setMeta("");
  setLoading(false);
}

// Tenta preferir codecs mais eficientes (AV1/HEVC) quando disponíveis.
function pickPreferredLevel(levels) {
  const preferredRegex = /(av01|hvc1|hev1)/i;
  const preferredIndexes = [];
  for (let i = 0; i < levels.length; i += 1) {
    const level = levels[i];
    const codecs = `${level.codecs || ""} ${level.videoCodec || ""}`.trim();
    if (preferredRegex.test(codecs)) preferredIndexes.push(i);
  }
  if (preferredIndexes.length === 0) return -1;
  return preferredIndexes[Math.floor(preferredIndexes.length / 2)];
}

// Reprodução via player nativo do browser.
function attachNative(url) {
  videoEl.src = url;
  videoEl.preload = "auto";
  setMeta("Modo nativo");
  setBufferChip("Buffer: 0.0s (nativo)");
  videoEl.play().catch(() => {});
}

// Inicializa engine HLS com parâmetros de ABR e buffering.
function setupHls(url, streamType) {
  const HlsClass = window.Hls;
  if (!HlsClass || !HlsClass.isSupported()) {
    attachNative(url);
    return;
  }

  const profile = networkProfile();
  hls = new HlsClass({
    enableWorker: true,
    lowLatencyMode: streamType === "live",
    backBufferLength: 30,
    capLevelToPlayerSize: true,
    startLevel: -1,
    maxBufferLength: profile.maxBufferLength,
    maxMaxBufferLength: profile.maxMaxBufferLength,
    liveSyncDurationCount: profile.liveSyncDurationCount,
    abrEwmaFastLive: 3.0,
    abrEwmaSlowLive: 9.0,
    abrEwmaFastVoD: 3.0,
    abrEwmaSlowVoD: 9.0
  });

  hls.on(HlsClass.Events.MANIFEST_PARSED, () => {
    const levelIndex = pickPreferredLevel(hls.levels || []);
    if (levelIndex >= 0) {
      hls.nextLevel = levelIndex;
    }
    setMeta("ABR ativo");
    videoEl.play().catch(() => {});
  });

  hls.on(HlsClass.Events.LEVEL_SWITCHED, (_, data) => {
    const level = hls.levels?.[data.level];
    if (!level) return;
    const codecs = `${level.codecs || ""}`.trim();
    const height = level.height ? `${level.height}p` : "auto";
    setMeta(`ABR ativo | ${height} | ${codecs || "codec n/d"}`);
  });

  hls.on(HlsClass.Events.ERROR, (_, data) => {
    if (data?.details === "bufferStalledError") {
      if (hls.nextAutoLevel > 0) hls.nextLevel = hls.nextAutoLevel - 1;
      setMeta("Ajustando qualidade por buffering...");
    }
    if (data?.fatal) {
      if (data.type === HlsClass.ErrorTypes.NETWORK_ERROR) {
        hls.startLoad();
      } else if (data.type === HlsClass.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError();
      } else {
        destroyEngine();
        attachNative(url);
      }
    }
  });

  hls.attachMedia(videoEl);
  hls.on(HlsClass.Events.MEDIA_ATTACHED, () => {
    hls.loadSource(url);
  });
}

// API pública de abertura do player.
function open({ title, url, streamType = "vod", fullscreen = true, mediaMeta = null }) {
  titleEl.textContent = title || "Player";
  modalEl.hidden = false;
  currentUrl = url || "";
  currentStreamType = streamType || "vod";
  currentMediaMeta = mediaMeta;
  lastProgressSaveAt = 0;
  resumeApplied = false;
  syncBufferChipVisibility();
  videoEl.preload = "metadata";
  setMeta("Preparando stream...");
  setLoading(true);

  destroyEngine();

  if (isHls(url) || streamType === "live") {
    if (videoEl.canPlayType("application/vnd.apple.mpegurl")) {
      attachNative(url);
      if (fullscreen) requestFullscreenSafe();
      return;
    }
    setupHls(url, streamType);
    if (fullscreen) requestFullscreenSafe();
    return;
  }

  attachNative(url);
  if (fullscreen) requestFullscreenSafe();
}

closeBtn.addEventListener("click", close);
modalEl.addEventListener("click", (event) => {
  if (event.target === modalEl) close();
});
videoEl.addEventListener("loadstart", () => {
  setLoading(true);
  setMeta("Iniciando download do conteudo...");
});
videoEl.addEventListener("progress", () => {
  const hasBuffered = videoEl.buffered && videoEl.buffered.length > 0;
  if (!hasBuffered) return;
  const bufferedEnd = videoEl.buffered.end(videoEl.buffered.length - 1);
  const current = Number(videoEl.currentTime) || 0;
  const ahead = Math.max(0, bufferedEnd - current);
  setBufferChip(`Buffer: ${ahead.toFixed(1)}s`);
  const duration = Number(videoEl.duration);
  if (Number.isFinite(duration) && duration > 0) {
    const pct = Math.min(100, Math.max(0, Math.round((bufferedEnd / duration) * 100)));
    setMeta(`Carregando conteudo: ${pct}%`);
    return;
  }
  setMeta(`Carregando stream: ${Math.floor(bufferedEnd)}s em buffer`);
});
videoEl.addEventListener("canplay", () => setLoading(false));
videoEl.addEventListener("loadedmetadata", () => {
  if (!resumeApplied && currentStreamType !== "live") {
    const resumeAt = Number(currentMediaMeta?.resume_seconds) || 0;
    const duration = Number(videoEl.duration) || 0;
    if (resumeAt > 0) {
      const safeTarget = duration > 0 ? Math.min(Math.max(0, duration - 3), resumeAt) : resumeAt;
      try {
        videoEl.currentTime = safeTarget;
        setMeta(`Retomando de ${Math.floor(safeTarget)}s`);
      } catch {}
    }
    resumeApplied = true;
  }
  if (!showBufferOverlay) return;
  if (videoEl.duration && Number.isFinite(videoEl.duration)) {
    setBufferChip("Buffer: 0.0s (nativo)");
  }
});
videoEl.addEventListener("canplaythrough", () => {
  if (currentStreamType === "live") {
    setMeta("Stream pronto");
    return;
  }
  setMeta("Download concluido. Reproducao pronta.");
});
videoEl.addEventListener("playing", () => setLoading(false));
videoEl.addEventListener("waiting", () => {
  setLoading(true);
  setMeta("Carregando mais dados...");
});
videoEl.addEventListener("timeupdate", () => pushProgress(false));
videoEl.addEventListener("pause", () => pushProgress(true));
videoEl.addEventListener("ended", () => pushProgress(true));
videoEl.addEventListener("stalled", () => {
  setLoading(true);
  setMeta("Conexao lenta. Aguardando download...");
});
videoEl.addEventListener("error", () => {
  setLoading(false);
  setMeta("Falha ao carregar o conteudo.");
});

function setShowBufferOverlay(enabled) {
  showBufferOverlay = Boolean(enabled);
  syncBufferChipVisibility();
}

export const playerModal = { open, close, setShowBufferOverlay };
