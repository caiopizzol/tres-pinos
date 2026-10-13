# conciliar-extrato

Confere as entradas de um mês no extrato do Inter com as NFS-e emitidas pela empresa e diz quais ficam sem nota.
Só sugere: quem decide é você.

Usa os conectores [`inter`](../../connectors/inter) e [`nfse`](../../connectors/nfse), ligados ao seu agente.
Na pasta do repositório, copie a pasta para o seu agente:

```bash
mkdir -p ~/.claude/skills && cp -R skills/conciliar-extrato ~/.claude/skills/   # Claude Code
mkdir -p ~/.agents/skills && cp -R skills/conciliar-extrato ~/.agents/skills/   # Codex
```

Depois, peça: "concilia setembro".
