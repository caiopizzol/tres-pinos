# conciliar-extrato

Confere as entradas de um mês nas contas da empresa com as NFS-e que ela emitiu e diz quais ficam sem nota. Só
sugere: quem decide é você.

Usa o conector [`nfse`](../../connectors/nfse) e um conector de banco, como o [`inter`](../../connectors/inter) ou o
[`sicoob`](../../connectors/sicoob), ligados ao seu agente. Só entram contas da empresa (PJ): se o agente não souber
de quem é uma conta, ele pergunta.
Na pasta do repositório, copie a pasta para o seu agente:

```bash
mkdir -p ~/.claude/skills && cp -R skills/conciliar-extrato ~/.claude/skills/   # Claude Code
mkdir -p ~/.agents/skills && cp -R skills/conciliar-extrato ~/.agents/skills/   # Codex
```

Depois, peça: "concilia setembro".
