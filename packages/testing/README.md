# Testing

O que os testes dos conectores usam. Fica fora das imagens: os conectores o têm só como dependência de
desenvolvimento.

| Função           | O que faz                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `certificates`   | Cria uma CA e os certificados que ela assina, numa pasta apagada no fim dos testes             |
| `fakeApi`        | Uma API falsa que, como as oficiais, só aceita um certificado de cliente assinado pela CA      |
| `runningServer`  | Roda o `server.mjs` do conector num processo próprio e espera ele responder                    |
| `refusesToStart` | Confere que o servidor se recusa a subir com cada configuração errada, com a mensagem esperada |
| `listTools`      | As ferramentas que o servidor lista para quem tem a chave                                      |
| `readmeTools`    | As ferramentas da tabela "Ferramentas" do README do conector                                   |
