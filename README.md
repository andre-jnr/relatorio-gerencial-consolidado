# Consolidado gerencial do grupo

Painel de uma página que soma as seis unidades (Parque Dez, Flores, Ponta Negra, Morada do Sol, Monte das Oliveiras e CD) **como uma empresa só**, com dados ao vivo do SQL Server (SISMOURA).
As regras seguem `Docs/regras-para-o-consolidado.md`. Esse documento tem dados confidenciais e fica só local: está no `.gitignore` e não vai para o git. O resumo das regras está mais abaixo.

- **Porta:** 3011 (`PORT` no `.env`).
- **Tecnologia:** Python 3.10+, Flask (Waitress no servidor), `mssql-python` e `openpyxl`. A mesma base do painel por loja.

## Usar no próprio computador

1. Crie o `.env` a partir do `.env.example` (mesmas credenciais do painel por loja).
2. `pip install -r requirements.txt`
3. Clique duas vezes em `Abrir Consolidado.bat` ou rode `python app.py` e abra http://localhost:3011.

## Publicar no servidor (Windows)

1. Copie a pasta do projeto para o servidor, **incluindo as planilhas de `dados/`** (`classificação_pagamentos.xlsx`, `base_dados_cd.xlsx` e `recibos_loja_flores.xlsx`, que não vão para o git). Se o painel por loja estiver na mesma máquina, pode apontar `PASTA_DADOS` para a pasta `dados/` dele em vez de copiar.
2. Tenha o Python 3.10 ou mais novo instalado (marque *Add python.exe to PATH*).
3. Crie o `.env` a partir do `.env.example`, com as credenciais do banco.
4. Clique duas vezes em `servidor\instalar.bat` e confirme o pedido de administrador.

O servidor precisa alcançar os bancos das seis unidades (Parque Dez, Flores, Ponta Negra, Morada do Sol, Monte das Oliveiras e CD).
Sobe sozinho ao ligar o computador (tarefa agendada "Consolidado gerencial (3011)"), reinicia se cair,
e fica acessível em http://NOME-DO-SERVIDOR:3011. Log: `logs\servidor.log`.
Para atualizar: copie os arquivos novos e rode o `instalar.bat` de novo.
Para remover: `servidor\desinstalar.bat` (não apaga dados).

## O que o painel mostra

| Bloco | Conteúdo |
|---|---|
| 01 Operação do grupo | vendas, pagamentos, resultado e lucratividade **sem** os externos |
| 02 Com pagamentos externos | externos (total e um card por conta), total de pagamentos, resultado e lucratividade **com** os externos |
| 03 Evolução no ano | lucratividade, resultado ou vendas × pagamentos mês a mês (duas linhas) e pagamentos por grupo |
| 04 Unidades | cada loja: vendas, participação, pagamentos, resultado e lucratividade |
| 05 Resultado por grupo | valor e % das vendas por unidade; clique num grupo para abrir as contas |

- O painel abre no último mês fechado. Escolha qualquer mês ou o ano inteiro. Trocar de mês não consulta o banco de novo: o ano inteiro vem numa consulta só.
- As comparações são com o mês anterior (janeiro: dezembro do ano anterior) ou com o ano anterior. Um período em andamento aparece como **Parcial**, sem comparação, para não comparar dias com um mês inteiro.
- Os avisos no topo mostram: unidade que não respondeu (fica fora dos totais), mês sem vendas na planilha do CD e contas fora da planilha de classificação (NÃO CLASSIFICADOS).
- **Excel** baixa a tabela por grupo, com as contas. **PDF** abre a impressão em A4 paisagem; escolha "Salvar como PDF".
- Tema claro, escuro ou automático (segue o Windows). As animações respeitam a opção "reduzir movimento" do sistema.

## Regras (resumo)

| Item | Regra |
|---|---|
| Vendas | `SUM(Venda.Valor_Final)`, `Cancelada = 'N'`. CD: planilha, só `TIPO = VENDA` |
| Pagamentos | `SUM(Valor_Pago × fator)` por `Data_Pagamento`, sem `Conta_Corrente = 2` (transferências internas) |
| Parque Dez | sem as 4 contas LOJA FLORES |
| Flores | vendas do banco da Flores. Pagamentos: só as 4 contas LOJA FLORES do banco da Parque Dez + recibos da planilha (menos Caixa / Ajustes). As contas a pagar do banco da Flores nunca entram |
| CD | energia a 60%; lançamento 1987 (FALCAO) fora e não mostrado |
| FALCAO INDUSTRIA NF | fora e não mostrada |
| Ponta Negra 90097 | sai da operação e entra como externo em INVESTIMENTO/ COMPRA DE IMÓVEL |
| Externos | as contas de `contas_externas`; JC GARCIA + DISTRIBUIÇÃO DE SÓCIOS (com HAVERES/ FRIGORIFICO PARA JC PART) num card só |
| Fornecedores externos | tudo pago a um fornecedor de `externos_fornecedores` é externo, em qualquer conta. Hoje: JC PARTICIPAÇÕES LTDA (código 3252 no banco da Parque Dez), no card da JC Garcia |
| Grupos | coluna PARA RELATÓRIO GERAL da `classificação_pagamentos.xlsx`; conta fora dela: NÃO CLASSIFICADOS |
| Transferências | notas emitidas, CD → lojas, CD → Flores e saídas TRANSF LOJA FLORES: fora de tudo |

Tudo isso está em `config/consolidado.json`. Para mudar uma regra (nova conta externa, novo lançamento a tratar), altere o arquivo e reinicie o painel.

**Conferido em 03/11/2026, outubro/2026:** vendas e pagamentos de cada unidade batem, ao centavo, com o painel por loja menos as transferências (seção 7 do documento de regras).

## Planilhas

Ficam em `dados/` (não vão para o git): `classificação_pagamentos.xlsx`, `base_dados_cd.xlsx` e `recibos_loja_flores.xlsx`. São relidas sozinhas quando o arquivo muda.
Hoje são **cópias** das planilhas do painel por loja. Para usar sempre as mesmas (inclusive as trocadas pelo botão de envio daquele painel), aponte `PASTA_DADOS` no `.env` para a pasta `dados/` dele, se os dois rodarem na mesma máquina.

## Onde fica cada coisa

```
app.py                   servidor web (API, cache por unidade, exportação Excel)
servidor/                scripts de instalação no servidor Windows (só o config.ps1 é deste sistema)
painel/consolidado.py    consultas SQL e montagem por unidade e mês
painel/planilhas.py      classificação, vendas do CD e recibos da Flores
painel/banco.py          consultas somente leitura (READ UNCOMMITTED, rollback no fim)
config/consolidado.json  unidades e regras. Sem senhas
web/                     página, CSS e JS (única pasta entregue ao navegador)
```

## Segurança

- As senhas ficam só no `.env`. O navegador nunca recebe servidor, banco ou usuário; erros mostram só o motivo resumido.
- **Não há login.** O painel mostra o resultado de todo o grupo: mantenha o acesso só na rede interna.
