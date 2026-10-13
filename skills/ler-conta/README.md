# ler-conta

Lê os códigos de boleto e Pix de uma conta em PDF ou foto, e confere os dígitos antes de pagar. O agente roda o
leitor do Três Pinos na sua máquina, por isso precisa do repositório.

Precisa do [Node.js](https://nodejs.org) 22.18+, do [Bun](https://bun.sh) para instalar e, para PDFs, do
[Poppler](https://poppler.freedesktop.org) e do [qpdf](https://qpdf.readthedocs.io).

Na pasta do repositório:

```bash
bun install --production --filter @tres-pinos/boleto
export TRES_PINOS_DIR="$PWD"
mkdir -p ~/.claude/skills && cp -R skills/ler-conta ~/.claude/skills/   # Claude Code
mkdir -p ~/.agents/skills && cp -R skills/ler-conta ~/.agents/skills/   # Codex
```

Sem `TRES_PINOS_DIR`, o agente pergunta onde está o repositório.
