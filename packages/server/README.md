# Server

Serve as ferramentas MCP de um conector em `/mcp`. Os conectores do [Sicoob](../../connectors/sicoob) e do
[Inter](../../connectors/inter) usam.

| Acesso | Para quem                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------- |
| Chave  | Agentes na mesma máquina, com `Authorization: Bearer <chave>`. Pelo menos 32 caracteres           |
| Login  | Apps pela internet, com `publicUrl`. OAuth 2.1 com PKCE: o dono aprova cada app digitando a chave |

O login guarda os apps, códigos e tokens em `oauth.sqlite`, na pasta `dataDir`. Os tokens de acesso valem uma
hora. Os de renovação valem 30 dias e servem uma vez só.
