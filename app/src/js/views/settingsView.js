import {
  getAdminAuthConfig,
  getCatalogCategories,
  getCurrentUser,
  getUserSettings,
  resetUserSettings,
  updateAdminAuthConfig,
  updateUserSettings
} from "../services/xtreamApi.js";

function normalizeArray(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((v) => String(v)).filter(Boolean)));
}

function labelForType(type) {
  if (type === "live") return "TV ao vivo";
  if (type === "vod") return "Filmes";
  return "Series";
}

function createCategoryButton(type) {
  return `<button type="button" class="manage-cats-btn" data-type="${type}">Ocultar categorias - ${labelForType(type)}</button>`;
}

function normalizeCategoryText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[|/\\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findDefaultCategoryOption(categories, pref) {
  const preferredId = String(pref?.id || "").trim();
  const preferredName = normalizeCategoryText(pref?.name || "");
  if (preferredId) {
    const byId = categories.find((cat) => String(cat.category_id) === preferredId);
    if (byId) return String(byId.category_id);
  }
  if (preferredName) {
    const byName = categories.find(
      (cat) => normalizeCategoryText(cat.category_name) === preferredName
    );
    if (byName) return String(byName.category_id);
  }
  return "";
}

export async function renderSettingsView({ container, status, playerModal }) {
  container.innerHTML = `
    <section>
      <h2>Configuracao</h2>
      <div id="settings-user" class="settings-card"></div>
      <div class="settings-card">
        <h3>Preferencias de player</h3>
        <label class="settings-row">
          <input id="toggle-buffer-overlay" type="checkbox" />
          <span>Mostrar Buff atual no player (canto superior esquerdo)</span>
        </label>
      </div>
      <div class="settings-card">
        <h3>Catalogo</h3>
        <label class="settings-row">
          <span>Quantidade de itens por pagina (5 a 50)</span>
          <input id="items-per-page" type="number" min="5" max="50" step="1" value="20" />
        </label>
        <div class="settings-default-cats">
          <h4>Categorias padrao por secao</h4>
          <label class="settings-row">
            <span>TV</span>
            <select id="default-category-live"></select>
          </label>
          <label class="settings-row">
            <span>Filmes</span>
            <select id="default-category-vod"></select>
          </label>
          <label class="settings-row">
            <span>Series</span>
            <select id="default-category-series"></select>
          </label>
        </div>
        <button id="save-catalog-btn" type="button">Salvar configuracao do catalogo</button>
      </div>
      <div class="settings-card">
        <h3>Categorias ocultas</h3>
        <p>Escolha quais categorias devem ficar ocultas no modal de selecao do catalogo.</p>
        <div class="settings-actions">
          ${createCategoryButton("live")}
          ${createCategoryButton("vod")}
          ${createCategoryButton("series")}
        </div>
      </div>
      <div class="settings-card">
        <h3>Restauracao</h3>
        <button id="reset-settings-btn" type="button" class="danger-btn">Restaurar configuracoes iniciais</button>
      </div>
      <div id="admin-auth-box" class="settings-card" hidden>
        <h3>Autenticacao Automatica (Admin)</h3>
        <label class="settings-row">
          <input id="auto-login-enabled" type="checkbox" />
          <span>Ativar autenticacao automatica sem tela de login</span>
        </label>
        <label class="settings-row">
          <span>Usuario para auto-login:</span>
          <input id="auto-login-username" type="text" placeholder="robert" />
        </label>
        <button id="save-auth-config-btn" type="button">Salvar autenticacao automatica</button>
      </div>
    </section>

    <div id="settings-category-modal" class="modal" hidden>
      <div class="modal-content category-modal-content settings-category-modal-content">
        <div class="modal-head">
          <div class="settings-category-head">
            <h3 id="settings-category-title">Categorias</h3>
            <p>Selecione as categorias que devem ficar ocultas no catalogo.</p>
          </div>
          <button id="close-settings-category-modal" type="button">Fechar</button>
        </div>
        <div class="settings-category-summary">
          <span id="settings-category-selected-count">0</span> categorias ocultas
        </div>
        <div id="settings-category-list" class="category-modal-list settings-category-list"></div>
        <div class="settings-actions">
          <button id="save-settings-category" type="button">Salvar selecao</button>
        </div>
      </div>
    </div>
  `;

  const userEl = container.querySelector("#settings-user");
  const toggleBufferEl = container.querySelector("#toggle-buffer-overlay");
  const resetBtn = container.querySelector("#reset-settings-btn");
  const modalEl = container.querySelector("#settings-category-modal");
  const modalTitleEl = container.querySelector("#settings-category-title");
  const modalListEl = container.querySelector("#settings-category-list");
  const selectedCountEl = container.querySelector("#settings-category-selected-count");
  const saveModalBtn = container.querySelector("#save-settings-category");
  const closeModalBtn = container.querySelector("#close-settings-category-modal");
  const manageButtons = container.querySelectorAll(".manage-cats-btn");
  const itemsPerPageEl = container.querySelector("#items-per-page");
  const defaultCategoryLiveEl = container.querySelector("#default-category-live");
  const defaultCategoryVodEl = container.querySelector("#default-category-vod");
  const defaultCategorySeriesEl = container.querySelector("#default-category-series");
  const saveCatalogBtn = container.querySelector("#save-catalog-btn");
  const adminAuthBox = container.querySelector("#admin-auth-box");
  const autoLoginEnabledEl = container.querySelector("#auto-login-enabled");
  const autoLoginUsernameEl = container.querySelector("#auto-login-username");
  const saveAuthConfigBtn = container.querySelector("#save-auth-config-btn");

  let settings = null;
  let activeCategoryType = "live";
  let categoryChecks = new Set();
  let currentUser = null;
  const categorySelectors = {
    live: defaultCategoryLiveEl,
    vod: defaultCategoryVodEl,
    series: defaultCategorySeriesEl
  };

  function updateSelectedCounter() {
    selectedCountEl.textContent = String(categoryChecks.size);
  }

  async function loadDefaultCategorySelectors(prefs) {
    const [liveList, vodList, seriesList] = await Promise.all([
      getCatalogCategories("live"),
      getCatalogCategories("vod"),
      getCatalogCategories("series")
    ]);
    const byType = { live: liveList || [], vod: vodList || [], series: seriesList || [] };
    const defaults = prefs?.catalog?.defaultCategory || {};

    for (const type of ["live", "vod", "series"]) {
      const selectEl = categorySelectors[type];
      const categories = byType[type];
      if (!selectEl) continue;
      selectEl.innerHTML = "";

      const allOption = document.createElement("option");
      allOption.value = "";
      allOption.textContent = "Todas";
      selectEl.appendChild(allOption);

      for (const category of categories) {
        const option = document.createElement("option");
        option.value = String(category.category_id);
        option.textContent = category.category_name || "Sem nome";
        selectEl.appendChild(option);
      }

      selectEl.value = findDefaultCategoryOption(categories, defaults[type]);
    }
  }

  async function loadBase() {
    const [session, prefs] = await Promise.all([getCurrentUser(), getUserSettings()]);
    settings = prefs;
    const user = session.user;
    currentUser = user;
    userEl.innerHTML = `
      <h3>Perfil</h3>
      <p><strong>Nome:</strong> ${user.name}</p>
      <p><strong>Email:</strong> ${user.email}</p>
      <p><strong>Usuario:</strong> ${user.username}</p>
      <p><strong>Perfil:</strong> ${user.role}</p>
    `;
    toggleBufferEl.checked = Boolean(settings?.player?.showBufferOverlay);
    playerModal.setShowBufferOverlay(toggleBufferEl.checked);
    itemsPerPageEl.value = String(settings?.catalog?.itemsPerPage || 20);
    await loadDefaultCategorySelectors(settings);

    if (user.role === "admin") {
      adminAuthBox.hidden = false;
      const authConfig = await getAdminAuthConfig();
      autoLoginEnabledEl.checked = Boolean(authConfig?.auto_login_enabled);
      autoLoginUsernameEl.value = String(authConfig?.auto_login_username || "");
    } else {
      adminAuthBox.hidden = true;
    }
  }

  async function openCategoryModal(type) {
    activeCategoryType = type;
    modalTitleEl.textContent = `Ocultar categorias - ${labelForType(type)}`;
    modalListEl.innerHTML = "";
    const categories = await getCatalogCategories(type);
    const selected = normalizeArray(settings?.hiddenCategories?.[type]);
    categoryChecks = new Set(selected);
    updateSelectedCounter();

    for (const cat of categories) {
      const id = String(cat.category_id);
      const row = document.createElement("label");
      row.className = "settings-category-item";
      row.innerHTML = `
        <input type="checkbox" value="${id}" ${categoryChecks.has(id) ? "checked" : ""} />
        <span class="settings-category-name">${cat.category_name}</span>
      `;
      const input = row.querySelector("input");
      input.addEventListener("change", () => {
        if (input.checked) categoryChecks.add(id);
        else categoryChecks.delete(id);
        updateSelectedCounter();
      });
      modalListEl.appendChild(row);
    }
    modalEl.hidden = false;
  }

  async function saveCategorySelection() {
    const nextHidden = {
      ...(settings?.hiddenCategories || {}),
      [activeCategoryType]: Array.from(categoryChecks)
    };
    settings = await updateUserSettings({
      hiddenCategories: nextHidden
    });
    modalEl.hidden = true;
    status.show("Categorias ocultas atualizadas.");
    setTimeout(() => status.hide(), 1200);
  }

  toggleBufferEl.addEventListener("change", async () => {
    settings = await updateUserSettings({
      player: {
        showBufferOverlay: toggleBufferEl.checked
      }
    });
    playerModal.setShowBufferOverlay(Boolean(settings?.player?.showBufferOverlay));
  });

  resetBtn.addEventListener("click", async () => {
    settings = await resetUserSettings();
    toggleBufferEl.checked = Boolean(settings?.player?.showBufferOverlay);
    playerModal.setShowBufferOverlay(toggleBufferEl.checked);
    itemsPerPageEl.value = String(settings?.catalog?.itemsPerPage || 20);
    await loadDefaultCategorySelectors(settings);
    status.show("Preferencias restauradas para o padrao.");
    setTimeout(() => status.hide(), 1200);
  });

  saveCatalogBtn.addEventListener("click", async () => {
    const value = Number.parseInt(itemsPerPageEl.value, 10);
    if (!Number.isInteger(value) || value < 5 || value > 50) {
      status.show("Informe um valor valido entre 5 e 50.");
      return;
    }
    settings = await updateUserSettings({
      catalog: {
        itemsPerPage: value,
        defaultCategory: {
          live: {
            id: String(defaultCategoryLiveEl.value || ""),
            name:
              defaultCategoryLiveEl.selectedOptions?.[0]?.textContent?.trim() || "Todas"
          },
          vod: {
            id: String(defaultCategoryVodEl.value || ""),
            name:
              defaultCategoryVodEl.selectedOptions?.[0]?.textContent?.trim() || "Todas"
          },
          series: {
            id: String(defaultCategorySeriesEl.value || ""),
            name:
              defaultCategorySeriesEl.selectedOptions?.[0]?.textContent?.trim() || "Todas"
          }
        }
      }
    });
    itemsPerPageEl.value = String(settings?.catalog?.itemsPerPage || value);
    status.show("Configuracao de itens por pagina atualizada.");
    setTimeout(() => status.hide(), 1200);
  });

  saveAuthConfigBtn.addEventListener("click", async () => {
    if (!currentUser || currentUser.role !== "admin") return;
    const payload = {
      auto_login_enabled: autoLoginEnabledEl.checked,
      auto_login_username: autoLoginUsernameEl.value.trim()
    };
    await updateAdminAuthConfig(payload);
    status.show("Configuracao de autenticacao automatica atualizada.");
    setTimeout(() => status.hide(), 1200);
  });

  for (const btn of manageButtons) {
    btn.addEventListener("click", () => openCategoryModal(btn.dataset.type));
  }
  closeModalBtn.addEventListener("click", () => {
    modalEl.hidden = true;
  });
  modalEl.addEventListener("click", (event) => {
    if (event.target === modalEl) modalEl.hidden = true;
  });
  saveModalBtn.addEventListener("click", saveCategorySelection);

  try {
    status.show("Carregando configuracoes...");
    await loadBase();
    status.hide();
  } catch (error) {
    status.show(error.message || "Falha ao carregar configuracoes.");
  }
}
