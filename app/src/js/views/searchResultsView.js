// -----------------------------------------------------------------------------
// View: Busca Global
// -----------------------------------------------------------------------------
// Exibe resultados em modal, separados por:
// - TV ao vivo
// - Filmes
// - Series
// -----------------------------------------------------------------------------
import {
  getCatalogCategories,
  getCatalogPage,
  getEffectiveItemsPerPage,
  saveProgress,
  toggleFavorite
} from "../services/xtreamApi.js";
import { showToast } from "../ui/notifier.js";

function renderRow(item, type) {
  const image = item.image
    ? `<img src="${item.image}" alt="${item.title}" loading="lazy" />`
    : `<div class="search-row-fallback">Sem imagem</div>`;
  const favIcon = item.is_favorite ? "★" : "☆";
  const favClass = item.is_favorite ? "is-favorite" : "is-not-favorite";
  return `
    <article class="search-row" data-type="${type}" data-id="${item.id}">
      <button class="search-fav-btn ${favClass}" type="button" data-type="${type}" data-id="${item.id}" aria-label="Favoritar">${favIcon}</button>
      <div class="search-row-thumb">${image}</div>
      <div class="search-row-body">
        <strong>${item.title}</strong>
        <span>${item.category_name || "Sem categoria"}</span>
      </div>
    </article>
  `;
}

function normalizeRows(type, list, categoriesMap) {
  const resolveCategory = (categoryId) => categoriesMap.get(String(categoryId || "")) || "Sem categoria";
  if (type === "live") {
    return list.map((item) => ({
      id: item.stream_id,
      title: item.name || `Canal ${item.stream_id}`,
      category_name: resolveCategory(item.category_id),
      image: item.stream_icon || "",
      play_url: item.play_url || "",
      streamType: "live",
      is_favorite: Boolean(item.is_favorite),
      position_seconds: item.position_seconds || 0
    }));
  }
  if (type === "vod") {
    return list.map((item) => ({
      id: item.stream_id,
      title: item.name || `Filme ${item.stream_id}`,
      category_name: resolveCategory(item.category_id),
      image: item.stream_icon || item.cover || "",
      play_url: item.play_url || "",
      streamType: "vod",
      position_seconds: item.position_seconds || 0,
      is_favorite: Boolean(item.is_favorite)
    }));
  }
  return list.map((item) => ({
    id: item.series_id,
    title: item.name || `Serie ${item.series_id}`,
    category_name: resolveCategory(item.category_id),
    image: item.cover || item.stream_icon || "",
    streamType: "series",
    is_favorite: Boolean(item.is_favorite)
  }));
}

function sectionTemplate(title, type, section) {
  const rows = section.rows || [];
  if (!rows.length) {
    return `
      <section class="search-section">
        <h3>${title}</h3>
        <p class="search-empty">Nenhum resultado.</p>
      </section>
    `;
  }
  const hasMore = section.page < section.totalPages;
  return `
    <section class="search-section">
      <h3>${title}</h3>
      <div class="search-list" data-section="${type}">
        ${rows.map((row) => renderRow(row, type)).join("")}
      </div>
      <div class="search-section-footer">
        ${
          hasMore
            ? `<button class="search-more-btn" type="button" data-type="${type}">Ver mais</button>`
            : `<span class="search-end-label">Fim dos resultados</span>`
        }
      </div>
    </section>
  `;
}

