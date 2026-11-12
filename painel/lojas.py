"""Resumo das unidades com o código do painel por loja (Relatório gerencial HTML).

O resumo mostra cada unidade como no painel dela: vendas, transferências, faturamento total,
resultado e lucratividade, com todas as regras de lá (inclusive as da Flores: transferências
marcadas pelo rodapé, notas ainda não lançadas, saídas de estoque e transferências do CD).
Para os números serem sempre os mesmos, o código daquele projeto é carregado da pasta dele
(PAINEL_LOJAS_DIR no .env; padrão: a pasta irmã "Relatório gerencial HTML"), com as regras,
as planilhas e o .env de lá. Nada é copiado para cá.
"""
import importlib
import importlib.util
import os
import sys
from pathlib import Path

from .config import CFG, RAIZ

PASTA = Path(os.getenv("PAINEL_LOJAS_DIR") or (RAIZ.parent / "Relatório gerencial HTML"))
if not PASTA.is_absolute():
    PASTA = RAIZ / PASTA
NOME = "painel_lojas"  # outro nome: este projeto também tem um pacote "painel"

_mods = None


class ErroLojas(Exception):
    """O painel por loja não foi encontrado ou não carregou."""


def _carregar():
    global _mods
    if _mods:
        return _mods
    pacote = PASTA / "painel"
    if not (pacote / "relatorios.py").exists():
        raise ErroLojas(f"o painel por loja não foi encontrado em {PASTA} (PAINEL_LOJAS_DIR no .env)")
    spec = importlib.util.spec_from_file_location(NOME, pacote / "__init__.py", submodule_search_locations=[str(pacote)])
    modulo = importlib.util.module_from_spec(spec)
    sys.modules[NOME] = modulo
    spec.loader.exec_module(modulo)
    _mods = {
        "config": importlib.import_module(f"{NOME}.config"),
        "planilhas": importlib.import_module(f"{NOME}.planilhas"),
        "relatorios": importlib.import_module(f"{NOME}.relatorios"),
        "banco": importlib.import_module(f"{NOME}.banco"),
    }
    return _mods


def unidades():
    """As unidades do resumo (slugs do painel por loja), na ordem de config/consolidado.json."""
    m = _carregar()
    todas = m["config"].TODAS
    return [todas[s] for s in CFG.get("resumo_unidades", []) if s in todas]


def atualizar_planilhas():
    """Relê as planilhas do painel por loja que mudaram. True se alguma mudou."""
    m = _carregar()
    return m["planilhas"].atualizar(unidades())


def dados(u):
    """Meses da unidade calculados pelo painel por loja: vendas, transferências, faturamento e pagamentos."""
    m = _carregar()
    try:
        d = m["relatorios"].dados_unidade(u)
    except m["banco"].ErroBanco as e:
        return {"slug": u["slug"], "nome": u["nome"], "ok": False, "erro": str(e), "meses": []}
    return {
        "slug": u["slug"], "nome": u["nome"], "ok": True, "planilha_vendas": d["planilha_vendas"],
        "meses": [{"ano": x["ano"], "mes": x["mes"], "vendas": x["total_vendas"], "transferencias": x["total_transferencias"],
                   "faturamento": x["faturamento_total"], "pagamentos": x["pagamentos"], "sem_planilha": x["sem_planilha"]}
                  for x in d["meses"]],
    }
