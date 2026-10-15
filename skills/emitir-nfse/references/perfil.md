# Perfil da empresa

O perfil guarda as decisões sobre a empresa que nenhuma fonte oficial tem, como a regra de competência que o contador
escolheu. Fica num arquivo do dono, fora deste repositório, porque é dado da empresa. O que uma fonte oficial informa
(CNPJ, inscrição municipal, Simples, PTAX, notas) não entra: a skill lê ao vivo.

Cada decisão diz quem aprovou, quando, e até quando vale. Depois de `revisar em`, ela conta como sem resposta.

```markdown
# Perfil: EMPRESA FICTICIA LTDA (CNPJ 00000000000191)

| Decisão          | Valor                            | Aprovado por | Em         | Revisar em |
| ---------------- | -------------------------------- | ------------ | ---------- | ---------- |
| Regime           | Lucro Presumido, competência     | o contador   | 2026-01-15 | 2027-01-31 |
| Série da DPS     | 1, só o conector emite nela      | o dono       | 2026-10-15 | 2027-10-15 |
| Competência      | último dia do período da invoice | o contador   | 2026-10-15 | 2027-01-31 |
| Cliente sem NIF  | NIF `0`                          | o contador   | 2026-10-15 | 2027-01-31 |
| Local do serviço | feito no município da empresa    | o dono       | 2026-10-15 | 2027-10-15 |
```
