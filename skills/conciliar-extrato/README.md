# conciliar-extrato

Confere as entradas de um mês nas contas da empresa com as NFS-e que ela emitiu e diz quais ficam sem nota. Só
sugere: quem decide é você.

Usa o conector [`nfse`](../../connectors/nfse) e os conectores de todas as contas da empresa, como o
[`inter`](../../connectors/inter) e o [`sicoob`](../../connectors/sicoob), ligados ao seu agente. Só entram contas da empresa (PJ): se o agente não souber
de quem é uma conta, ele pergunta.

Para recebimentos do exterior, que chegam em reais por outro câmbio, indique uma pasta com os comprovantes de saque
da plataforma de pagamento e as invoices em dólar. O agente segue cada comprovante até a invoice e a nota que a
cita, e lista o que fica sem nota.
Na pasta do repositório, copie a pasta para o seu agente:

```bash
mkdir -p ~/.claude/skills && cp -R skills/conciliar-extrato ~/.claude/skills/   # Claude Code
mkdir -p ~/.agents/skills && cp -R skills/conciliar-extrato ~/.agents/skills/   # Codex
```

Depois, peça: "concilia setembro".