export async function renderSearchResultsView({ container, status, playerModal, term }) {
  container.innerHTML = `
    <div id="search-modal" class="modal search-modal" hidden>
      <div class="modal-content search-modal-content">
        <div class="modal-head">
          <div class="search-head-box">
            <h3>Resultados da busca</h3>
            <form id="search-refine-form" class="search-refine-form">
              <input id="search-refine-input" type="search" value="${term}" placeholder="Buscar..." />
              <button type="submit">Buscar</button>
            </form>
          </div>
          <button id="close-search-modal" type="button">Fechar</button>
        </div>
        <div id="search-inline-loading" class="search-inline-loading" hidden>
          <span class="loader-dot" aria-hidden="true"></span>
          <span>Buscando...</span>
        </div>
        <div id="search-results"></div>
      </div>
    </div>
  `;

  const modalEl = container.querySelector("#search-modal");
  const closeBtn = container.querySelector("#close-search-modal");
  const resultsEl = container.querySelector("#search-results");
  const refineFormEl = container.querySelector("#search-refine-form");
  const refineInputEl = container.querySelector("#search-refine-input");
  const inlineLoadingEl = container.querySelector("#search-inline-loading");
  const inlineLoadingTextEl = inlineLoadingEl?.querySelector("span:last-child");
  modalEl.hidden = false;
  let activeTerm = String(term || "").trim();
  let searchDebounceId = null;
  let searchRequestSeq = 0;
  const state = {
    limit: 20,
    categories: {
      live: new Map(),
      vod: new Map(),
      series: new Map()
    },
    sections: {
      live: { page: 0, totalPages: 1, rows: [] },
      vod: { page: 0, totalPages: 1, rows: [] },
      series: { page: 0, totalPages: 1, rows: [] }
    }
  };

  function findRow(type, id) {
    return (state.sections[type]?.rows || []).find((row) => String(row.id) === String(id));
  }

  function setInlineLoading(visible, message = "Buscando...") {
    if (!inlineLoadingEl) return;
    inlineLoadingEl.hidden = !visible;
    if (inlineLoadingTextEl) inlineLoadingTextEl.textContent = message;
  }

  function renderAllSections() {
    if (!activeTerm) {
      resultsEl.innerHTML = `<p class="search-empty">Digite para pesquisar.</p>`;
      return;
    }
    resultsEl.innerHTML = `
      ${sectionTemplate("TV ao vivo", "live", state.sections.live)}
      ${sectionTemplate("Filmes", "vod", state.sections.vod)}
      ${sectionTemplate("Series", "series", state.sections.series)}
    `;
  }

  async function loadCategoriesMap(type) {
    const list = await getCatalogCategories(type);
    const map = new Map();
    for (const item of list || []) {
      map.set(String(item.category_id || ""), item.category_name || "Sem categoria");
    }
    state.categories[type] = map;
  }

  async function fetchSection(type, nextPage, queryTerm) {
    const result = await getCatalogPage({
      type,
      q: queryTerm,
      page: nextPage,
      limit: state.limit
    });
    return {
      page: Number(result.meta?.page || nextPage),
      totalPages: Number(result.meta?.totalPages || 1),
      rows: normalizeRows(type, result.data || [], state.categories[type])
    };
  }

  async function loadSection(type, nextPage, { append }) {
    const nextData = await fetchSection(type, nextPage, activeTerm);
    const current = state.sections[type];
    state.sections[type] = {
      page: nextData.page,
      totalPages: nextData.totalPages,
      rows: append ? [...current.rows, ...nextData.rows] : nextData.rows
    };
  }

  async function runSearch(nextTerm, { showLoader = true } = {}) {
    const normalized = String(nextTerm || "").trim();
    activeTerm = normalized;
    const requestId = ++searchRequestSeq;
    if (showLoader) setInlineLoading(true, "Buscando...");

    try {
      if (!activeTerm) {
        state.sections.live = { page: 0, totalPages: 1, rows: [] };
        state.sections.vod = { page: 0, totalPages: 1, rows: [] };
        state.sections.series = { page: 0, totalPages: 1, rows: [] };
        renderAllSections();
        window.history.replaceState(null, "", "#/search");
        return;
      }

      const [liveData, vodData, seriesData] = await Promise.all([
        fetchSection("live", 1, activeTerm),
        fetchSection("vod", 1, activeTerm),
        fetchSection("series", 1, activeTerm)
      ]);
      if (requestId !== searchRequestSeq) return;
      state.sections.live = liveData;
      state.sections.vod = vodData;
      state.sections.series = seriesData;
      renderAllSections();
      window.history.replaceState(null, "", `#/search?q=${encodeURIComponent(activeTerm)}`);
    } finally {
      if (requestId === searchRequestSeq) setInlineLoading(false);
    }
  }

  try {
    status.show("Buscando resultados globais...");
    state.limit = await getEffectiveItemsPerPage();
    await Promise.all([loadCategoriesMap("live"), loadCategoriesMap("vod"), loadCategoriesMap("series")]);
    await runSearch(activeTerm, { showLoader: true });

    resultsEl.addEventListener("click", (event) => {
      const favBtn = event.target.closest(".search-fav-btn");
      if (favBtn) {
        const type = favBtn.dataset.type;
        const id = String(favBtn.dataset.id || "");
        const row = findRow(type, id);
        if (!row) return;
        const favoriteType = type === "series" ? "series" : type;
        toggleFavorite({
          type: favoriteType,
          stream_id: row.id,
          title: row.title,
          image: row.image || "",
          play_url: row.play_url || ""
        })
          .then((resp) => {
            row.is_favorite = Boolean(resp.favorite);
            showToast(resp.favorite ? "Adicionado aos favoritos." : "Removido dos favoritos.", "info");
            renderAllSections();
          })
          .catch(() => {
            showToast("Falha ao atualizar favorito.", "error");
          });
        return;
      }

      const moreBtn = event.target.closest(".search-more-btn");
      if (moreBtn) {
        const type = moreBtn.dataset.type;
        const section = state.sections[type];
        if (!section || section.page >= section.totalPages) return;
        setInlineLoading(true, "Carregando mais...");
        loadSection(type, section.page + 1, { append: true })
          .then(renderAllSections)
          .catch(() => showToast("Falha ao carregar mais resultados.", "error"))
          .finally(() => setInlineLoading(false));
        return;
      }

      const rowBtn = event.target.closest(".search-row");
      if (!rowBtn) return;
      const type = rowBtn.dataset.type;
      const id = String(rowBtn.dataset.id || "");
      const row = findRow(type, id);
      if (!row) return;
      if (type === "series") {
        window.location.hash = `#/series/${row.id}`;
        return;
      }
      playerModal.open({
        title: row.title,
        url: row.play_url,
        streamType: row.streamType,
        fullscreen: true,
        mediaMeta: {
          type: row.streamType,
          stream_id: row.id,
          title: row.title,
          image: row.image,
          play_url: row.play_url,
          resume_seconds: row.position_seconds || 0,
          onProgress: saveProgress
        }
      });
    });
    status.hide();
  } catch (error) {
    status.show(error.message || "Falha na busca global.");
  }

  closeBtn.addEventListener("click", () => {
    if (searchDebounceId) clearTimeout(searchDebounceId);
    window.location.hash = "#/favorites";
  });
  refineFormEl.addEventListener("submit", (event) => {
    event.preventDefault();
    const nextTerm = String(refineInputEl.value || "").trim();
    runSearch(nextTerm, { showLoader: true }).catch(() => {
      showToast("Falha ao atualizar busca.", "error");
    });
  });
  refineInputEl.addEventListener("input", () => {
    if (searchDebounceId) clearTimeout(searchDebounceId);
    searchDebounceId = setTimeout(() => {
      const nextTerm = String(refineInputEl.value || "").trim();
      runSearch(nextTerm, { showLoader: true }).catch(() => {
        showToast("Falha ao atualizar busca.", "error");
      });
    }, 350);
  });
  modalEl.addEventListener("click", (event) => {
    if (event.target === modalEl) {
      if (searchDebounceId) clearTimeout(searchDebounceId);
      window.location.hash = "#/favorites";
    }
  });
}
