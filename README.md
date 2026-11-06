# Consolidado gerencial do grupo

Painel de uma página que soma as seis unidades (Parque Dez, Flores, Ponta Negra, Morada do Sol, Monte das Oliveiras e CD) **como uma empresa só**, com dados ao vivo do SQL Server (SISMOURA).
As regras seguem `Docs/regras-para-o-consolidado.md`. Esse documento tem dados confidenciais e fica só local: está no `.gitignore` e não vai para o git. O resumo das regras está mais abaixo.

- **Porta:** 3011 (`PORT` no `.env`).
- **Tecnologia:** Python 3.10+, Flask (Waitress no servidor), `mssql-python` e `openpyxl`. A mesma base do painel por loja.

## Usar no próprio computador

1. Crie o `.env` a partir do `.env.example` (mesmas credenciais do painel por loja).
2. `pip install -r requirements.txt`
3. Crie o primeiro superusuário (só na primeira vez): `python -m painel.usuarios criar-super`
4. Clique duas vezes em `Abrir Consolidado.bat` ou rode `python app.py` e abra http://localhost:3011.

## Publicar no servidor (Windows)

1. Copie a pasta do projeto para o servidor, **incluindo as planilhas de `dados/`** (`classificação_pagamentos.xlsx`, `base_dados_cd.xlsx` e `recibos_loja_flores.xlsx`, que não vão para o git). Se o painel por loja estiver na mesma máquina, pode apontar `PASTA_DADOS` para a pasta `dados/` dele em vez de copiar.
2. Tenha o Python 3.10 ou mais novo instalado (marque *Add python.exe to PATH*).
3. Crie o `.env` a partir do `.env.example`, com as credenciais do banco.
4. Crie o primeiro superusuário no servidor, na pasta do projeto: `python -m painel.usuarios criar-super`. Se preferir levar os usuários já cadastrados, copie também o `dados/usuarios.db`.
5. Clique duas vezes em `servidor\instalar.bat` e confirme o pedido de administrador.

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
| Parque Dez | sem as 4 contas LOJA FLORES e sem os pagamentos com "FLORES -" na observação (vão para a Flores, na conta em que foram lançados) |
| Flores | vendas do banco da Flores. Pagamentos: só as 4 contas LOJA FLORES do banco da Parque Dez + recibos da planilha (menos Caixa / Ajustes). As contas a pagar do banco da Flores nunca entram |
| CD | energia a 60%; lançamento 1987 (FALCAO) fora e não mostrado |
| FALCAO INDUSTRIA NF | fora e não mostrada |
| Ponta Negra 90097 e Parque Dez 146333 | saem da operação e entram como externo em INVESTIMENTO/ COMPRA DE IMÓVEL |
| Despesas dos sócios e da família | Parque Dez: fornecedores SUL AMERICA (plano de saúde) e JC, conta INSS - SOCIOS e observações que citam Dona Silvia, Sr. Jarbas ou Sr. Eduardo (menos autorizações, retiradas e compras para a loja). Entram como externo no card JC GARCIA + Sócios |
| Externos | as contas de `contas_externas`. O card **JC GARCIA + Sócios** junta DESPESA JC GARCIA, DISTRIBUIÇÃO DE SÓCIOS, HAVERES/ FRIGORIFICO PARA JC PART, tudo pago à JC PARTICIPAÇÕES e as despesas dos sócios e da família |
| Fornecedores externos | tudo pago a um fornecedor de `externos_fornecedores` é externo, em qualquer conta. Hoje: JC PARTICIPAÇÕES LTDA (código 3252 no banco da Parque Dez), no card da JC Garcia |
| Grupos | coluna PARA RELATÓRIO GERAL da `classificação_pagamentos.xlsx`; conta fora dela: NÃO CLASSIFICADOS |
| Transferências | notas emitidas, CD → lojas, CD → Flores e saídas TRANSF LOJA FLORES: fora de tudo |

