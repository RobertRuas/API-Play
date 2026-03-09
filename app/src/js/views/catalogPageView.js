// -----------------------------------------------------------------------------
// View: Catálogo
// -----------------------------------------------------------------------------
// Comportamento:
// 1) Abre com até 20 itens sem categoria (modo inicial)
// 2) Após escolher categoria, habilita paginação (20 por página)
// 3) Live/VOD abrem player; Série navega para página de detalhes
// -----------------------------------------------------------------------------
import {
  getEffectiveItemsPerPage,
  getCatalogCategories,
  getCatalogPage,
  getUserSettings,
  saveProgress,
  toggleFavorite
} from "../services/xtreamApi.js";
import { showToast } from "../ui/notifier.js";

function normalizeCategoryText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[|/\\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Template visual de card.
function cardTemplate(item, fallbackText) {
  const image = item.image
    ? `<img class="card-image" src="${item.image}" alt="${item.title}" loading="lazy" />`
    : `<div class="card-image card-image-fallback">${fallbackText}</div>`;
  const progressPct = Math.max(0, Math.min(100, Number(item.progress_percent) || 0));
  const progressHtml =
    progressPct > 0
      ? `<div class="item-progress"><div class="item-progress-bar" style="width:${progressPct}%"></div></div>`
      : "";
  const favoriteLabel = item.is_favorite ? "★" : "☆";
  const favoriteClass = item.is_favorite ? "is-favorite" : "is-not-favorite";
  return `
    <button type="button" class="card-fav-icon ${favoriteClass}" aria-label="Favoritar">${favoriteLabel}</button>
    ${image}
    <strong>${item.title}</strong>
    <span>${item.subtitle}</span>
    ${progressHtml}
  `;
}

// Cria card clicável.
function createCard(item, onOpen, onToggleFavorite, fallbackText) {
  const card = document.createElement("article");
  card.className = "card";
  card.innerHTML = cardTemplate(item, fallbackText);
  const favBtn = card.querySelector(".card-fav-icon");
  card.addEventListener("click", onOpen);
  favBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    onToggleFavorite();
  });
  return card;
}

// Texto amigável para tipo de catálogo.
function labelForType(type) {
  if (type === "live") return "TV ao vivo";
  if (type === "vod") return "Filmes";
  if (type === "series") return "Series";
  return "Catalogo";
}

