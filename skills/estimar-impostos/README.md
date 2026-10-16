# estimar-impostos

Estima o IRPJ e a CSLL de um trimestre de uma empresa de serviços no Lucro Presumido, a partir das NFS-e que ela
emitiu. Confere o regime na Receita e pede a sua confirmação. As regras, com a lei de onde vem cada uma, estão em
[references/lucro-presumido.md](references/lucro-presumido.md).

Desconta o IRRF e a CSLL retidos dentro do trimestre, perguntando quando o cliente pagou cada nota com retenção. Para
isso, o conector precisa ser da v0.1.5 ou posterior. É uma estimativa: ainda não calcula PIS, COFINS e ISS.

Usa o conector [`nfse`](../../connectors/nfse), ligado ao seu agente, e precisa que o agente possa rodar código para
fazer as contas. O conector de uma versão posterior à v0.1.5 já traz esta skill: o agente a lê com `read_skill`, sem
instalar nada. Com um conector anterior, na pasta do repositório, copie a pasta para o seu agente:

```bash
mkdir -p ~/.claude/skills && cp -R skills/estimar-impostos ~/.claude/skills/   # Claude Code
mkdir -p ~/.agents/skills && cp -R skills/estimar-impostos ~/.agents/skills/   # Codex
```

Depois, peça: "estima os impostos do 2º trimestre".
