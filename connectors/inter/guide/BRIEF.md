---
workflow: general-video
flow: automation
storyboard: no
message: "Criar a integração no Inter leva seis cliques."
destination: GIF no README do conector Inter
aspect: 16:9
language: pt-BR
length: ~17s
---

## Intent

Um cursor percorre as telas reais do Internet Banking, já recortadas e conferidas, e clica em cada controle:
Integrar > Nova Integração, Continuar, Saldo e Extrato, termos, Continuar, código SMS, Minhas Integrações, Baixar
chave e certificado.

## Notes

- Só as capturas em `assets/`, sem dados da conta (operador e conta cobertos).
- O código SMS aparece como pontos, nunca dígitos.
- Sem texto, voz ou música: o guia já explica cada passo.

## Gerar de novo

Na raiz do repositório, depois de trocar uma captura em `assets/`:

```bash
npx --yes hyperframes@0.8.154 check connectors/inter/guide
npx --yes hyperframes@0.8.154 render connectors/inter/guide --format mp4 --fps 15 -o /tmp/criar-integracao.mp4
ffmpeg -y -i /tmp/criar-integracao.mp4 \
  -vf "fps=12,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" \
  -loop 0 connectors/inter/criar-integracao.gif
```

Os cliques ficam em `SCREENS`, no `index.html`, em pixels de cada captura.
