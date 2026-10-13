# Modelo de guia de conector

Cada conector tem um `README.md` com estas seções, nesta ordem. Copie o modelo e troque o que está entre `<>`.

````markdown
# <Nome>

<O que o agente pode fazer, em uma frase.> <O que é recusado, em uma frase.>

## Antes de começar

- <Tipo de conta exigido, com link se o serviço restringir.>
- <Certificado ou credencial necessária.>

No fim, você terá <os arquivos e valores que este guia produz>.

## No <serviço>

1. <Um passo por ação, com o nome exato do menu ou botão em **negrito**.>

![<O que o GIF mostra>](<conector>-1.gif)

## No Três Pinos

<Onde pôr os arquivos e quais variáveis preencher no `.env`.>

```bash
docker compose up -d
```

## Ligar o agente

<O endereço do conector e como entrar.> Depois, pergunte: "<uma pergunta que usa uma ferramenta>".

![Entrar no conector](entrar.gif)

## Configuração

| Variável | O que faz |
| -------- | --------- |

## Ferramentas

| Ferramenta | O que faz |
| ---------- | --------- |
````

## Regras

- Escreva para quem nunca fez isso antes: diga o que clicar, não o que a API faz.
- Seja breve: uma frase por passo, sem repetir o que outra seção ou o README principal já diz.
- Cada passo é verificável: diga o que a pessoa deve ver ao terminar.
- Mostre só os dados de uma conta fictícia ou borrados. Nunca saldo, CNPJ, nome ou chave reais.
- A seção `## Ferramentas` é lida pelos testes: mantenha o título e a tabela.
