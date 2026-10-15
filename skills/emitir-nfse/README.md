# emitir-nfse

Emite a NFS-e de um serviço de software exportado a partir da invoice em dólar, no ambiente de teste do sistema
nacional, onde a nota não tem valor fiscal. Ainda não cobre empresas do Simples Nacional. O agente converte o valor pela PTAX do Banco Central, monta a declaração
(DPS), mostra tudo e só emite com a sua aprovação.

Usa o conector [`nfse`](../../connectors/nfse) com `NFSE_ISSUE=restrita`, ligado ao seu agente. Na primeira vez, ele
pergunta a série da DPS que o conector usa, para não repetir os números das notas do portal ou do seu contador.
Na pasta do repositório, copie a pasta para o seu agente:

```bash
mkdir -p ~/.claude/skills && cp -R skills/emitir-nfse ~/.claude/skills/   # Claude Code
mkdir -p ~/.agents/skills && cp -R skills/emitir-nfse ~/.agents/skills/   # Codex
```

Depois, peça: "emite a nota da invoice INV-0012".
