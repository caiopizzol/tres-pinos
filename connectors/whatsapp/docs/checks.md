# Verificações

`bun run test` testa as ferramentas contra um WAHA falso, sem WhatsApp, rede nem ferramentas de mídia. O CI roda
isso em todo pull request, e também passa todas as fixtures pela imagem do conector.

Num ambiente rodando, os scripts usam a imagem do conector, que não os inclui. Na raiz do repositório:

```sh
alias check='docker compose run --rm --no-deps -v ./connectors/whatsapp/scripts:/app/connectors/whatsapp/scripts:ro -v ./connectors/whatsapp/fixtures:/app/connectors/whatsapp/fixtures:ro -v ./packages/boleto/fixtures:/app/packages/boleto/fixtures:ro --entrypoint node whatsapp'

check scripts/media.mjs   # cada fixture pelas conversões
check scripts/smoke.mjs   # cada ferramenta nas suas conversas reais
```

| Script | O que confere |
|---|---|
| `media.mjs` | Cada áudio e vídeo vira o texto falado, cada vídeo dá os quadros esperados, cada PDF dá o texto ou o erro esperado, e cada conta dá os seus códigos. Sem `TRANSCRIBE_URL`, pula as transcrições |
| `smoke.mjs` | A chave é exigida, nenhuma ferramenta envia, e cada ferramenta funciona nas suas conversas. Lê `WHATSAPP_URL` (padrão `http://whatsapp:8080/mcp`) e `WHATSAPP_KEY`. Mostra só contagens, tamanhos e tempos, nunca o conteúdo |
