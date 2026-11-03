"""Consolidado gerencial do grupo (dados ao vivo do SQL Server SISMOURA das seis unidades).

  python app.py             -> modo local: só este computador (http://localhost:PORTA)
  python app.py --producao  -> servidor da empresa: Waitress, aceita acesso da rede

Regras em config/consolidado.json; explicação em Docs/regras-para-o-consolidado.md.
"""
import io
import json
import logging
import socket
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date

from flask import Flask, Response, abort, request, send_from_directory
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from painel import consolidado, planilhas
from painel.banco import ErroBanco
from painel.config import CACHE_MINUTOS, CFG, PORTA, RAIZ, UNIDADES
from painel.planilhas import ErroPlanilha

PORTA_OCUPADA = 3
WEB = RAIZ / "web"
ANO_INICIAL = 2024

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
log = logging.getLogger("consolidado")

app = Flask(__name__, static_folder=None)
app.json.ensure_ascii = False
_unidades_pool = ThreadPoolExecutor(max_workers=len(UNIDADES), thread_name_prefix="unidade")


# ------------------------------------------------------------------
# Cache por unidade e ano: uma unidade lenta ou fora do ar não segura as outras
# ------------------------------------------------------------------
_cache, _travas, _trava_global = {}, {}, threading.Lock()


def _trava(chave):
    with _trava_global:
        return _travas.setdefault(chave, threading.Lock())


def _unidade_ano(u, ano, atualizar):
    chave = (u["slug"], ano)
    with _trava(chave):
        item = _cache.get(chave)
        if (not atualizar and item and time.time() - item["quando"] < CACHE_MINUTOS * 60
                and item["dia"] == date.today()):
            return item["dados"]
        inicio = time.time()
        try:
            dados = consolidado.dados_unidade(u, ano)
        except ErroBanco as e:
            log.warning("%s %d: %s", u["nome"], ano, e)
            return {"slug": u["slug"], "nome": u["nome"], "ok": False, "erro": str(e), "meses": []}
        except Exception:  # noqa: BLE001
            log.exception("Erro inesperado em %s %d", u["nome"], ano)
            return {"slug": u["slug"], "nome": u["nome"], "ok": False, "erro": "erro inesperado (veja o log)", "meses": []}
        log.info("%s %d: %.1fs", u["nome"], ano, time.time() - inicio)
        _cache[chave] = {"dados": dados, "quando": time.time(), "dia": date.today()}
        return dados


def _json(obj, status=200):
    return Response(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), status=status, mimetype="application/json")


def _erro(msg, status):
    return _json({"erro": msg}, status)


# ------------------------------------------------------------------
# API
# ------------------------------------------------------------------
@app.get("/api/ping")
def ping():
    return _json({"consolidado": True})


@app.get("/api/consolidado")
def api_consolidado():
    hoje = date.today()
    try:
        ano = int(request.args.get("ano", hoje.year))
    except ValueError:
        ano = -1
    if not ANO_INICIAL <= ano <= hoje.year:
        return _erro(f"Informe um ano entre {ANO_INICIAL} e {hoje.year}.", 400)
    try:
        if planilhas.atualizar():
            _cache.clear()  # planilha alterada: os números guardados ficam velhos
    except ErroPlanilha as e:
        log.error("Planilha: %s", e)
        return _erro(f"Falha ao ler a planilha: {e}.", 502)
    atualizar = request.args.get("atualizar") == "1"
    inicio = time.time()
    futuros = [_unidades_pool.submit(_unidade_ano, u, ano, atualizar) for u in UNIDADES]
    unidades = [f.result() for f in futuros]
    log.info("Consolidado %d: %.1fs (%s)", ano, time.time() - inicio,
             ", ".join(u["nome"] + ("" if u["ok"] else " FALHOU") for u in unidades))
    return _json({
        "ano": ano,
        "nome_grupo": CFG.get("nome_grupo", "Consolidado"),
        "hoje": hoje.isoformat(),
        "ultimo_mes": consolidado.periodo(ano)[2],
        "anos": list(range(hoje.year, ANO_INICIAL - 1, -1)),
        "cards_externos": consolidado.cards_externos(),
        "nao_classificados": consolidado.NAO_CLASSIFICADOS,
        "atualizado_em": consolidado.agora_iso(),
        "unidades": unidades,
    })


