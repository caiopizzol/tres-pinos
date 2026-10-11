# Server

Serve as ferramentas MCP de um conector em `/mcp`, só para quem envia a chave do conector
(`Authorization: Bearer <chave>`). A chave precisa ter pelo menos 32 caracteres, e a comparação leva o mesmo
tempo acerte ou erre. Os conectores do [Sicoob](../../connectors/sicoob) e do [Inter](../../connectors/inter)
usam; os testes deles rodam o servidor de verdade.
