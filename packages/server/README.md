# Server

Serve as ferramentas MCP de um conector em `/mcp`. Os conectores do [Sicoob](../../connectors/sicoob), do
[Inter](../../connectors/inter) e da [NFS-e](../../connectors/nfse) usam.

| Acesso | Para quem                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------- |
| Chave  | Agentes na mesma máquina, com `Authorization: Bearer <chave>`. Pelo menos 32 caracteres           |
| Login  | Apps pela internet, com `publicUrl`. OAuth 2.1 com PKCE: o dono aprova cada app digitando a chave |

O login guarda os apps, códigos e tokens em `oauth.sqlite`, na pasta `dataDir`. Os tokens de acesso valem uma
hora. Os de renovação valem 30 dias e servem uma vez só.

Cada resposta de ferramenta passa por `toolAnswer`: o resultado vai em JSON, e uma falha leva só o que o conector
diz do erro, como o status HTTP. O texto da mensagem da API nunca chega ao agente.

Com `approvals`, de `createApprovals`, um conector pede a aprovação do dono para o que tem efeito legal ou
financeiro. O dono lê o pedido em `/approve/<id>` e aprova com a chave de aprovação, da qual o servidor guarda só o
SHA-256, ou recusa sem ela. Aprovar faz o trabalho ali, uma vez, e a página mostra o resultado; o agente o lê com a
ferramenta `get_approval` do conector, que usa `status`. O pedido vale uma hora, e cinco chaves erradas o apagam.
