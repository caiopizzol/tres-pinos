---
name: "Três Pinos"
tagline: "A tomada brasileira para agentes de IA."
specVersion: "0.3.0"
version: 1
language: pt-BR
---

# Três Pinos

## Strategy

### Overview

Três Pinos liga agentes de IA aos serviços que o brasileiro usa no dia a dia: boletos, Pix e bancos.
São servidores MCP de código aberto que a pessoa hospeda onde quiser.

Nasceu de um assistente pessoal que lia contas no WhatsApp e agendava pagamentos no Sicoob. O nome é a tomada de
três pinos (NBR 14136), o padrão que só o Brasil adotou em larga escala.

O problema: Codex, Claude, ChatGPT e Grok já se conectam a Gmail e GitHub, mas não ao boleto, ao Pix nem ao banco
brasileiro. Antes, cada pessoa monta sua gambiarra. Depois, ela liga um conector e o agente lê a conta,
confere o código e pede confirmação antes de pagar.

Ambição: ser o jeito padrão de ligar um agente de IA aos serviços brasileiros.

### Audience

Desenvolvedores e donos de pequenos negócios no Brasil que já usam IA e querem que ela resolva tarefas reais:
ler uma conta, ver o extrato, conferir um pagamento. Sabem rodar `docker compose`.

Desconfiam de dar acesso à conta bancária a uma IA e de integrações não oficiais. Querem ver o que o agente faz e
aprovar o que mexe com dinheiro.

Não é para quem quer um chatbot pronto sem configurar nada.

### Positioning

Categoria: conectores MCP de código aberto para serviços brasileiros.

Não é um chatbot. Não é uma plataforma de automação. Não é um banco nem um meio de pagamento.

Os grandes assistentes trazem conectores para serviços globais. Os serviços brasileiros ficam de fora ou
dependem de integrações pagas e fechadas. Três Pinos ocupa esse espaço, aberto e auto-hospedado.

- Feito para o Brasil: boleto, Pix, bancos brasileiros.
- Código aberto (MIT) e auto-hospedado: os dados ficam com quem roda.
- Seguro por padrão: no banco, só lê; pagamento só com aprovação.
- Funciona com qualquer cliente MCP.

Território: a tomada. O ponto onde o agente se liga ao Brasil.

### Personality

Arquétipo: o eletricista de confiança. Resolve, explica o que fez e não inventa.

Atributos: prático, confiável, direto, bem-humorado, brasileiro.

É: claro, útil, honesto, leve.

Não é: corporativo, ufanista, exagerado, mágico.

### References & Anti-References

#### References

- **Tomadas e quadros de luz:** pegar a clareza da sinalização elétrica (preto, amarelo, símbolos simples).
  Não pegar o tom de alerta nem o visual de perigo.
- **Linear:** pegar a contenção e a hierarquia clara. Não pegar os gradientes escuros.
- **Bun e Vercel:** pegar o README que vai direto ao comando que funciona. Não pegar o tom de lançamento.

#### Anti-References

- **Fintech de cartão:** rejeitar gradientes, promessas de "liberdade financeira" e a cara de banco digital.
- **Patriotismo verde-amarelo:** rejeitar a bandeira e o tom ufanista. O Brasil aparece no que o produto
  resolve, não em símbolos.

### Promise

- Você hospeda. Os dados são seus.
- O agente pede antes de mexer no seu dinheiro.
- Funciona com o cliente de IA que você já usa.

Mensagem base: conectores abertos para o agente de IA resolver tarefas brasileiras.

Síntese: a tomada brasileira para agentes de IA.

### Guardrails

Tom: prático, honesto, leve.

Não pode ser: um banco, uma promessa de enriquecer, um produto oficial de um banco ou de uma plataforma.

Teste: se soa como anúncio de fintech, está errado.

## Voice

### Identity

Somos conectores de código aberto que ligam o seu agente de IA ao boleto, ao Pix e ao seu banco.
Você roda na sua máquina ou no seu servidor, e escolhe o que o agente pode ler e fazer.

Lemos a conta que chegou, conferimos o código e mostramos para você antes de qualquer pagamento.
Nada sai sem a sua aprovação.

Essência: tudo que é brasileiro, ligado ao seu agente.

### Tagline & Slogans

Título: **Três pinos, nenhum adaptador.** No topo do README e do site, sempre com a frase de baixo.

