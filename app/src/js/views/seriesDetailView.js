// -----------------------------------------------------------------------------
// View: Detalhes da Série
// -----------------------------------------------------------------------------
// Exibe:
// - informações da série
// - temporadas e episódios
// - abertura do player global ao clicar no episódio
// -----------------------------------------------------------------------------
import { getSeriesDetail, saveProgress, toggleFavorite } from "../services/xtreamApi.js";
import { showToast } from "../ui/notifier.js";

// Render de campo simples de metadados.
function infoField(label, value) {
  return `<div class="info-item"><strong>${label}:</strong> <span>${value || "-"}</span></div>`;
}

// Render principal da página de detalhes da série.
export async function renderSeriesDetailView({ container, status, playerModal, seriesId }) {
  container.innerHTML = `
    <div class="view-head">
      <div class="series-title-line">
        <button id="favorite-series-btn" class="series-fav-icon is-not-favorite" type="button">☆</button>
        <h2 id="series-page-title">Detalhes da Serie</h2>
      </div>
      <a class="series-back-btn" href="#/series" data-link>Voltar para o catalogo de series</a>
    </div>
    <div id="series-detail"></div>
  `;

  const detailEl = container.querySelector("#series-detail");
  const pageTitleEl = container.querySelector("#series-page-title");
  try {
    status.show("Carregando detalhes da serie...");
    const data = await getSeriesDetail(seriesId);
    const info = data.info || {};
    const seasons = Array.isArray(data.seasons) ? data.seasons : [];
    pageTitleEl.textContent = info.name || `Serie ${data.series_id}`;
    const favoriteSeriesBtn = container.querySelector("#favorite-series-btn");
    favoriteSeriesBtn.textContent = data.is_favorite ? "★" : "☆";
    favoriteSeriesBtn.classList.toggle("is-favorite", Boolean(data.is_favorite));
    favoriteSeriesBtn.classList.toggle("is-not-favorite", !data.is_favorite);
    favoriteSeriesBtn.addEventListener("click", async () => {
      const result = await toggleFavorite({
        type: "series",
        stream_id: data.series_id,
        title: info.name || `Serie ${data.series_id}`,
        image: info.cover || "",
        play_url: ""
      });
      favoriteSeriesBtn.textContent = result.favorite ? "★" : "☆";
      favoriteSeriesBtn.classList.toggle("is-favorite", Boolean(result.favorite));
      favoriteSeriesBtn.classList.toggle("is-not-favorite", !result.favorite);
      showToast(
        result.favorite ? "Serie adicionada aos favoritos." : "Serie removida dos favoritos.",
        result.favorite ? "success" : "info"
      );
    });

    detailEl.innerHTML = `
      <section class="series-header">
        <div class="series-poster-wrap">
          ${
            info.cover
              ? `<img class="series-poster" src="${info.cover}" alt="${info.name || "Serie"}" />`
              : `<div class="series-poster series-poster-fallback">Sem capa</div>`
          }
        </div>
        <div>
          <h3>${info.name || `Serie ${data.series_id}`}</h3>
          <p>${info.plot || "Sem sinopse."}</p>
          <div class="info-grid">
            ${infoField("Genero", info.genre)}
            ${infoField("Elenco", info.cast)}
            ${infoField("Direcao", info.director)}
            ${infoField("Classificacao", info.rating)}
          </div>
        </div>
      </section>
      <section>
        <h3>Temporadas e Episodios</h3>
        <div id="seasons-list" class="episodes-wrap"></div>
      </section>
    `;

    const seasonsEl = detailEl.querySelector("#seasons-list");
    if (seasons.length === 0) {
      seasonsEl.innerHTML = "<p>Sem episodios disponiveis.</p>";
    } else {
      for (const season of seasons) {
        const details = document.createElement("details");
        details.className = "season-block";

        const summary = document.createElement("summary");
        summary.textContent = `Temporada ${season.season}`;
        details.appendChild(summary);

        const episodes = document.createElement("div");
        episodes.className = "episodes-list";

        for (const episode of season.episodes || []) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "episode-btn";
          const episodePct = Math.max(0, Math.min(100, Number(episode.progress_percent) || 0));
          btn.innerHTML = `
            <span>Episodio ${episode.episode_num || episode.id || ""} - ${episode.title || "Sem titulo"}</span>
            ${
              episodePct > 0
                ? `<div class="item-progress"><div class="item-progress-bar" style="width:${episodePct}%"></div></div>`
                : ""
            }
          `;
          btn.addEventListener("click", () =>
            playerModal.open({
              title: episode.title || info.name || "Serie",
              url: episode.play_url,
              streamType: "series",
              fullscreen: true,
              mediaMeta: {
                type: "series",
                stream_id: episode.id || episode.stream_id || episode.episode_id,
                title: episode.title || info.name || "Serie",
                image: info.cover || "",
                play_url: episode.play_url,
                resume_seconds: episode.position_seconds || 0,
                onProgress: saveProgress
              }
            })
          );
          episodes.appendChild(btn);
        }

        details.appendChild(episodes);
        seasonsEl.appendChild(details);
      }
    }
    status.hide();
  } catch (error) {
    status.show(error.message || "Erro ao carregar detalhes da serie.");
  }
}
