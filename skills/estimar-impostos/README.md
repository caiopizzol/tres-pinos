# estimar-impostos

Estima o IRPJ e a CSLL de um trimestre de uma empresa de serviços no Lucro Presumido, a partir das NFS-e que ela
emitiu. Confere o regime na Receita e pede a sua confirmação. É uma estimativa: ainda não desconta impostos retidos
nem calcula PIS, COFINS e ISS.

Usa o conector [`nfse`](../../connectors/nfse), ligado ao seu agente, e precisa que o agente possa rodar código para
fazer as contas. Na pasta do repositório, copie a pasta para o seu agente:

```bash
mkdir -p ~/.claude/skills && cp -R skills/estimar-impostos ~/.claude/skills/   # Claude Code
mkdir -p ~/.agents/skills && cp -R skills/estimar-impostos ~/.agents/skills/   # Codex
```

Depois, peça: "estima os impostos do 2º trimestre".