// Render principal do catálogo.
export async function renderCatalogPageView({ container, status, playerModal, type }) {
  container.innerHTML = `
    <div class="view-head">
      <h2>Catalogo - ${labelForType(type)}</h2>
      <button id="open-category-modal" class="category-trigger" type="button">Selecionar categoria</button>
    </div>
    <div class="category-current">
      <span id="selected-category-label">Categoria: Todas</span>
    </div>
    <p id="category-hint" class="category-hint">Para ver mais conteudos, selecione uma categoria.</p>
    <div id="catalog-grid" class="grid-list"></div>
    <div class="pager">
      <button id="prev-page" class="pager-btn prev-btn" type="button">Anterior</button>
      <span id="page-info">Pagina 1</span>
      <button id="next-page" class="pager-btn next-btn" type="button">Proxima</button>
    </div>
    <div id="category-modal" class="modal" hidden>
      <div class="modal-content category-modal-content">
        <div class="modal-head">
          <h3>Categorias</h3>
          <button id="close-category-modal" type="button">Fechar</button>
        </div>
        <div id="category-list" class="category-modal-list"></div>
      </div>
    </div>
  `;

  const categoryLabelEl = container.querySelector("#selected-category-label");
  const categoryHintEl = container.querySelector("#category-hint");
  const gridEl = container.querySelector("#catalog-grid");
  const prevBtn = container.querySelector("#prev-page");
  const nextBtn = container.querySelector("#next-page");
  const pageInfoEl = container.querySelector("#page-info");
  const pagerEl = container.querySelector(".pager");
  const openCategoryBtn = container.querySelector("#open-category-modal");
  const categoryModalEl = container.querySelector("#category-modal");
  const closeCategoryModalBtn = container.querySelector("#close-category-modal");
  const categoryListEl = container.querySelector("#category-list");

  let page = 1;
  let totalPages = 1;
  let categoryId = "";
  let categories = [];
  let loadingPage = false;
  let hiddenCategories = { live: [], vod: [], series: [] };
  let itemsPerPage = 20;
  let settings = null;

  // Retorna nome amigável da categoria atual.
  function selectedCategoryName() {
    if (!categoryId) return "Todas";
    const found = categories.find((c) => String(c.category_id) === String(categoryId));
    return found?.category_name || "Todas";
  }

  // Atualiza label no topo da tela.
  function syncSelectedLabel() {
    categoryLabelEl.textContent = `Categoria: ${selectedCategoryName()}`;
  }

  // Exibe paginação somente quando uma subcategoria estiver selecionada.
  function syncPagerVisibility() {
    pagerEl.hidden = !categoryId;
    categoryHintEl.hidden = Boolean(categoryId);
  }

  function resolveDefaultCategoryId() {
    const pref = settings?.catalog?.defaultCategory?.[type];
    const preferredId = String(pref?.id || "").trim();
    const preferredName = normalizeCategoryText(pref?.name || "");
    if (preferredId) {
      const byId = categories.find((cat) => String(cat.category_id) === preferredId);
      if (byId) return String(byId.category_id);
    }
    if (preferredName && preferredName !== "todas") {
      const byName = categories.find(
        (cat) => normalizeCategoryText(cat.category_name) === preferredName
      );
      if (byName) return String(byName.category_id);
    }
    return "";
  }

  // Fecha modal de categorias.
  function closeCategoryModal() {
    categoryModalEl.hidden = true;
  }

  // Abre modal de categorias.
  function openCategoryModal() {
    categoryModalEl.hidden = false;
  }

  // Carrega lista de categorias no modal.
  async function loadCategories() {
    categories = await getCatalogCategories(type);
    const hidden = new Set((hiddenCategories[type] || []).map(String));
    if (hidden.size > 0) {
      categories = categories.filter((cat) => !hidden.has(String(cat.category_id)));
    }
    categoryListEl.innerHTML = "";

    const allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.className = "category-option";
    allBtn.textContent = "Todas";
    allBtn.addEventListener("click", () => {
      categoryId = "";
      page = 1;
      syncSelectedLabel();
      syncPagerVisibility();
      closeCategoryModal();
      loadPage();
    });
    categoryListEl.appendChild(allBtn);

    for (const cat of categories) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "category-option";
      btn.textContent = cat.category_name;
      btn.addEventListener("click", () => {
        categoryId = cat.category_id;
        page = 1;
        syncSelectedLabel();
        syncPagerVisibility();
        closeCategoryModal();
        loadPage();
      });
      categoryListEl.appendChild(btn);
    }
  }

  // Carrega uma página de conteúdo conforme filtros selecionados.
  async function loadPage() {
    if (loadingPage) return;
    loadingPage = true;
    try {
      status.show("Carregando catalogo...");
      gridEl.innerHTML = "";
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      const initialMode = !categoryId;
      const effectivePage = initialMode ? 1 : page;
      const effectiveLimit = itemsPerPage;
      const result = await getCatalogPage({ type, categoryId, page: effectivePage, limit: effectiveLimit });
      totalPages = initialMode ? 1 : Number(result.meta?.totalPages || 1);
      pageInfoEl.textContent = `Pagina ${page} de ${totalPages}`;
      prevBtn.disabled = initialMode || page <= 1;
      nextBtn.disabled = initialMode || page >= totalPages;

      for (const item of result.data) {
        const model =
          type === "live"
            ? {
                title: item.name || `Canal ${item.stream_id}`,
                subtitle: `ID ${item.stream_id}`,
                image: item.stream_icon || "",
                is_favorite: item.is_favorite,
                progress_percent: item.progress_percent,
                position_seconds: item.position_seconds || 0
              }
            : type === "vod"
              ? {
                  title: item.name || `Filme ${item.stream_id}`,
                  subtitle: `ID ${item.stream_id}`,
                  image: item.stream_icon || item.cover || "",
                  is_favorite: item.is_favorite,
                  progress_percent: item.progress_percent,
                  position_seconds: item.position_seconds || 0
                }
              : {
                  title: item.name || `Serie ${item.series_id}`,
                  subtitle: `ID ${item.series_id}`,
                  image: item.cover || item.stream_icon || "",
                  is_favorite: item.is_favorite,
                  progress_percent: item.progress_percent,
                  position_seconds: item.position_seconds || 0
                };

        const onOpen =
          type === "live"
            ? () =>
                playerModal.open({
                  title: model.title,
                  url: item.play_url,
                  streamType: "live",
                  fullscreen: true,
                  mediaMeta: {
                    type: "live",
                    stream_id: item.stream_id,
                    title: model.title,
                    image: model.image,
                    play_url: item.play_url,
                    resume_seconds: model.position_seconds || 0,
                    onProgress: saveProgress
                  }
                })
            : type === "vod"
              ? () =>
                  playerModal.open({
                    title: model.title,
                    url: item.play_url,
                    streamType: "vod",
                    fullscreen: true,
                    mediaMeta: {
                      type: "vod",
                      stream_id: item.stream_id,
                      title: model.title,
                      image: model.image,
                      play_url: item.play_url,
                      resume_seconds: model.position_seconds || 0,
                      onProgress: saveProgress
                    }
                  })
              : () => {
                  window.location.hash = `#/series/${item.series_id}`;
                };

        const favoriteType = type === "series" ? "series" : type;
        const favoriteId = type === "series" ? item.series_id : item.stream_id;
        const mountCard = () => {
          const onToggleFavorite = async () => {
            const result = await toggleFavorite({
              type: favoriteType,
              stream_id: favoriteId,
              title: model.title,
              image: model.image,
              play_url: item.play_url || ""
            });
            model.is_favorite = Boolean(result.favorite);
            showToast(
              result.favorite ? "Adicionado aos favoritos." : "Removido dos favoritos.",
              result.favorite ? "success" : "info"
            );
            const updatedCard = mountCard();
            card.replaceWith(updatedCard);
          };
          const card = createCard(model, onOpen, onToggleFavorite, "Sem imagem");
          return card;
        };

        gridEl.appendChild(mountCard());
      }
      status.hide();
    } catch (error) {
      status.show(error.message || "Erro ao carregar catalogo.");
    } finally {
      loadingPage = false;
    }
  }

  prevBtn.addEventListener("click", () => {
    if (page > 1) {
      page -= 1;
      loadPage();
    }
  });

  nextBtn.addEventListener("click", () => {
    if (page < totalPages) {
      page += 1;
      loadPage();
    }
  });

  openCategoryBtn.addEventListener("click", openCategoryModal);
  closeCategoryModalBtn.addEventListener("click", closeCategoryModal);
  categoryModalEl.addEventListener("click", (event) => {
    if (event.target === categoryModalEl) closeCategoryModal();
  });

  settings = await getUserSettings();
  itemsPerPage = await getEffectiveItemsPerPage();
  hiddenCategories = settings?.hiddenCategories || hiddenCategories;
  await loadCategories();
  categoryId = resolveDefaultCategoryId();
  page = 1;
  syncSelectedLabel();
  syncPagerVisibility();
  await loadPage();
}
