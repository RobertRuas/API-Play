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

Somente estas variaveis sao utilizadas:

- `XTREAM_SERVER_URL`
- `XTREAM_USERNAME`
- `XTREAM_PASSWORD`

Use o arquivo `.env.example` como referencia.

## Execucao local

1. Instale dependencias:

```bash
npm install
```

2. Crie o arquivo `.env`:

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
