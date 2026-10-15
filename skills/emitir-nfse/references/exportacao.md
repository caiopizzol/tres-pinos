# DPS de exportação de serviço

Modelo da DPS para um serviço de desenvolvimento de software prestado no Brasil a um cliente no exterior, por uma
empresa fora do Simples Nacional: o cenário 58 da aba `EXPORTACAO_EMISSÃO_NFS-e` do Anexo I. Conferido no leiaute 1.01 e no Anexo I de 09/02/2026; se eles mudarem, mude o modelo e a data.

```xml
<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01">
  <infDPS Id="{id}">
    <tpAmb>2</tpAmb>
    <dhEmi>{agora, AAAA-MM-DDThh:mm:ss-03:00}</dhEmi>
    <verAplic>tres-pinos</verAplic>
    <serie>{série}</serie>
    <nDPS>{número}</nDPS>
    <dCompet>{competência, AAAA-MM-DD}</dCompet>
    <tpEmit>1</tpEmit>
    <cLocEmi>{município}</cLocEmi>
    <prest>
      <CNPJ>{CNPJ}</CNPJ>
      <IM>{inscrição municipal}</IM>
      <regTrib>
        <opSimpNac>1</opSimpNac>
        <regEspTrib>0</regEspTrib>
      </regTrib>
    </prest>
    <toma>
      <NIF>{NIF do cliente}</NIF>
      <xNome>{nome do cliente}</xNome>
      <end>
        <endExt>
          <cPais>{país, ISO de 2 letras}</cPais>
          <cEndPost>{código postal}</cEndPost>
          <xCidade>{cidade}</xCidade>
          <xEstProvReg>{estado}</xEstProvReg>
        </endExt>
        <xLgr>{logradouro}</xLgr>
        <nro>{número}</nro>
        <xBairro>{bairro}</xBairro>
      </end>
    </toma>
    <serv>
      <locPrest>
        <cLocPrestacao>{município}</cLocPrestacao>
      </locPrest>
      <cServ>
        <cTribNac>010401</cTribNac>
        <xDescServ>{descrição}</xDescServ>
        <cNBS>115021000</cNBS>
      </cServ>
      <comExt>
        <mdPrestacao>1</mdPrestacao>
        <vincPrest>0</vincPrest>
        <tpMoeda>220</tpMoeda>
        <vServMoeda>{valor em dólar, 0.00}</vServMoeda>
        <mecAFComexP>01</mecAFComexP>
        <mecAFComexT>01</mecAFComexT>
        <movTempBens>1</movTempBens>
        <mdic>0</mdic>
      </comExt>
    </serv>
    <valores>
      <vServPrest>
        <vServ>{valor em reais, 0.00}</vServ>
      </vServPrest>
      <trib>
        <tribMun>
          <tribISSQN>3</tribISSQN>
          <cPaisResult>{país do cliente}</cPaisResult>
          <tpRetISSQN>1</tpRetISSQN>
        </tribMun>
        <totTrib>
          <pTotTrib>
            <pTotTribFed>{tributos federais, %}</pTotTribFed>
            <pTotTribEst>0.00</pTotTribEst>
            <pTotTribMun>0.00</pTotTribMun>
          </pTotTrib>
        </totTrib>
      </trib>
    </valores>
  </infDPS>
</DPS>
```

- **Id:** `DPS`, o município (7 dígitos), `2` (CNPJ), o CNPJ, a série com 5 dígitos e o número com 15, completando com
  zeros à esquerda.
- **Competência:** a data da prestação do serviço, que o leiaute pede mas não diz como escolher num período. Pergunte ao
  dono qual data usar, como o último dia do período ou a data da invoice. Não pode ser depois de `dhEmi`.
- **Descrição:** `Invoice {número}, de {data}. Serviço de {início} a {fim}. USD {valor} x {cotação} (PTAX de compra de
  {data da cotação}) = R$ {valor em reais}.`
