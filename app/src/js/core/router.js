// -----------------------------------------------------------------------------
// Router SPA por hash (#/rota)
// -----------------------------------------------------------------------------
// Objetivo: trocar apenas o conteúdo principal sem recarregar a página inteira.
// -----------------------------------------------------------------------------

// Lê hash atual e separa path e query string.
function parseHash() {
  const raw = window.location.hash.replace(/^#/, "") || "/";
  const [pathPart, queryPart] = raw.split("?");
  const path = pathPart.startsWith("/") ? pathPart : `/${pathPart}`;
  const query = new URLSearchParams(queryPart || "");
  return { path, query };
}

// Compara rota cadastrada com path atual e extrai parâmetros dinâmicos.
function matchPattern(pattern, path) {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;

  const params = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const p = patternParts[i];
    const s = pathParts[i];
    if (p.startsWith(":")) {
      params[p.slice(1)] = s;
      continue;
    }
    if (p !== s) return null;
  }
  return params;
}

// Cria um roteador simples com:
// - lista de rotas
// - fallback para 404
export function createRouter(routes, onNotFound) {
  async function resolve() {
    const location = parseHash();
    for (const route of routes) {
      const params = matchPattern(route.path, location.path);
      if (params) {
        await route.handler({ params, query: location.query, path: location.path });
        return;
      }
    }
    onNotFound(location);
  }

  window.addEventListener("hashchange", () => {
    resolve().catch(() => {
      onNotFound(parseHash());
    });
  });
  window.addEventListener("load", () => {
    resolve().catch(() => {
      onNotFound(parseHash());
    });
  });
  return {
    resolve: () =>
      resolve().catch(() => {
        onNotFound(parseHash());
      })
  };
}
