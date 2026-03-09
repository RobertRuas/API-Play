# Xtream App (SPA + API Express)

Documentação principal do projeto, com foco em manutenção por time júnior.

## 1. Visão geral

Esta aplicação possui duas partes:

- **Backend** em Node + Express: integra com Xtream e expõe endpoints mais simples para o frontend.
- **Frontend SPA** em JavaScript puro: navegação por hash (`#/rota`), sem recarregar a página inteira.

Objetivo principal:

- Navegar por TV ao vivo, filmes e séries;
- Filtrar catálogo por categoria;
- Reproduzir mídia com player global otimizado.
- Buscar conteúdo de forma global (TV, filmes e séries) em modal dedicado.

## 2. Estrutura de pastas

```txt
.
├── server.js                 # API local Express
├── app/
│   ├── public/               # Camada estática (HTML/CSS)
│   │   ├── index.html
│   │   └── styles.css
│   └── src/                  # Código-fonte frontend (SPA)
│       └── js/
│           ├── main.js
│           ├── config.js
│           ├── core/router.js
│           ├── services/xtreamApi.js
│           ├── ui/playerModal.js
│           └── views/
│               ├── loginView.js
│               ├── favoritesView.js
│               ├── catalogPageView.js
│               ├── searchResultsView.js
│               ├── seriesDetailView.js
│               └── settingsView.js
├── firebase.json             # Config de Hosting + Functions
├── .firebaserc               # Projeto Firebase (placeholder)
└── functions/                # Estrutura para deploy em Firebase Functions
    ├── index.js
    └── package.json
```

## 3. Fluxo de navegação (SPA)

Rotas principais:

- `#/favorites`: página inicial com sessões prontas para favoritos (sem itens por enquanto).
- `#/live`: catálogo de TV ao vivo.
- `#/movies`: catálogo de filmes.
- `#/series`: catálogo de séries.
- `#/series/:id`: detalhes da série (informações + temporadas + episódios).
- `#/search?q=termo`: resultados de busca global em formato de modal.
- `#/settings`: página de configurações do perfil e da aplicação.

## 4. Regras de catálogo

Ao entrar em `TV`, `Filmes` ou `Séries`:

- carrega **até 20 itens** sem categoria selecionada;
- paginação completa só é habilitada após escolher uma categoria.
- o limite por página pode ser alterado em `Configuração -> Catálogo`.

Categorias:

- botão `Selecionar categoria`;
- abre modal com lista de categorias;
- ao escolher, fecha modal e recarrega conteúdo filtrado.

## 5. Player global

O player:

- é único para toda a aplicação;
- abre em fullscreen por padrão;
- usa ABR para HLS com `hls.js`;
- aplica buffer agressivo para reduzir travamentos;
- exibe loader amigável no início da reprodução.
- retoma automaticamente o conteúdo do ponto salvo (quando houver progresso).
- não exibe opção de download na interface.

## 6. Busca global

A busca global fica no menu lateral como primeiro item.

Comportamento:

- pesquisa simultânea em TV ao vivo, filmes e séries;
- abre uma página exclusiva de resultado em formato de modal;
- resultados separados por sessão, em lista distribuída em 3 colunas;
- cada item exibe categoria (em vez de ID) e estrela para favoritar;
- cada sessão possui botão `Ver mais` para carregar o restante dos resultados;
- ao clicar:
  - TV/Filme abre em fullscreen no player;
  - Série redireciona para a página de detalhes da série.

## 7. Endpoints principais

- `POST /api/connect`
- `GET /api/summary`
- `GET /api/catalog?type=live|vod|series&page=&limit=&category_id=&q=`
- `GET /api/catalog/categories?type=live|vod|series`
- `GET /api/series/:seriesId`

## 8. Rodando localmente

```bash
npm install
npm start
```

Aplicação local:

- [http://localhost:3000](http://localhost:3000)

## 9. Preparação para Firebase

Arquivos já adicionados:

- `firebase.json`
- `.firebaserc`
- `functions/package.json`
- `functions/index.js`

Próximos passos:

1. Instalar Firebase CLI: `npm i -g firebase-tools`
2. Login: `firebase login`
3. Definir projeto real no `.firebaserc` (trocar `SEU_PROJECT_ID_FIREBASE`)
4. Instalar dependências das functions:
   - `cd functions && npm install`
5. Deploy:
   - `firebase deploy --only hosting,functions`

## 10. Persistência no Firestore (usuários/configurações)

Agora o backend local grava os dados de:

- usuários
- sessões
- favoritos
- continuar assistindo
- configurações de perfil

em coleções do **Cloud Firestore** (`users` e `sessions`).

Para funcionar localmente, configure uma credencial de service account:

1. Baixe o JSON de chave da conta de serviço no projeto Firebase.
2. Defina uma das opções abaixo antes de iniciar o servidor:
   - `FIREBASE_SERVICE_ACCOUNT_PATH=/caminho/chave.json`
   - ou `FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'`
3. Opcional: definir projeto explicitamente:
   - `FIREBASE_PROJECT_ID=<SEU_FIREBASE_PROJECT_ID>`

Exemplo:

```bash
export FIREBASE_SERVICE_ACCOUNT_PATH="/Users/admin/keys/service-account.json"
export FIREBASE_PROJECT_ID="<SEU_FIREBASE_PROJECT_ID>"
npm start
```

## 11. Deploy na Vercel (sem credenciais no repositório)

Defina estas variáveis em **Project > Settings > Environment Variables**:

- `XTREAM_SERVER_URL`
- `XTREAM_USERNAME`
- `XTREAM_PASSWORD`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_SERVICE_ACCOUNT_BASE64` (recomendado: JSON da service account em base64)
  - alternativa: `FIREBASE_SERVICE_ACCOUNT_JSON` (JSON em uma linha)

Observações:

- Não comite arquivos de chave (`keys/`) nem `.env` com valores reais.
- Se o JSON vier com `\\n` na `private_key`, o backend normaliza automaticamente.
- Após salvar as variáveis, faça redeploy.

## 12. Responsividade e manutenção

Responsividade prevista para:

- mobile (layout colapsa a sidebar e simplifica grade/listas);
- desktop (navegação lateral fixa);
- TV (tipografia/controles maiores a partir de telas largas).

- Evite colocar regra de negócio direto nas views: prefira `services/`.
- Evite chamadas diretas para Xtream no frontend: sempre via backend.
- Se adicionar novas páginas, registre no `main.js` e crie view dedicada em `app/src/js/views/`.
