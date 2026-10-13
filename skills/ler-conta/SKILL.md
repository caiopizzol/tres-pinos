---
name: ler-conta
description: Lê os códigos de pagamento de uma conta (boleto ou Pix) num PDF ou foto. Use quando o dono pedir para ler ou conferir uma conta.
---

# Ler uma conta

Leia os códigos com o leitor do Três Pinos, nunca de olho: ele confere os dígitos verificadores.

```bash
node "$TRES_PINOS_DIR/packages/boleto/src/cli.ts" read conta.pdf
```

`$TRES_PINOS_DIR` é o repositório do Três Pinos. Se não estiver definido, peça o caminho ao dono.

A saída é `0` com pelo menos um código `confirmed`, `2` sem nenhum `confirmed` e `1` quando o arquivo não abre. Um
código com dígito verificador errado é descartado. Se `codes` vier vazio, diga ao dono que não há código para pagar,
sem tentar ler um do texto.

Se o PDF estiver trancado, peça a senha ao dono, sem adivinhar. Grave-a num arquivo só seu, sem colocá-la em nenhum
comando, onde outros programas da máquina a veriam, e apague o arquivo depois:

```bash
node "$TRES_PINOS_DIR/packages/boleto/src/cli.ts" read conta.pdf --password-file senha.txt
```

Para cada código, diga o tipo, o valor em reais, o vencimento, o código para pagar e o `status`. `unconfirmed` quer
dizer que o código veio só da imagem: o dono deve conferi-lo com a conta.

Nunca pague a conta, e nunca diga que ela é verdadeira: `confirmed` quer dizer que o código foi lido certo, não que a
cobrança é legítima.
