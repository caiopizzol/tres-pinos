# API

O que um conector usa para chegar a uma API oficial com certificado. Os conectores do
[Sicoob](../../connectors/sicoob), do [Inter](../../connectors/inter) e da [NFS-e](../../connectors/nfse) usam.

| Função             | O que faz                                                                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `certificateFetch` | Faz a requisição com o certificado do cliente (TLS mútuo). Desiste se a API passar 10 segundos sem enviar nada e não segue redirecionamentos                |
| `allowOnly`        | Só deixa sair o token do escopo de leitura e as requisições listadas. Qualquer outra, como um pagamento, é recusada antes da rede                           |
| `isGuarded`        | Diz se um fetch passou por `allowOnly`; as ferramentas se recusam a rodar sem ele                                                                           |
| `readCertificate`  | Lê o certificado e a chave das variáveis do conector. Recusa uma senha errada ou uma chave de outro certificado, e diz quando o container não tem permissão |
| `toCents`          | Converte o valor do banco, como `"-12.3"` ou `1234.5`, em centavos exatos. Recusa frações de centavo                                                        |

## Desenvolvimento

```bash
bun run test
```
