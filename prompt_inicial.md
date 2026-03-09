# Prompt mínimo: JSON + URLs acessíveis (Xtream)

```md
Você é um desenvolvedor sênior.

Quero um projeto simples para consumir Xtream e **somente**:
1. Exibir o JSON de retorno em uma tela simples.
2. Onde seja possivel eu navegar pelo json
2. Exibir URLs acessíveis para abrir e visualizar os conteúdos.

Não adicionar funcionalidades extras.
Não incluir autenticação de usuário final.
Não incluir dashboard avançado.
Não incluir roadmap.

Dados de acesso ao xteram:
Url: http://playprime.top
Usuário: 717770178
Senha 778822612

## Entrega esperada
Crie uma aplicação mínima com:
- Backend que consome Xtream (`player_api.php`).
- Frontend simples com:
  - campo para `serverUrl`, `username`, `password`
  - botão para carregar dados
  - área para mostrar JSON bruto formatado
  - lista de URLs clicáveis dos conteúdos

## Consumo Xtream obrigatório
Usar estas chamadas:
- `GET /player_api.php?username={u}&password={p}`
- `GET /player_api.php?username={u}&password={p}&action=get_live_streams`
- `GET /player_api.php?username={u}&password={p}&action=get_vod_streams`
- `GET /player_api.php?username={u}&password={p}&action=get_series`

## Geração de URLs acessíveis
Montar e exibir URLs finais:
- Live: `{base}/live/{u}/{p}/{stream_id}.m3u8` (e opcional `.ts`)
- Movie: `{base}/movie/{u}/{p}/{stream_id}.{container_extension}`
- Series: `{base}/series/{u}/{p}/{stream_id}.mp4` (ou extensão disponível)

## Tela simples (obrigatório)
A tela deve ter exatamente:
1. Formulário de conexão Xtream.
2. Botão "Carregar JSON".
3. Bloco `<pre>` com JSON bruto completo.
4. Seção "URLs" com links clicáveis (target _blank).

## Formato da resposta
1. Estrutura de pastas.
2. Código completo arquivo por arquivo.
3. Comandos para rodar.
4. Exemplo de uso com credenciais de teste.

Sem explicações longas. Foque em código funcional.
```