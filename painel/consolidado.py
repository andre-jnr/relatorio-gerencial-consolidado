"""Consolidado do grupo: as seis unidades somadas como uma empresa só (Docs/regras-para-o-consolidado.md).

  Vendas(unidade)     = SUM(Venda.Valor_Final), Cancelada = 'N'          (CD: planilha, só TIPO = VENDA)
  Pagamentos(unidade) = SUM(Contas_Pagar.Valor_Pago × fator) por Data_Pagamento
                        sem Conta_Corrente = 2 (transferências internas, em tudo, inclusive nos externos)
                        sem contas_ignoradas (FALCAO INDUSTRIA NF) e sem lancamentos_ignorados (CD 1987, PN 90097)
                        Parque Dez: sem as contas LOJA FLORES. Flores: só as contas LOJA FLORES (banco da
                        Parque Dez) + recibos da planilha. Contas a pagar do banco da Flores: nunca.
                        Parque Dez: sem os pagamentos com "FLORES -" na observação, que vão para a Flores
                        (observacao_outra_loja, como no painel por loja)
  Externos            = contas_externas (+ externos_lancamentos, ex.: PN 90097 e PD 146333 em INVESTIMENTO/ COMPRA DE IMÓVEL)
                        + tudo pago aos externos_fornecedores (ex.: JC PARTICIPAÇÕES, no card da JC Garcia)
                        + despesas_socios (fornecedores, contas e observações dos sócios e da família, como no
                          painel por loja), no card DESPESAS DOS SÓCIOS E FAMÍLIA
  Precedência: fornecedor externo > conta externa > despesa dos sócios > grupo da planilha de classificação.

Aqui só se junta tudo por unidade e mês; os totais, resultados e lucratividades (do grupo e com
os externos) são somados no navegador, para trocar de mês sem nova consulta.
Transferências (notas emitidas, CD -> lojas, estoque TRANSF LOJA FLORES) não entram em lugar nenhum.
"""
import re
from datetime import date, datetime, timedelta, timezone

from . import planilhas
from .banco import consultar_varios, num
from .config import CFG, chave_conta, lista_contas, normaliza

NAO_CLASSIFICADOS = "NÃO CLASSIFICADOS"
CONTA = "REPLACE(ISNULL(cc.Descricao, ''), ' ', '') COLLATE Latin1_General_CI_AI"
PERIODO = "DECLARE @ini DATETIME = ?; DECLARE @fim DATETIME = ?;\n"

SQL_VENDAS = PERIODO + """
SELECT MONTH(v.Data) AS Mes, SUM(v.Valor_Final) AS Valor
FROM Venda v
WHERE v.Cancelada = 'N' AND v.Data >= @ini AND v.Data < @fim
GROUP BY MONTH(v.Data);"""

SQL_PAGAMENTOS = PERIODO + f"""
SELECT MONTH(cp.Data_Pagamento) AS Mes, ISNULL(cc.Descricao, '') AS Conta, __MARCA__ AS Marca,
       SUM(ISNULL(cp.Valor_Pago, 0) * __FATOR__) AS Valor
FROM Contas_Pagar cp
LEFT JOIN Conta_Contabil cc ON cc.Codigo = cp.Conta_Contabil
WHERE cp.Data_Pagamento >= @ini AND cp.Data_Pagamento < @fim
  AND ISNULL(cp.Conta_Corrente, 0) <> 2
  AND {CONTA} NOT IN (__IGNORADAS__)
  AND cp.Codigo NOT IN (__LANCAMENTOS__)
  __CONTAS__
GROUP BY MONTH(cp.Data_Pagamento), ISNULL(cc.Descricao, '')__MARCA_GRUPO__;"""

# candidatos às regras por observação/fornecedor; o filtro fino (expressões) é feito em Python
SQL_CANDIDATOS = PERIODO + f"""
SELECT cp.Codigo, cp.Codigo_Fornecedor AS Forn, ISNULL(cc.Descricao, '') AS Conta,
       CAST(cp.Observacao AS NVARCHAR(MAX)) AS Observacao
FROM Contas_Pagar cp
LEFT JOIN Conta_Contabil cc ON cc.Codigo = cp.Conta_Contabil
WHERE cp.Data_Pagamento >= @ini AND cp.Data_Pagamento < @fim AND (__CANDIDATOS__);"""
OBS = "CAST(cp.Observacao AS NVARCHAR(MAX)) COLLATE Latin1_General_CI_AI"

SQL_LANCAMENTOS = PERIODO + """
SELECT cp.Codigo, MONTH(cp.Data_Pagamento) AS Mes, ISNULL(cp.Valor_Pago, 0) AS Valor
FROM Contas_Pagar cp
WHERE cp.Codigo IN (__CODIGOS__) AND cp.Data_Pagamento >= @ini AND cp.Data_Pagamento < @fim
  AND ISNULL(cp.Conta_Corrente, 0) <> 2;"""


