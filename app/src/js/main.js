import { createRouter } from "./core/router.js";
import { playerModal } from "./ui/playerModal.js";
import { withPageLoader } from "./ui/pageLoader.js";
import {
  ensureSession,
  getSession,
  getUserSettings,
  logoutApp,
  tryAutoLogin
} from "./services/xtreamApi.js";
import { renderFavoritesView } from "./views/favoritesView.js";
import { renderCatalogPageView } from "./views/catalogPageView.js";
import { renderSeriesDetailView } from "./views/seriesDetailView.js";
import { renderSettingsView } from "./views/settingsView.js";
import { renderLoginView } from "./views/loginView.js";
import { renderSearchResultsView } from "./views/searchResultsView.js";

const appEl = document.getElementById("app");
const statusEl = document.getElementById("global-status");
const globalSearchFormEl = document.getElementById("global-search-form");
const globalSearchInputEl = document.getElementById("global-search-input");
const menuToggleEl = document.getElementById("menu-toggle");
const sidebarOverlayEl = document.getElementById("sidebar-overlay");

const status = {
  show(message) {
    statusEl.textContent = message;
    statusEl.hidden = false;
  },
  hide() {
    statusEl.textContent = "";
    statusEl.hidden = true;
  }
};

function setLayoutForRoute(path) {
  document.body.classList.toggle("is-login-route", path === "/login");
  if (path === "/login") closeMobileMenu();
}

function closeMobileMenu() {
  document.body.classList.remove("menu-open");
  if (sidebarOverlayEl) sidebarOverlayEl.hidden = true;
}

function openMobileMenu() {
  document.body.classList.add("menu-open");
  if (sidebarOverlayEl) sidebarOverlayEl.hidden = false;
}

function toggleMobileMenu() {
  if (document.body.classList.contains("menu-open")) {
    closeMobileMenu();
    return;
  }
  openMobileMenu();
}

function setActiveNav(path) {
  const links = document.querySelectorAll(".side-nav a[data-link], .sidebar-bottom a[data-link]");
  for (const link of links) {
    const href = (link.getAttribute("href") || "").replace(/^#/, "");
    const isActive =
      (path === "/favorites" && href === "/favorites") ||
      (path === "/live" && href === "/live") ||
      (path === "/movies" && href === "/movies") ||
      (path.startsWith("/series") && href === "/series") ||
      (path === "/settings" && href === "/settings");
    link.classList.toggle("active", isActive);
  }
}

function renderNotFound() {
  appEl.innerHTML = `
    <section>
      <h2>Pagina nao encontrada</h2>
      <p>Use a navegacao para voltar ao catalogo.</p>
      <a href="#/favorites" data-link>Ir para Favoritos</a>
    </section>
  `;
  status.hide();
}

async function ensurePrivateAccess(path) {
  if (path === "/login") return true;
  const session = await ensureSession();
  if (session) return true;
  window.location.hash = "#/login";
  return false;
}

const router = createRouter(
  [
    {
      path: "/",
      handler: () => {
        window.location.hash = "#/favorites";
      }
    },
    {
      path: "/login",
      handler: async ({ path }) => {
        setLayoutForRoute(path);
        if (await ensureSession()) {
          window.location.hash = "#/favorites";
          return;
        }
        await withPageLoader(() =>
          renderLoginView({
            container: appEl,
            status,
            onLoginSuccess: async () => {
              const settings = await getUserSettings();
              playerModal.setShowBufferOverlay(settings?.player?.showBufferOverlay);
              window.location.hash = "#/favorites";
              router.resolve();
            }
          })
        );
      }
    },
    {
      path: "/favorites",
      handler: async ({ path }) => {
        if (!(await ensurePrivateAccess(path))) return;
        setLayoutForRoute(path);
        setActiveNav(path);
        await withPageLoader(() => renderFavoritesView({ container: appEl, status, playerModal }));
      }
    },
    {
      path: "/live",
      handler: async ({ path }) => {
        if (!(await ensurePrivateAccess(path))) return;
        setLayoutForRoute(path);
        setActiveNav(path);
        await withPageLoader(() =>
          renderCatalogPageView({ container: appEl, status, playerModal, type: "live" })
        );
      }
    },
    {
      path: "/movies",
      handler: async ({ path }) => {
        if (!(await ensurePrivateAccess(path))) return;
        setLayoutForRoute(path);
        setActiveNav(path);
        await withPageLoader(() =>
          renderCatalogPageView({ container: appEl, status, playerModal, type: "vod" })
        );
      }
    },
    {
      path: "/series",
      handler: async ({ path }) => {
        if (!(await ensurePrivateAccess(path))) return;
        setLayoutForRoute(path);
        setActiveNav(path);
        await withPageLoader(() =>
          renderCatalogPageView({ container: appEl, status, playerModal, type: "series" })
        );
      }
    },
    {
      path: "/series/:id",
      handler: async ({ path, params }) => {
        if (!(await ensurePrivateAccess(path))) return;
        setLayoutForRoute(path);
        setActiveNav(path);
        await withPageLoader(() =>
          renderSeriesDetailView({ container: appEl, status, playerModal, seriesId: params.id })
        );
      }
    },
    {
      path: "/search",
      handler: async ({ path, query }) => {
        if (!(await ensurePrivateAccess(path))) return;
        setLayoutForRoute(path);
        setActiveNav("");
        const term = String(query.get("q") || "").trim();
        if (!term) {
          window.location.hash = "#/favorites";
          return;
        }
        await withPageLoader(() =>
          renderSearchResultsView({ container: appEl, status, playerModal, term })
        );
      }
    },
    {
      path: "/settings",
      handler: async ({ path }) => {
        if (!(await ensurePrivateAccess(path))) return;
        setLayoutForRoute(path);
        setActiveNav(path);
        await withPageLoader(() => renderSettingsView({ container: appEl, status, playerModal }));
      }
    }
  ],
  renderNotFound
);

document.addEventListener("click", async (event) => {
  const logoutBtn = event.target.closest("a[data-action='logout']");
  if (logoutBtn) {
    event.preventDefault();
    closeMobileMenu();
    await logoutApp();
    window.location.hash = "#/login";
    router.resolve();
    return;
  }

  const link = event.target.closest("a[data-link]");
  if (!link) return;
  event.preventDefault();
  const href = link.getAttribute("href");
  if (!href) return;
  closeMobileMenu();
  window.location.hash = href.replace(/^#/, "");
  router.resolve();
});

if (menuToggleEl) {
  menuToggleEl.addEventListener("click", () => toggleMobileMenu());
}

if (sidebarOverlayEl) {
  sidebarOverlayEl.addEventListener("click", () => closeMobileMenu());
}

window.addEventListener("resize", () => {
  if (window.innerWidth > 1024) closeMobileMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMobileMenu();
});

if (globalSearchFormEl) {
  globalSearchFormEl.addEventListener("submit", (event) => {
    event.preventDefault();
    const term = String(globalSearchInputEl?.value || "").trim();
    if (!term) return;
    window.location.hash = `#/search?q=${encodeURIComponent(term)}`;
    router.resolve();
  });
}

async function bootstrap() {
  try {
    let session = await ensureSession();
    if (!session) session = await tryAutoLogin();
    if (session) {
      const settings = await getUserSettings();
      playerModal.setShowBufferOverlay(settings?.player?.showBufferOverlay);
    }
  } catch {
    await logoutApp();
  } finally {
    if (!getSession()) {
      setLayoutForRoute("/login");
      if (window.location.hash.replace(/^#/, "") !== "/login") {
        window.location.hash = "#/login";
      }
    }
    router.resolve();
  }
}

bootstrap();
