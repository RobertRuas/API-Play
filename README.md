# API-Play

Aplicacao web simples para consumo de Xtream.

## Objetivo do projeto

- manter apenas o essencial para reproduzir TV, filmes e series;
- evitar dependencias externas de banco de dados;
- manter codigo legivel para manutencao rapida.

## Arquitetura

- `server.js`:
  backend Express com endpoints basicos de integracao Xtream.
- `app/public`:
  HTML e CSS da interface.
- `app/src/js`:
  logica de SPA, servicos e views.

### Persistencia

Nao existe banco de dados.

Dados como favoritos, configuracoes e progresso ficam no `localStorage` do navegador.

## Variaveis de ambiente

Todas as configuracoes da aplicacao sao lidas do `.env`.

### Servidor

- `PORT` (padrao: `3000`)
- `HOST` (padrao: `0.0.0.0`)
- `XTREAM_SERVER_URL`
- `XTREAM_USERNAME`
- `XTREAM_PASSWORD`
- `XTREAM_TIMEOUT_MS` (padrao: `12000`)
- `XTREAM_CACHE_TTL_MS` (padrao: `60000`)

### Frontend (injetadas pelo backend em `/app-config.js`)

- `APP_API_CACHE_TTL_MS` (padrao: `60000`)
- `APP_LOGIN_USERNAME` (padrao: `robert`)
- `APP_LOGIN_PASSWORD` (padrao: `sempre`)
- `APP_AUTO_LOGIN_ENABLED` (padrao: `true`)

Use o arquivo `.env.example` como referencia.

## Execucao local

1. Instale dependencias:

```bash
npm install
```

2. Crie o arquivo `.env` com base no `.env.example`.

```bash
XTREAM_SERVER_URL=http://seu-servidor-xtream
XTREAM_USERNAME=seu_usuario
XTREAM_PASSWORD=sua_senha
```

3. Inicie em desenvolvimento:

```bash
npm run dev
```

4. URLs de acesso:

- `http://localhost:3000`
- `http://<IP_DA_SUA_REDE>:3000`

## Estrutura

```text
.
├── app/
│   ├── public/
│   └── src/js/
├── .env.example
├── package.json
└── server.js
```