Tagline: **A tomada brasileira para agentes de IA.** Sozinha, onde não cabe explicação.

Descrição: **A tomada brasileira para agentes de IA: conectores MCP de código aberto, que você hospeda, para o
que só existe no Brasil.** Embaixo do título, na descrição do GitHub e nas prévias de link.
Não cita conectores: eles ficam só na tabela do README, que cresce sem mudar a descrição.

Alternativas:

- Ligue seu agente de IA no Brasil.
- Conectores brasileiros para agentes de IA.

Slogans:

- Do boleto ao banco, sem gambiarra.
- Você hospeda. Você aprova.
- Padrão brasileiro, código aberto.

### Message Pillars

- **Brasil:** boleto, Pix e bancos como eles funcionam aqui.
- **Controle:** você hospeda, escolhe o que o agente lê e aprova cada pagamento.
- **Aberto:** código MIT, sem cadastro e sem plataforma no meio.
- **Prático:** um `docker compose up` e o agente já lê a primeira conta.

### Phrases

- Ligue no Brasil.
- Três pinos, nenhum adaptador.
- O agente lê, você aprova.
- Boleto conferido, pagamento com a sua aprovação.
- Sem gambiarra.

### Tonal Rules

- Fale como um colega técnico explica para outro.
- Comece pelo que a pessoa consegue fazer, depois explique como.
- Use frases curtas e verbos concretos: ler, conferir, agendar, aprovar.
- Diga o limite junto com o recurso, como "só lê, nunca movimenta dinheiro".
- Use humor só na tomada e no padrão jabuticaba, nunca no dinheiro.
- Não prometa segurança absoluta. Diga o que o código garante.
- Avise quando uma integração não é oficial e o que ela arrisca.
- Escreva em português do Brasil. Nomes de ferramentas e código ficam em inglês.

O que não somos:

- Não somos um banco nem uma fintech.
- Não somos um produto oficial de nenhum banco ou plataforma.
- Não somos uma plataforma de automação.
- Não guardamos seus dados.

| Dizemos                                      | Nunca dizemos                      |
| -------------------------------------------- | ---------------------------------- |
| "O agente pede sua aprovação antes de pagar" | "Pagamentos 100% automáticos"      |
| "Só lê a conta, nunca movimenta dinheiro"    | "Controle total da sua conta"      |
| "Você hospeda"                               | "Nossa nuvem segura"               |
| "Não é oficial"                              | "Integração oficial", quando não é |

## Visual

### Logo & Marks

A marca é a tomada brasileira de três pinos: um hexágono arredondado com três furos, o do terra mais abaixo.
Lembra um rostinho; isso é intencional.

- **Ícone:** tomada amarela sobre quadrado grafite. `assets/logo.svg` e `assets/logo.png`.
- **Favicon:** desenho próprio para 16 px, com furos maiores. `assets/favicon.svg`.
- **Marca de uma cor:** só o contorno, na cor do texto. `assets/mark.svg`.

Espaço livre igual a um furo em volta do ícone. Mínimo de 16 px. Nunca girar, esticar, trocar as cores nem
pôr a bandeira junto.

### Core Colors

- **Grafite** `#1D1D1F` (obrigatória): o quadro de luz. Texto, fundo do ícone, peso da marca.
- **Amarelo tomada** `#F7C831` (obrigatória): o sinal elétrico. A cor que identifica a marca. Raro e intencional.
- **Papel** `#F6F5F1` (opcional): fundo claro e quente, mais suave que o branco.

Evitar: o verde do WhatsApp, que fica ao lado do ícone, e a combinação verde e amarelo da bandeira.

### Typefaces

- **Inter**, textos e títulos. Fallback: `system-ui, -apple-system, Segoe UI, sans-serif`. Licença: SIL OFL 1.1.
  Verificada.
- **JetBrains Mono**, código, comandos e dados. Fallback: `ui-monospace, SFMono-Regular, monospace`. Licença:
  SIL OFL 1.1. Verificada.

### Art Direction

Palavras-chave: elétrico, direto, contido, técnico, brasileiro, amigável.

Direção: a identidade comunica uma ligação que funciona, não decoração.

Território: o quadro de luz de uma casa brasileira. Grafite, uma etiqueta amarela, símbolos simples e nada
sobrando.