def agora_iso():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _sql_texto(s):
    return "N'" + str(s).replace("'", "''") + "'"


def _lista_sql(contas):
    return ", ".join(_sql_texto(chave_conta(c)) for c in contas if c) or "N'<nenhuma>'"


def _codigos(lista):
    return ", ".join(str(int(c)) for c in lista) or "-1"  # só números


def _fator_sql(u):
    f = {chave_conta(k): float(v) for k, v in (u.get("fator_contas") or {}).items()}
    if not f:
        return "1"
    return "(CASE " + " ".join(f"WHEN {CONTA} = {_sql_texto(k)} THEN {v!r}" for k, v in f.items()) + " ELSE 1 END)"


def _fonte_pagamentos(u):
    """Banco das contas pagas: o da unidade ou o de "pagamentos_de" (Flores: banco da Parque Dez)."""
    p = u.get("pagamentos_de")
    return {"nome": u["nome"], **p} if p else u


def _externos_lancamentos(u):
    return [x for x in CFG.get("externos_lancamentos", []) if x.get("unidade") == u["slug"]]


def _externos_fornecedores(u):
    return {int(x["codigo"]): x for x in CFG.get("externos_fornecedores", []) if x.get("unidade") == u["slug"]}


def periodo(ano):
    """O ano todo, ou até hoje no ano corrente (as datas digitadas no futuro ficam fora)."""
    hoje = date.today()
    ini = date(ano, 1, 1)
    fim = min(date(ano + 1, 1, 1), hoje + timedelta(days=1))
    ultimo_mes = 12 if ano < hoje.year else hoje.month
    return datetime(ini.year, ini.month, ini.day), datetime(fim.year, fim.month, fim.day), ultimo_mes


# ------------------------------------------------------------------
# Regras que olham a observação ou o fornecedor (iguais às do painel por loja)
# ------------------------------------------------------------------
def _sql_socios(u):
    """Candidatos a despesa dos sócios e da família na unidade (fornecedores, contas e observações)."""
    regra, unidade = CFG.get("despesas_socios") or {}, u.get("despesas_socios")
    if not (regra and unidade):
        return None
    fornecedores = [int(f) for f in unidade.get("fornecedores", [])]
    partes = [f"cp.Codigo_Fornecedor IN ({_codigos(fornecedores)})" if fornecedores else "",
              f"{CONTA} IN ({_lista_sql(regra.get('contas', []))})" if regra.get("contas") else ""]
    partes += [f"{OBS} LIKE {_sql_texto('%' + p['procurar'] + '%')}" for p in regra.get("observacao", [])]
    return SQL_CANDIDATOS.replace("__CANDIDATOS__", " OR ".join(p for p in partes if p) or "1 = 0")


def _filtrar_socios(u, linhas):
    """{código: motivo}. Mesma ordem do painel por loja: fornecedor, conta, observação (com as exceções)."""
    regra, unidade = CFG["despesas_socios"], u["despesas_socios"]
    fornecedores = {int(f) for f in unidade.get("fornecedores", [])}
    nomes = unidade.get("nomes_fornecedores", {})
    contas = {chave_conta(c) for c in regra.get("contas", [])}
    padroes = [(p["nome"], re.compile(p["regex"]), [re.compile(x) for x in p.get("exceto", [])])
               for p in regra.get("observacao", [])]
    achados = {}
    for l in linhas:
        forn = int(l["Forn"]) if l["Forn"] is not None else None
        obs = normaliza(l["Observacao"])
        if forn in fornecedores:
            achados[int(l["Codigo"])] = f"fornecedor {nomes.get(str(forn), forn)}"
        elif chave_conta(l["Conta"]) in contas:
            achados[int(l["Codigo"])] = f"conta {' '.join(l['Conta'].split())}"
        else:
            for nome, expr, exceto in padroes:
                if expr.search(obs) and not any(x.search(obs) for x in exceto):
                    achados[int(l["Codigo"])] = f"observação cita {nome}"
                    break
    return achados


def _sql_obs_loja(u):
    """Candidatos a pagamento da outra loja pela observação ("FLORES - ..."), fora das contas com regra própria."""
    regra = CFG.get("observacao_outra_loja") or {}
    if not (regra.get("regex") and u.get("observacao_outra_loja") in ("excluir", "incluir")):
        return None
    com_regra = CFG.get("contas_externas", []) + CFG.get("contas_flores", []) + CFG.get("contas_ignoradas", [])
    cond = f"{CONTA} NOT IN ({_lista_sql(com_regra)}) AND {OBS} LIKE {_sql_texto('%' + regra.get('procurar', '') + '%')}"
    return SQL_CANDIDATOS.replace("__CANDIDATOS__", cond)


