# Plugin

Gera um plugin para o seu agente de IA a partir dos endereços dos seus conectores. O plugin traz um servidor MCP
por conector e as [skills](../../skills) que esses conectores conseguem rodar. Segue o formato
[Agent Plugins](https://agent-plugins.org).

## Uso

Na raiz do repositório:

```bash
bun run plugin whatsapp=https://whatsapp.seudominio.com/mcp
```

O plugin fica em `plugins/tres-pinos/`, fora do git. Para instalar no Codex:

```bash
codex plugin marketplace add ./plugins/tres-pinos
codex plugin add tres-pinos@tres-pinos
```

Na primeira vez, o Codex pede para você entrar pelo login do conector. O plugin nunca guarda tokens.

## Como funciona

- Cada conector precisa de um endereço `https`. `http` só vale para `localhost` e `127.0.0.1`.
- Uma skill entra no plugin só quando todos os conectores que ela pede estão ligados. Ela declara isso no
  `SKILL.md`, em `metadata: connectors: whatsapp sicoob`.

## Desenvolvimento

```bash
bun run test
```