Tudo isso está em `config/consolidado.json`. Para mudar uma regra (nova conta externa, novo lançamento a tratar), altere o arquivo e reinicie o painel.

As regras que tiram pagamentos de uma loja são **as mesmas do painel por loja** (`config/unidades.json` de lá). Quando uma regra nova for criada lá, ela precisa ser trazida para cá, senão o valor fica na loja errada ou entra como despesa normal.

**Conferido em 06/11/2026, janeiro a outubro de 2026, mês a mês:** a operação de cada unidade bate, ao centavo, com os pagamentos do painel por loja menos as transferências internas; e tudo o que foi pago pelo banco da Parque Dez aparece uma vez só (na Parque Dez, na Flores ou nos externos).

## Planilhas

Ficam em `dados/` (não vão para o git): `classificação_pagamentos.xlsx`, `base_dados_cd.xlsx` e `recibos_loja_flores.xlsx`. São relidas sozinhas quando o arquivo muda.
Hoje são **cópias** das planilhas do painel por loja. Para usar sempre as mesmas (inclusive as trocadas pelo botão de envio daquele painel), aponte `PASTA_DADOS` no `.env` para a pasta `dados/` dele, se os dois rodarem na mesma máquina.

## Onde fica cada coisa

```
app.py                   servidor web (login, API, cache por unidade, exportação Excel)
servidor/                scripts de instalação no servidor Windows (só o config.ps1 é deste sistema)
painel/usuarios.py       usuários (SQLite em dados/usuarios.db, senhas só em hash)
painel/consolidado.py    consultas SQL e montagem por unidade e mês
painel/planilhas.py      classificação, vendas do CD e recibos da Flores
painel/banco.py          consultas somente leitura (READ UNCOMMITTED, rollback no fim)
config/consolidado.json  unidades e regras. Sem senhas
web/                     página, CSS e JS (única pasta entregue ao navegador)
```

## Segurança

- As senhas do banco ficam só no `.env`. O navegador nunca recebe servidor, banco ou usuário; erros mostram só o motivo resumido.
- Mantenha o acesso só na rede interna: o painel usa `http` (sem `https`) e mostra o resultado de todo o grupo.

## Login e usuários

Funciona como no painel por loja, mas com **usuários próprios**. O consolidado mostra o grupo todo, então quem entra no painel por loja não entra aqui sem ser cadastrado.

- Todas as páginas e a API exigem login. Sem sessão, a página vai para `/login` e volta ao mesmo endereço depois de entrar; a API responde 401. Ficam livres só a tela de login, os arquivos de `web/assets` e o `/api/ping` (usado pelo instalador).
- Os usuários ficam em `dados/usuarios.db` (SQLite, fora do git). As senhas são guardadas só em hash (scrypt): ninguém consegue ver a senha de outro usuário.
- O **superusuário** vê o item **Usuários** no menu lateral. Ali ele cadastra, redefine senhas, ativa e desativa, dá ou tira o acesso de superusuário e exclui. Sempre fica pelo menos um superusuário ativo, e ninguém desativa nem exclui o próprio usuário.
- Qualquer usuário troca a própria senha pelo menu com o nome dele, no rodapé do menu lateral. Ali também fica o **Sair**.
- Desativar um usuário ou redefinir a senha dele encerra as sessões abertas na hora.
- O login não diferencia maiúsculas nem acentos (`André` = `andre`). A sessão dura 12 horas.
- Depois de 5 tentativas erradas seguidas, o login **e o IP** ficam bloqueados por 5 minutos.
- O log registra entradas, recusas e alterações de usuários, nunca as senhas.
- O cookie de login se chama `consolidado_sessao`, diferente do painel por loja: os dois podem rodar no mesmo servidor sem um derrubar a sessão do outro. Ele é assinado com `SECRET_KEY` do `.env`; sem ela, o painel cria uma chave em `dados/.chave_sessao`.
- Perdeu o `dados/usuarios.db`? Crie outro superusuário pelo terminal: `python -m painel.usuarios criar-super`.
