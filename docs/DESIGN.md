---
version: alpha
name: Três Pinos
description: Visual system for the README, docs and site. Graphite, one yellow, nothing extra.
brand: ./BRAND.md
colors:
  primary: "#1D1D1F"
  on-primary: "#F7C831"
  accent: "#F7C831"
  on-accent: "#1D1D1F"
  neutral: "#F6F5F1"
  surface: "#FFFFFF"
  surface-muted: "#EFEDE6"
  text: "#1D1D1F"
  text-muted: "#6A675F"
  border: "#E2DFD6"
  dark-background: "#111111"
  dark-surface: "#1B1B1B"
  dark-text: "#F2F1EC"
  dark-text-muted: "#A29F97"
  dark-border: "#2F2F2F"
  success: "#15803D"
  success-surface: "#DCFCE7"
typography:
  display:
    fontFamily: Inter
    fontSize: 40px
    fontWeight: 800
    lineHeight: 1.08
    letterSpacing: -0.035em
  heading:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: -0.02em
  body:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.4
  code:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.7
rounded:
  sm: 8px
  md: 10px
  lg: 14px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 48px
components:
  page:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
  page-dark:
    backgroundColor: "{colors.dark-background}"
    textColor: "{colors.dark-text}"
    typography: "{typography.body}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: 8px 14px
  button-primary-dark:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: 8px 14px
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: 8px 14px
  highlight:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "{spacing.md}"
  card-meta:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-muted}"
    typography: "{typography.label}"
  card-dark:
    backgroundColor: "{colors.dark-surface}"
    textColor: "{colors.dark-text}"
    rounded: "{rounded.lg}"
    padding: "{spacing.md}"
  card-meta-dark:
    backgroundColor: "{colors.dark-surface}"
    textColor: "{colors.dark-text-muted}"
    typography: "{typography.label}"
  code-block:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral}"
    typography: "{typography.code}"
    rounded: "{rounded.md}"
    padding: "{spacing.md}"
  code-prompt:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.accent}"
    typography: "{typography.code}"
  chip:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.text-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
  badge-success:
    backgroundColor: "{colors.success-surface}"
    textColor: "{colors.success}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
  divider:
    backgroundColor: "{colors.border}"
  divider-dark:
    backgroundColor: "{colors.dark-border}"
---

# Três Pinos

## Overview

Este sistema aplica a marca de [BRAND.md](BRAND.md) ao README, à documentação e ao site. As cores e as fontes
vêm de lá; escalas, papéis e componentes são definidos aqui.

A sensação é de um quadro de luz bem montado: grafite, uma etiqueta amarela e nada sobrando. Quem lê é
desenvolvedor; a página vai direto ao comando que funciona.

## Colors

Grafite e papel fazem quase tudo. O amarelo aparece pouco e sempre com grafite.

- **Primary (#1D1D1F):** grafite. Texto, botão principal no tema claro e fundo dos blocos de código.
- **Accent (#F7C831):** amarelo tomada. Texto do botão principal, destaque de uma palavra e o `$` no código.
  No tema escuro vira o botão principal.
- **Neutral (#F6F5F1):** papel. Fundo das páginas no tema claro.
- **Text muted (#6A675F / #A29F97):** legendas e metadados, no claro e no escuro.
- **Success (#15803D):** só para estados como "disponível" e "confirmado".

O amarelo nunca é texto sobre fundo claro: o contraste é 1,5:1. Use sempre grafite sobre amarelo (10,6:1) ou
amarelo sobre grafite.

## Typography

- **Inter** para tudo que se lê como frase. Títulos em 800 com espaçamento negativo.
- **JetBrains Mono** para comandos, código, nomes de ferramentas e variáveis.

## Layout

Coluna única até 720 px. Escala de espaçamento 4 / 8 / 16 / 24 / 48. Generoso entre seções, justo dentro dos
cartões.

## Elevation & Depth

Plano. Bordas de 1 px separam as superfícies. Sem sombras, desfoque ou gradientes.

## Shapes

Botões com raio de 10 px, cartões com 14 px, selos e chips arredondados. O ícone usa a tomada sobre quadrado
de raio 28 em 128 (`assets/logo.svg`); abaixo de 32 px, use `assets/favicon.svg`.

## Components

- **Botão principal:** grafite com texto amarelo no claro; amarelo com texto grafite no escuro.
- **Destaque:** fundo amarelo atrás de uma palavra-chave do título. No máximo um por tela.
- **Bloco de código:** fundo grafite, texto papel, `$` em amarelo.
- **Cartão de conector:** fundo branco, borda de 1 px, selo "disponível" em verde ou "em breve" neutro.
- **Selo:** texto de 12 px em pílula.

## Do's and Don'ts

- Use o amarelo uma vez por tela, no botão principal ou no destaque.
- Use grafite sobre amarelo, nunca amarelo sobre branco.
- Escreva a marca como "três pinos" em minúsculas ao lado do ícone.
- Não use o verde do WhatsApp nem a combinação verde e amarelo.
- Não use gradientes, sombras ou uma segunda cor de destaque.
- Não use o ícone abaixo de 16 px.
