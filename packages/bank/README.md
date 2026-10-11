# Bank

O que todo conector de banco usa para chegar à API oficial do banco. Os conectores do [Sicoob](../../connectors/sicoob)
e do [Inter](../../connectors/inter) usam.

| Função             | O que faz                                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `certificateFetch` | Faz a requisição com o certificado do cliente (TLS mútuo). Desiste depois de 10 segundos e não segue redirecionamentos            |
| `readOnly`         | Só deixa sair o token do escopo de leitura e as requisições listadas. Qualquer outra, como um pagamento, é recusada antes da rede |
| `isReadOnly`       | Diz se um fetch passou por `readOnly`; as ferramentas se recusam a rodar sem ele                                                  |
| `readCertificate`  | Lê o certificado ou a chave, com um erro claro quando o container não tem permissão                                               |
| `toCents`          | Converte o valor do banco, como `"-12.3"` ou `1234.5`, em centavos exatos. Recusa frações de centavo                              |

## Desenvolvimento

```bash
bun run test
```
