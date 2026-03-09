# API-Play

Aplicacao Node/Express com frontend HTML/CSS/JS para consumir Xtream.

## Arquitetura atual

- Backend Express em `server.js`
- Frontend SPA em `app/public` + `app/src/js`
- Sessao/autenticacao/preferencias em **memoria no servidor** (`userStore.js`)
- **Sem Firebase** e **sem banco de dados**

## Importante sobre persistencia

Como o armazenamento e em memoria:

- reiniciar o processo apaga sessoes/preferencias/favoritos/progresso;
- em ambientes serverless, esses dados podem resetar com frequencia.

## Variaveis de ambiente

A aplicacao usa somente estas variaveis:

- `XTREAM_SERVER_URL`
- `XTREAM_USERNAME`
- `XTREAM_PASSWORD`
- `AUTO_LOGIN_OVERRIDE` (opcional, sobrepoe escolha do admin)

Arquivo de exemplo: `.env.example`.

## Executar localmente

1. Instale dependencias:

```bash
npm install
```

2. Crie `.env` com as variaveis Xtream:

```bash
XTREAM_SERVER_URL=http://seu-servidor-xtream
XTREAM_USERNAME=seu_usuario
XTREAM_PASSWORD=sua_senha
```

3. Rode:

```bash
npm run dev
```

Servidor:

- `http://localhost:3000`
- `http://<IP_DA_SUA_REDE>:3000`

## Deploy (Vercel)

Configure no projeto Vercel:

- `XTREAM_SERVER_URL`
- `XTREAM_USERNAME`
- `XTREAM_PASSWORD`
- `AUTO_LOGIN_OVERRIDE` (opcional)

Depois, redeploy.

Valores aceitos em `AUTO_LOGIN_OVERRIDE`:

- `off` / `false` / `0` / `disabled`: desativa auto-login.
- `on` / `true` / `1` / `enabled`: ativa auto-login com usuario configurado (fallback `robert`).
- `<username>`: ativa auto-login e força esse usuario.

## Estrutura principal

```text
.
├── app/
│   ├── public/
│   └── src/js/
├── .env.example
├── package.json
├── server.js
└── userStore.js
```