- **Local:** o modelo é para serviço feito no município da empresa, com o resultado no país do cliente. Confirme com o
  dono; se o serviço foi feito no exterior, diga que o modelo ainda não cobre o caso e pare.
- **Texto:** escape `&`, `<` e `>` (como `&amp;`, `&lt;` e `&gt;`) no texto tirado da invoice, como o nome do cliente.
- **Endereço:** o da invoice. Se faltar uma parte obrigatória, pergunte ao dono.
- **Dólar:** o modelo só cobre invoices em dólar. Para outra moeda, diga ao dono que ainda não cobre e pare.

| Campo                          | Valor e motivo                                                                                                                         | Fonte                                                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `serie`                        | de 00001 a 49999, a faixa do aplicativo próprio                                                                                        | Anexo I, `LEIAUTE DPS_NFS-e` (linha 106) e regra E0010                                                                          |
| `dCompet`                      | a data da prestação do serviço, até `dhEmi`                                                                                            | Anexo I, `LEIAUTE DPS_NFS-e` (linha 108) e regra E0015                                                                          |
| `opSimpNac`                    | 1, não optante; deve bater com o cadastro do Simples                                                                                   | Anexo I, `LEIAUTE DPS_NFS-e` (linha 141)                                                                                        |
| `regEspTrib`                   | 0: exportação não admite regime especial                                                                                               | Anexo I, `RN DPS_NFS-e`, regra de `regEspTrib` para `tribISSQN` 2, 3 ou 4                                                       |
| `NIF`                          | o do cliente, se a invoice trouxer. Sem ele, use o que o dono disser, como `0`. `cNaoNIF` 0 é recusado                                 | Anexo I, regra E0226                                                                                                            |
| `endExt`                       | obrigatório com NIF e prestador com CNPJ                                                                                               | Anexo I, regra E0242                                                                                                            |
| `cTribNac`                     | 010401, elaboração de programas de computador                                                                                          | Anexo I, `MUN.INCID_INFO.SERV.` e [LC 116/2003](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp116.htm), subitem 1.04        |
| `cNBS`                         | 115021000; a NBS é obrigatória na exportação, e o código é a classificação do contador                                                 | Anexo I, `EXPORTACAO_EMISSÃO_NFS-e`, cenário 58                                                                                 |
| `cLocPrestacao`, `cPaisResult` | o serviço é feito no Brasil (`cPaisPrestacao` não aceita BR) e o resultado ocorre no país do cliente, obrigatório na exportação        | Anexo I, `EXPORTACAO_EMISSÃO_NFS-e`, cenário 58, e regras E0304 e E0590                                                         |
| `comExt`                       | obrigatório quando `tribISSQN` é 3. Transfronteiriço, sem vínculo, sem mecanismo de apoio, sem MDIC                                    | Anexo I, regra E0330 e `LEIAUTE DPS_NFS-e` (linhas 201 a 210)                                                                   |
| `tpMoeda`                      | 220, dólar dos Estados Unidos                                                                                                          | [Tabela de moedas do Banco Central](https://ptax.bcb.gov.br/ptax_internet/consultarTabelaMoedas.do?method=consultaTabelaMoedas) |
| `tribISSQN`                    | 3, exportação de serviço: o ISS não incide                                                                                             | [LC 116/2003, art. 2º, I](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp116.htm)                                            |
| `pTotTrib`                     | percentuais aproximados dos tributos: federais da última nota, sem ISS nem ICMS na exportação. `indTotTrib` é recusado fora do Simples | [Lei 12.741/2012, art. 1º](https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2012/lei/l12741.htm) e Anexo I, regra E0713      |
| cotação                        | PTAX de compra do Banco Central, do dia da invoice ou do último dia útil antes; regra do contador                                      | [PTAX, dados abertos do Banco Central](https://dadosabertos.bcb.gov.br/dataset/dolar-americano-usd-todos-os-boletins-diarios)   |

Anexo I: `anexo_i-sefin_adn-dps_nfse-snnfse-v1-01-20260209.xlsx`, na
[documentação técnica da NFS-e](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual).