def _filtrar_obs_loja(linhas):
    expr = re.compile(CFG["observacao_outra_loja"]["regex"])
    return {int(l["Codigo"]) for l in linhas if expr.search(normaliza(l["Observacao"]))}


def _sql_pagamentos(u, socios=None, obs_loja=None):
    socios, obs_loja = socios or {}, obs_loja or set()
    filtro = ""
    if u.get("somente_contas"):
        filtro = f"{CONTA} IN ({_lista_sql(lista_contas(u['somente_contas']))})"
        if u.get("observacao_outra_loja") == "incluir" and obs_loja:
            filtro += f" OR cp.Codigo IN ({_codigos(sorted(obs_loja))})"
        filtro = f"AND ({filtro})"
    elif u.get("sem_contas"):
        filtro = f"AND {CONTA} NOT IN ({_lista_sql(lista_contas(u['sem_contas']))})"
    if u.get("observacao_outra_loja") == "excluir" and obs_loja:
        filtro += f" AND cp.Codigo NOT IN ({_codigos(sorted(obs_loja))})"
    lancamentos = list(u.get("lancamentos_ignorados", [])) + [x["codigo"] for x in _externos_lancamentos(u)]

    # marca de cada linha: F<código> = fornecedor externo; S<n> = despesa dos sócios (motivo n)
    casos = []
    forn = _externos_fornecedores(u)
    if forn:
        casos.append(f"WHEN cp.Codigo_Fornecedor IN ({_codigos(forn)}) THEN N'F' + CAST(cp.Codigo_Fornecedor AS NVARCHAR(20))")
    for i, motivo in enumerate(_motivos(socios)):
        codigos = sorted(c for c, m in socios.items() if m == motivo)
        casos.append(f"WHEN cp.Codigo IN ({_codigos(codigos)}) THEN N'S{i}'")
    # sem marca na unidade: coluna fixa, fora do GROUP BY (o SQL Server não agrupa por constante)
    marca = f"(CASE {' '.join(casos)} ELSE N'' END)" if casos else "N''"
    marca_grupo = f", {marca}" if casos else ""
    return (SQL_PAGAMENTOS.replace("__MARCA_GRUPO__", marca_grupo).replace("__MARCA__", marca)
            .replace("__FATOR__", _fator_sql(u))
            .replace("__IGNORADAS__", _lista_sql(CFG.get("contas_ignoradas", [])))
            .replace("__LANCAMENTOS__", _codigos(lancamentos))
            .replace("__CONTAS__", filtro))


def _motivos(socios):
    return sorted(set(socios.values()))


class _Classificador:
    """Decide onde cada conta entra: card de externo, grupo do relatório geral ou NÃO CLASSIFICADOS."""

    def __init__(self):
        self.externas = {chave_conta(c): " ".join(c.split()) for c in CFG.get("contas_externas", [])}
        self.card = {chave_conta(c): nome for nome, contas in (CFG.get("externos_agrupados") or {}).items() for c in contas}

    def __call__(self, conta):
        conta = " ".join((conta or "").split())
        k = chave_conta(conta)
        if k in self.externas:
            return "externo", self.card.get(k, self.externas[k]), self.externas[k]
        info = planilhas.info_conta(conta)
        if info:
            return "grupo", info["grupo"], info["nome"]
        return "grupo", NAO_CLASSIFICADOS, conta or "(sem conta contábil)"


