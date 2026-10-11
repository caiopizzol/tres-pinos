# Verificações

`bun run test` roda as ferramentas contra um WAHA falso, sem sessão do WhatsApp, rede nem ferramentas de mídia.
O CI roda em todo pull request.

Num ambiente rodando, `scripts/` e as fixtures entram na imagem do conector só na hora da verificação. Na raiz
do repositório:

```sh
alias check='docker compose run --rm --no-deps -v ./connectors/whatsapp/scripts:/app/connectors/whatsapp/scripts:ro -v ./connectors/whatsapp/fixtures:/app/connectors/whatsapp/fixtures:ro -v ./packages/boleto/fixtures:/app/packages/boleto/fixtures:ro --entrypoint node whatsapp'

check scripts/media.mjs   # cada fixture pelos conversores; as transcrições precisam de TRANSCRIBE_URL
check scripts/smoke.mjs   # cada ferramenta que as configurações oferecem, nas suas conversas reais
```

`smoke.mjs` lê `WHATSAPP_URL` (`http://whatsapp:8080/mcp` dentro do Compose) e `WHATSAPP_KEY`. Confere que
nenhuma ferramenta envia e só mostra contagens, tamanhos, tipos e tempos, nunca o conteúdo das mensagens.

`media.mjs` confere que cada transcrição contém o número falado, cada vídeo dá os quadros esperados, cada PDF
devolve seus textos ou o erro esperado, e cada conta devolve seus códigos ou diz que está bloqueada.
