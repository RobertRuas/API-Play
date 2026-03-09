// -----------------------------------------------------------------------------
// Loader global de página
// -----------------------------------------------------------------------------
// Exibe um overlay único durante:
// - transições de rota
// - requisições de dados
// Usa contador para suportar múltiplas operações simultâneas.
// -----------------------------------------------------------------------------
const loaderEl = document.getElementById("page-loader");

let activeCount = 0;
let showTs = 0;
const MIN_VISIBLE_MS = 220;

function setVisible(visible) {
  if (!loaderEl) return;
  loaderEl.hidden = !visible;
  document.body.classList.toggle("is-page-loading", visible);
}

export function startPageLoading() {
  activeCount += 1;
  if (activeCount === 1) {
    showTs = Date.now();
    setVisible(true);
  }
}

export async function stopPageLoading() {
  if (activeCount <= 0) return;
  activeCount -= 1;
  if (activeCount > 0) return;

  const elapsed = Date.now() - showTs;
  const waitMs = Math.max(0, MIN_VISIBLE_MS - elapsed);
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  setVisible(false);
}

export async function withPageLoader(task) {
  startPageLoading();
  try {
    return await task();
  } finally {
    await stopPageLoading();
  }
}