def dados_unidade(u, ano):
    """Vendas, pagamentos por grupo e conta, e externos por card, mês a mês do ano."""
    ini, fim, ultimo_mes = periodo(ano)
    timeout = int(u.get("timeout", 20))

    # 1ª etapa: quais lançamentos são despesa dos sócios e quais são da outra loja pela observação
    previas = {}
    if _sql_socios(u):
        previas["socios"] = (_fonte_pagamentos(u), _sql_socios(u), (ini, fim), timeout)
    if _sql_obs_loja(u):
        previas["obs_loja"] = (_fonte_pagamentos(u), _sql_obs_loja(u), (ini, fim), timeout)
    p = consultar_varios(previas) if previas else {}
    socios = _filtrar_socios(u, p["socios"]) if "socios" in p else {}
    obs_loja = _filtrar_obs_loja(p["obs_loja"]) if "obs_loja" in p else set()

    # 2ª etapa: pagamentos (já com as marcas), vendas e lançamentos que voltam como externos
    tarefas = {"pagamentos": (_fonte_pagamentos(u), _sql_pagamentos(u, socios, obs_loja), (ini, fim), timeout)}
    if u.get("vendas", "banco") == "banco":
        tarefas["vendas"] = (u, SQL_VENDAS, (ini, fim), timeout)
    externos = _externos_lancamentos(u)
    if externos:
        sql = SQL_LANCAMENTOS.replace("__CODIGOS__", _codigos(x["codigo"] for x in externos))
        tarefas["lancamentos"] = (_fonte_pagamentos(u), sql, (ini, fim), timeout)
    r = consultar_varios(tarefas)

    meses = {m: {"mes": m, "vendas": 0.0, "grupos": {}, "externos": {}, "sem_planilha": False}
             for m in range(1, ultimo_mes + 1)}
    classifica = _Classificador()

    def soma(m, tipo, nome, conta, valor):
        if m not in meses or not valor:
            return
        destino = meses[m]["grupos" if tipo == "grupo" else "externos"].setdefault(nome, {"total": 0.0, "contas": {}})
        destino["total"] += valor
        destino["contas"][conta] = destino["contas"].get(conta, 0.0) + valor

    # vendas
    if u.get("vendas") == "planilha":
        for m in meses.values():
            p = planilhas.vendas_cd(ano, m["mes"])
            if p:
                m["vendas"] = p["venda"]
            else:
                m["sem_planilha"] = True  # mês sem linhas na planilha do CD: conta como zero e avisa
    for l in r.get("vendas", []):
        if int(l["Mes"]) in meses:
            meses[int(l["Mes"])]["vendas"] = num(l["Valor"])

    # pagamentos do banco. Precedência: fornecedor externo (card dele, em qualquer conta) > conta externa >
    # despesa dos sócios e da família (card próprio) > grupo da planilha de classificação
    fornecedores = _externos_fornecedores(u)
    motivos = _motivos(socios)
    card_socios = (CFG.get("despesas_socios") or {}).get("card") or "DESPESAS DOS SÓCIOS E FAMÍLIA"
    for l in r["pagamentos"]:
        marca, valor = l["Marca"] or "", num(l["Valor"])
        nome_conta = " ".join((l["Conta"] or "(sem conta contábil)").split())
        if marca.startswith("F"):
            f = fornecedores[int(marca[1:])]
            _, nome, _ = classifica(f["conta"])
            soma(int(l["Mes"]), "externo", nome, f"{nome_conta} ({f.get('nome') or 'fornecedor ' + str(f['codigo'])})", valor)
            continue
        tipo, nome, conta = classifica(l["Conta"])
        if tipo == "grupo" and marca.startswith("S"):
            soma(int(l["Mes"]), "externo", card_socios, f"{nome_conta} ({motivos[int(marca[1:])]})", valor)
            continue
        soma(int(l["Mes"]), tipo, nome, conta, valor)

    # lançamentos tirados da unidade que voltam como externos, na conta configurada
    conta_de = {int(x["codigo"]): x["conta"] for x in externos}
    for l in r.get("lancamentos", []):
        _, nome, conta = classifica(conta_de[int(l["Codigo"])])
        soma(int(l["Mes"]), "externo", nome, conta, num(l["Valor"]))

    # recibos pagos em dinheiro no caixa da loja
    if u.get("recibos"):
        for x in planilhas.recibos():
            if x["data"].year == ano:
                tipo, nome, conta = classifica(x["conta"])
                soma(x["data"].month, tipo, nome, conta, x["valor"])

    r2 = lambda v: round(v, 2)
    lista = []
    for m in meses.values():
        lista.append({
            "mes": m["mes"],
            "vendas": r2(m["vendas"]),
            "sem_planilha": m["sem_planilha"],
            "grupos": {g: {"total": r2(d["total"]), "contas": {c: r2(v) for c, v in d["contas"].items()}}
                       for g, d in m["grupos"].items()},
            "externos": {g: {"total": r2(d["total"]), "contas": {c: r2(v) for c, v in d["contas"].items()}}
                         for g, d in m["externos"].items()},
        })
    return {"slug": u["slug"], "nome": u["nome"], "nota": u.get("nota", ""), "ok": True,
            "atualizado_em": agora_iso(), "meses": lista}


def cards_externos():
    """Ordem fixa dos cards de externos (mesmo quando o mês não tem valor)."""
    agrupadas = {chave_conta(c) for contas in (CFG.get("externos_agrupados") or {}).values() for c in contas}
    cards, vistos = [], set()
    for c in CFG.get("contas_externas", []):
        k = chave_conta(c)
        if k in agrupadas:
            nome = next(n for n, cs in CFG["externos_agrupados"].items() if k in {chave_conta(x) for x in cs})
        else:
            nome = " ".join(c.split())
        if nome not in vistos:
            vistos.add(nome)
            cards.append(nome)
    socios = CFG.get("despesas_socios") or {}
    if socios and (socios.get("card") or "DESPESAS DOS SÓCIOS E FAMÍLIA") not in vistos:
        cards.append(socios.get("card") or "DESPESAS DOS SÓCIOS E FAMÍLIA")
    return cards
