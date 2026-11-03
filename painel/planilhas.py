"""Planilhas lidas pelo consolidado (relidas sozinhas quando o arquivo muda):

- classificação dos pagamentos: coluna PAGAMENTOS (conta) -> coluna PARA RELATÓRIO GERAL (grupo);
- vendas do CD: aba VENDAS, só as linhas TIPO = VENDA (transferências do CD são internas);
- recibos da Flores pagos em dinheiro: aba Lançamentos, menos Caixa / Ajustes.
"""
import io
import logging
import threading

from openpyxl import load_workbook

from .config import CFG, chave_conta, normaliza, planilha

log = logging.getLogger("consolidado")
_trava = threading.Lock()

MESES_SIGLA = {"JAN": 1, "FEV": 2, "MAR": 3, "ABR": 4, "MAI": 5, "JUN": 6,
               "JUL": 7, "AGO": 8, "SET": 9, "OUT": 10, "NOV": 11, "DEZ": 12}


class ErroPlanilha(Exception):
    pass


def _ler_aba(arq, aba=None):
    """Linhas da aba (ou da primeira). Lê em memória: funciona com a planilha aberta no Excel."""
    with open(arq, "rb") as f:
        conteudo = io.BytesIO(f.read())
    wb = load_workbook(conteudo, read_only=True, data_only=True)
    try:
        if aba is None:
            ws = wb.worksheets[0]
        else:
            nome = next((n for n in wb.sheetnames if normaliza(n) == normaliza(aba)), None)
            if nome is None:
                raise ErroPlanilha(f"a planilha {arq.name} não tem a aba '{aba}'")
            ws = wb[nome]
        return [list(l) for l in ws.iter_rows(values_only=True)]
    finally:
        wb.close()


def _texto(v):
    return "" if v is None else str(v).strip()


def _numero(v):
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace(",", "."))
    except (TypeError, ValueError):
        return None


def _mes(v):
    if isinstance(v, (int, float)):
        return int(v)
    t = normaliza(v)
    if t.isdigit():
        return int(t)
    return MESES_SIGLA.get(t[:3], 0)


def _achar_cabecalho(linhas, exigidas):
    for i, l in enumerate(linhas):
        cab = [normaliza(c) for c in l]
        if all(e in cab for e in exigidas):
            return i, cab
    return -1, []


class _Arquivo:
    """Guarda o conteúdo lido de um arquivo e relê quando a data de modificação muda."""

    def __init__(self, chave, ler):
        self.chave, self.ler, self.mod, self.dados = chave, ler, None, None

    def atualizar(self):
        arq = planilha(self.chave)
        if not arq.exists():
            raise ErroPlanilha(f"planilha {arq.name} não encontrada na pasta de dados")
        mod = arq.stat().st_mtime
        if mod == self.mod:
            return False
        self.dados, self.mod = self.ler(arq), mod
        return True


# ------------------------------------------------------------------
# Classificação: conta -> grupo do relatório geral
# ------------------------------------------------------------------
def _ler_classificacao(arq):
    linhas = _ler_aba(arq)
    coluna = normaliza(CFG["planilhas"].get("coluna_grupo") or "PARA RELATÓRIO GERAL")
    i_cab, cab = _achar_cabecalho(linhas, ["PAGAMENTOS", coluna])
    if i_cab < 0:
        raise ErroPlanilha(f"a planilha de classificação precisa das colunas PAGAMENTOS e {coluna}")
    i_conta, i_grupo = cab.index("PAGAMENTOS"), cab.index(coluna)
    mapa = {}
    for l in linhas[i_cab + 1:]:
        conta = _texto(l[i_conta]) if i_conta < len(l) else ""
        grupo = _texto(l[i_grupo]) if i_grupo < len(l) else ""
        if conta and grupo:
            # chave sem espaços: "LOJA FLORES- REFORMA/OBRA" e "LOJA FLORES - REFORMA/OBRA" são a mesma conta
            mapa[chave_conta(conta)] = {"nome": " ".join(conta.split()), "grupo": " ".join(grupo.upper().split())}
    log.info("Classificação carregada: %d contas", len(mapa))
    return mapa