@app.post("/api/exportar")
def exportar():
    """Recebe a tabela já montada pela página e devolve o Excel (.xlsx)."""
    d = request.get_json(silent=True) or {}
    colunas, linhas = d.get("colunas") or [], d.get("linhas") or []
    if not (isinstance(colunas, list) and isinstance(linhas, list)) or len(linhas) > 5000:
        return _erro("Tabela inválida.", 400)
    wb = Workbook()
    ws = wb.active
    ws.title = "Consolidado"
    ws.append([str(d.get("titulo", "Consolidado"))[:200]])
    ws["A1"].font = Font(bold=True, size=14)
    ws.append([str(d.get("subtitulo", ""))[:200]])
    ws["A2"].font = Font(color="666666")
    ws.append([])
    ws.append([str(c)[:80] for c in colunas])
    cab = ws.max_row
    for c in ws[cab]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="1F2937")
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    for l in linhas:
        valores = l.get("valores") if isinstance(l, dict) else None
        if not isinstance(valores, list):
            continue
        ws.append([str(l.get("rotulo", ""))[:200]] + [v if isinstance(v, (int, float)) else None for v in valores])
        tipo = l.get("tipo")
        for i, c in enumerate(ws[ws.max_row]):
            if i == 0:
                c.alignment = Alignment(indent=2 if tipo == "conta" else 0)
            else:
                c.number_format = '0.0%' if (i % 2 == 0) else '#,##0.00'
            if tipo in ("total", "resultado"):
                c.font = Font(bold=True)
                c.fill = PatternFill("solid", fgColor="EEF0F3")
            elif tipo == "conta":
                c.font = Font(color="555555", size=10)
    ws.column_dimensions["A"].width = 46
    for i in range(2, len(colunas) + 1):
        ws.column_dimensions[get_column_letter(i)].width = 16 if i % 2 == 0 else 9
    ws.freeze_panes = ws.cell(row=cab + 1, column=2)
    saida = io.BytesIO()
    wb.save(saida)
    nome = "".join(ch for ch in str(d.get("arquivo", "consolidado")) if ch.isalnum() or ch in "-_") or "consolidado"
    return Response(saida.getvalue(), mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{nome}.xlsx"'})


# ------------------------------------------------------------------
# Páginas: só a pasta web/ (o .env, config/ e dados/ nunca são servidos)
# ------------------------------------------------------------------
@app.get("/")
def inicio():
    return send_from_directory(WEB, "index.html")


@app.get("/assets/<path:arquivo>")
def assets(arquivo):
    return send_from_directory(WEB / "assets", arquivo)


@app.errorhandler(404)
def nao_encontrado(_):
    return _erro("Não encontrado.", 404) if request.path.startswith("/api/") else ("Página não encontrada.", 404)


@app.after_request
def cabecalhos(resp):
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "no-referrer"
    return resp


def porta_em_uso(porta):
    with socket.socket() as s:
        s.settimeout(1)
        return s.connect_ex(("127.0.0.1", porta)) == 0


if __name__ == "__main__":
    if porta_em_uso(PORTA):
        print(f"ERRO: a porta {PORTA} já está em uso.", file=sys.stderr)
        sys.exit(PORTA_OCUPADA)
    log.info("Unidades: %s", ", ".join(u["nome"] for u in UNIDADES))
    if "--producao" in sys.argv:
        from waitress import serve
        log.info("Escutando na rede: http://%s:%d", socket.gethostname(), PORTA)
        serve(app, host="0.0.0.0", port=PORTA, threads=8, ident="consolidado")
    else:
        log.info("Consolidado local: http://localhost:%d", PORTA)
        app.run(host="127.0.0.1", port=PORTA, debug=False, threaded=True)
