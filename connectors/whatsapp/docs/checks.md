# Verificações

`bun run test` roda as ferramentas contra um WAHA falso, sem sessão do WhatsApp, rede nem ferramentas de mídia.
O CI roda em todo pull request.

Num ambiente rodando, `scripts/` roda dentro da imagem do conector sem fazer parte dela. Na raiz do repositório:

```sh
alias check='docker compose run --rm --no-deps -v ./connectors/whatsapp:/app/connectors/whatsapp:ro -v ./packages/boleto/fixtures:/app/packages/boleto/fixtures:ro --entrypoint node whatsapp'

check scripts/media.mjs   # cada fixture pelos conversores; as transcrições precisam de GROQ_API_KEY
check scripts/smoke.mjs   # cada ferramenta que as configurações oferecem, nas suas conversas reais
```

`smoke.mjs` lê `GATEWAY_URL` (`http://whatsapp:8080/mcp` dentro do Compose). Quando o conector envia, também
precisa de `CHECK_ALLOWED`, o número de um contato salvo, e `CHECK_DENIED`, um número do WhatsApp que você não
salvou, que `read_messages` e `send_message` devem recusar. Nunca envia nada e só mostra contagens, tamanhos,
tipos e tempos, nunca o conteúdo das mensagens.

`media.mjs` confere que cada transcrição contém o número falado, cada vídeo dá os quadros esperados, cada PDF
devolve seus textos ou o erro esperado, e cada conta devolve seus códigos ou diz que está bloqueada.