# ------------------------------------------------------------------
# Vendas do CD: {(ano, mes): {"venda": valor, "qtde": linhas}}
# ------------------------------------------------------------------
def _ler_vendas_cd(arq):
    linhas = _ler_aba(arq, "VENDAS")
    i_cab, cab = _achar_cabecalho(linhas, ["TIPO", "VLR FINAL", "MES", "ANO"])
    if i_cab < 0:
        raise ErroPlanilha("a aba VENDAS da planilha do CD precisa das colunas MÊS, ANO, TIPO e VLR FINAL")
    i_mes, i_ano, i_tipo, i_valor = cab.index("MES"), cab.index("ANO"), cab.index("TIPO"), cab.index("VLR FINAL")
    meses = {}
    for l in linhas[i_cab + 1:]:
        pega = lambda i: l[i] if i < len(l) else None
        if normaliza(pega(i_tipo)) != "VENDA":  # TRANSFERENCIA = interna, fica fora
            continue
        mes, ano, valor = _mes(pega(i_mes)), _numero(pega(i_ano)), _numero(pega(i_valor))
        if not (1 <= mes <= 12) or ano is None or valor is None:
            continue
        m = meses.setdefault((int(ano), mes), {"venda": 0.0, "qtde": 0})
        m["venda"] += valor
        m["qtde"] += 1
    log.info("Vendas do CD carregadas: %d mês(es)", len(meses))
    return meses


# ------------------------------------------------------------------
# Recibos da Flores: [{"data", "conta", "valor"}]
# ------------------------------------------------------------------
def _conta_recibo(r, regras, padrao):
    texto = f"{normaliza(r['descricao'])} {normaliza(r['fornecedor'])}"
    for g in regras:
        if g.get("categoria") and normaliza(g["categoria"]) != normaliza(r["categoria"]):
            continue
        if g.get("subcategoria") and normaliza(g["subcategoria"]) != normaliza(r["subcategoria"]):
            continue
        if g.get("palavras") and not any(normaliza(p) in texto for p in g["palavras"]):
            continue
        if any(normaliza(p) in texto for p in g.get("sem", [])):
            continue
        return g["conta"]
    return padrao


def _ler_recibos(arq):
    cfg = CFG.get("recibos") or {}
    aba = cfg.get("aba") or "Lançamentos"
    linhas = _ler_aba(arq, aba)
    i_cab, cab = _achar_cabecalho(linhas, ["DATA", "DESCRICAO", "CATEGORIA", "VALOR (R$)"])
    if i_cab < 0:
        raise ErroPlanilha(f"a aba {aba} da planilha de recibos precisa das colunas Data, Descrição, Categoria e Valor (R$)")
    col = {nome: i for i, nome in enumerate(cab)}
    ignorar = {normaliza(c) for c in cfg.get("ignorar_categorias", [])}
    lista = []
    for l in linhas[i_cab + 1:]:
        pega = lambda nome: l[col[nome]] if nome in col and col[nome] < len(l) else None
        data, valor = pega("DATA"), _numero(pega("VALOR (R$)"))
        if not hasattr(data, "year") or not valor:
            continue
        r = {"descricao": _texto(pega("DESCRICAO")), "categoria": _texto(pega("CATEGORIA")),
             "subcategoria": _texto(pega("SUBCATEGORIA")), "fornecedor": _texto(pega("FORNECEDOR"))}
        if normaliza(r["categoria"]) in ignorar:  # fundo de caixa e devolução: não é despesa
            continue
        lista.append({"data": data.date() if hasattr(data, "date") else data, "valor": valor,
                      "conta": _conta_recibo(r, cfg.get("regras", []), cfg.get("conta_padrao") or "OUTRAS DESPESAS")})
    log.info("Recibos da Flores carregados: %d, R$ %.2f", len(lista), sum(r["valor"] for r in lista))
    return lista


_classificacao = _Arquivo("classificacao", _ler_classificacao)
_vendas_cd = _Arquivo("vendas_cd", _ler_vendas_cd)
_recibos = _Arquivo("recibos_flores", _ler_recibos)


def atualizar():
    """Relê as planilhas que mudaram. Devolve True se alguma mudou (o cache fica velho)."""
    with _trava:
        mudou = False
        for arq in (_classificacao, _vendas_cd, _recibos):
            mudou = arq.atualizar() or mudou
        return mudou


def info_conta(conta):
    return (_classificacao.dados or {}).get(chave_conta(conta))


def vendas_cd(ano, mes):
    return (_vendas_cd.dados or {}).get((ano, mes))


def recibos():
    return _recibos.dados or []
