<p align="center">
  <img src="assets/logo.svg" width="80" height="80" alt="Três Pinos">
</p>

<h1 align="center">Três pinos, nenhum adaptador.</h1>

<p align="center">
  A tomada brasileira para agentes de IA: conectores que dão acesso ao que só existe no Brasil,
  <br>
  e skills que ensinam o que fazer com ele 🇧🇷
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/licença-MIT-1d1d1f" alt="Licença MIT"></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP-servidor-f7c831?labelColor=1d1d1f" alt="MCP"></a>
</p>

<img width="1200" height="720" alt="tres-pinos-equipe-readme" src="https://github.com/user-attachments/assets/0b12ff34-5608-40ba-80d4-4f1aaadd52ab" />

## Por que três pinos?

Em 2011 o Brasil tornou obrigatória a sua própria tomada: três pinos redondos, o terra um pouco abaixo dos outros
dois e dois tamanhos de pino, para o plugue grosso não entrar na tomada fina. Quase nenhum outro país usa. A
imprensa chamou de padrão jabuticaba: aquilo que só dá aqui.

A tomada tem companhia: boleto, Pix, CPF para tudo e cliente que só fala por WhatsApp. Os agentes de IA chegam
prontos para o resto do mundo e travam nas nossas jabuticabas.

> [!NOTE]
> **E o Open Finance?** Regulado pelo [Banco Central](https://www.bcb.gov.br/estabilidadefinanceira/openfinance),
> ele deixa uma instituição ler a sua conta em outro banco, com o seu consentimento. Mas só instituições
> autorizadas entram nele: para chegar ao seu agente, os seus dados passam por uma delas.
>
> Os conectores daqui usam a API oficial de cada sistema, com o seu certificado, de um servidor seu, sem empresa no
> meio.

## Conectores

| Conector                      | O que o agente pode fazer                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| [`sicoob`](connectors/sicoob) | Ler o saldo e o extrato da conta corrente. Nunca movimenta dinheiro                                     |
| [`inter`](connectors/inter)   | Ler o saldo e o extrato da conta PJ. Nunca movimenta dinheiro                                           |
| [`nfse`](connectors/nfse)     | Ler as notas fiscais de serviço da empresa. Emite só no ambiente de teste, se você ligar. Nunca cancela |

## Skills

Instruções que o seu agente segue, no formato aberto de [Agent Skills](https://agentskills.io). Testadas no Claude
Code e no Codex.

| Skill                                           | O que o agente faz                                                                                    |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [`ler-conta`](skills/ler-conta)                 | Lê os códigos de boleto e Pix de uma conta em PDF ou foto, e confere antes de pagar                   |
| [`conciliar-extrato`](skills/conciliar-extrato) | Confere as entradas de um mês nas contas da empresa com as NFS-e emitidas e diz quais ficam sem nota  |
| [`estimar-impostos`](skills/estimar-impostos)   | Estima o IRPJ e a CSLL de um trimestre no Lucro Presumido, a partir das NFS-e emitidas                |
| [`emitir-nfse`](skills/emitir-nfse)             | Emite, no ambiente de teste, a NFS-e de um serviço de software exportado a partir da invoice em dólar |

O conector `nfse` já traz as skills que o usam, e o agente as lê sem instalar nada. Como instalar as outras está
na pasta de cada uma.

## Início rápido

Precisa do [Docker](https://docs.docker.com/get-docker/).

```bash
mkdir tres-pinos && cd tres-pinos
curl -fsSLO https://github.com/caiopizzol/tres-pinos/releases/latest/download/compose.yaml
curl -fsSL https://github.com/caiopizzol/tres-pinos/releases/latest/download/env.example -o .env
```

No `.env`, escolha os conectores em `COMPOSE_PROFILES` e preencha as variáveis.

Prepare o certificado como diz cada conector: [Sicoob](connectors/sicoob), [Inter](connectors/inter) ou
[NFS-e](connectors/nfse). Depois:

```bash
docker compose up -d
```

E ligue o seu agente na mesma máquina, com a porta e a chave de cada conector:

| Conector | Endereço                    | Chave        |
| -------- | --------------------------- | ------------ |
| `sicoob` | `http://127.0.0.1:3012/mcp` | `SICOOB_KEY` |
| `inter`  | `http://127.0.0.1:3013/mcp` | `INTER_KEY`  |
| `nfse`   | `http://127.0.0.1:3014/mcp` | `NFSE_KEY`   |

Os comandos guardam só o nome da variável, não a chave. Deixe a chave no ambiente em que você abre o agente, por
exemplo no `~/.zshrc`. Para o Sicoob:

```bash
export SICOOB_KEY=...   # a mesma do .env
codex mcp add sicoob --url http://127.0.0.1:3012/mcp --bearer-token-env-var SICOOB_KEY
claude mcp add --scope user --transport http sicoob http://127.0.0.1:3012/mcp --header 'Authorization: Bearer ${SICOOB_KEY}'
```

Para o Inter ou a NFS-e, troque o nome, a porta e a chave pelos da tabela.

## Desenvolvimento

Precisa do [Bun](https://bun.sh) 1.3+.

```bash
bun install
bun run check
bun run test
docker compose up -d --build   # os conectores desta pasta, em vez das imagens publicadas
```

## Licença

[MIT](LICENSE)
