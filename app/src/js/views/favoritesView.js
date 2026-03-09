// -----------------------------------------------------------------------------
// View: Favoritos
// -----------------------------------------------------------------------------
// Exibe favoritos reais por tipo e permite abrir no player.
// -----------------------------------------------------------------------------
import { listFavorites, saveProgress, toggleFavorite } from "../services/xtreamApi.js";
import { showToast } from "../ui/notifier.js";

function progressTemplate(percent) {
  const pct = Math.max(0, Math.min(100, Number(percent) || 0));
  if (pct <= 0) return "";
  return `<div class="item-progress"><div class="item-progress-bar" style="width:${pct}%"></div></div>`;
}

function cardTemplate(item) {
  const image = item.image
    ? `<img class="card-image" src="${item.image}" alt="${item.title || "Item"}" loading="lazy" />`
    : `<div class="card-image card-image-fallback">Sem imagem</div>`;
  return `
    <button type="button" class="card-fav-icon is-favorite" aria-label="Favoritar">★</button>
    ${image}
    <strong>${item.title || "Sem titulo"}</strong>
    ${progressTemplate(item.progress_percent)}
  `;
}

function sectionTemplate(title, gridId, routePath) {
  return `
    <section>
      <h2>${title}</h2>
      <div id="${gridId}" class="grid-list favorites-grid"></div>
      <p id="${gridId}-empty" class="section-placeholder" hidden>Sem itens por enquanto.</p>
      <div class="section-actions">
        <a class="link-inline" href="#/${routePath}" data-link>Ver mais</a>
      </div>
    </section>
  `;
}

function openFavoriteWithPlayer(playerModal, item, streamType) {
  if (!item.play_url) return;
  playerModal.open({
    title: item.title || "Item",
    url: item.play_url,
    streamType,
    fullscreen: true,
    mediaMeta: {
      type: streamType,
      stream_id: item.stream_id,
      title: item.title || "Item",
      image: item.image || "",
      play_url: item.play_url,
      resume_seconds: item.position_seconds || 0,
      onProgress: saveProgress
    }
  });
}

function renderCards(gridEl, emptyEl, rows, onOpen, onToggleFavorite) {
  gridEl.innerHTML = "";
  if (!rows.length) {
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;
  for (const item of rows) {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = cardTemplate(item);
    const favBtn = card.querySelector(".card-fav-icon");
    favBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      onToggleFavorite(item);
    });
    card.addEventListener("click", () => onOpen(item));
    gridEl.appendChild(card);
  }
}

export async function renderFavoritesView({ container, status, playerModal }) {
  container.innerHTML = `
    <div class="view-head"><h2>Favoritos</h2></div>
    ${sectionTemplate("TV ao vivo", "live-list", "live")}
    ${sectionTemplate("Filmes", "movies-list", "movies")}
    ${sectionTemplate("Series", "series-list", "series")}
  `;

  const liveGrid = container.querySelector("#live-list");
  const moviesGrid = container.querySelector("#movies-list");
  const seriesGrid = container.querySelector("#series-list");
  const liveEmpty = container.querySelector("#live-list-empty");
  const moviesEmpty = container.querySelector("#movies-list-empty");
  const seriesEmpty = container.querySelector("#series-list-empty");

  try {
    status.show("Carregando favoritos...");
    const [liveRows, vodRows, seriesRows] = await Promise.all([
      listFavorites("live"),
      listFavorites("vod"),
      listFavorites("series")
    ]);

    renderCards(
      liveGrid,
      liveEmpty,
      liveRows,
      (item) => openFavoriteWithPlayer(playerModal, item, "live"),
      async (item) => {
        await toggleFavorite({ type: "live", stream_id: item.stream_id, title: item.title });
        showToast("Removido dos favoritos.", "info");
        await renderFavoritesView({ container, status, playerModal });
      }
    );
    renderCards(
      moviesGrid,
      moviesEmpty,
      vodRows,
      (item) => openFavoriteWithPlayer(playerModal, item, "vod"),
      async (item) => {
        await toggleFavorite({ type: "vod", stream_id: item.stream_id, title: item.title });
        showToast("Removido dos favoritos.", "info");
        await renderFavoritesView({ container, status, playerModal });
      }
    );

    seriesGrid.innerHTML = "";
    if (!seriesRows.length) {
      seriesEmpty.hidden = false;
    } else {
      seriesEmpty.hidden = true;
      for (const item of seriesRows) {
        const card = document.createElement("article");
        card.className = "card";
        card.innerHTML = cardTemplate(item);
        const favBtn = card.querySelector(".card-fav-icon");
        favBtn.addEventListener("click", async (event) => {
          event.stopPropagation();
          await toggleFavorite({ type: "series", stream_id: item.stream_id, title: item.title });
          showToast("Removido dos favoritos.", "info");
          await renderFavoritesView({ container, status, playerModal });
        });
        card.addEventListener("click", () => {
          window.location.hash = `#/series/${item.stream_id}`;
        });
        seriesGrid.appendChild(card);
      }
    }

    status.hide();
  } catch (error) {
    status.show(error.message || "Falha ao carregar favoritos.");
  }
}
