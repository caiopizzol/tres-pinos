# Acesso pela internet

Com `PUBLIC_URL`, apps na internet entram com login. Na primeira vez, o app abre uma página do conector; você
digita a `WHATSAPP_KEY` e clica em **Permitir**. O app recebe um token próprio, que vale uma hora e se renova
sozinho. A `WHATSAPP_KEY` não sai da página.

## Publicar com o Cloudflare Tunnel

1. No painel da Cloudflare, em **Networks > Tunnels**, crie um túnel e copie o token.
2. Em **Public hostnames**, aponte o seu endereço, como `whatsapp.seudominio.com`, para `http://whatsapp:8080`.
3. No `.env`:

   ```bash
   COMPOSE_PROFILES=tunnel   # com o Whisper também: tunnel,whisper
   PUBLIC_URL=https://whatsapp.seudominio.com
   TUNNEL_TOKEN=...
   ```

4. Rode `docker compose up -d`.

## Conectar

| App | Comandos |
|---|---|
| Codex | `codex mcp add whatsapp --url https://whatsapp.seudominio.com/mcp` e `codex mcp login whatsapp` |
| Claude Code | `claude mcp add --transport http whatsapp https://whatsapp.seudominio.com/mcp` e `claude mcp login whatsapp` |

Para desconectar todos os apps, apague `oauth.sqlite` no volume `whatsapp` e reinicie o conector.
