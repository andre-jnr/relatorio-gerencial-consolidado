"""Consolidado gerencial do grupo (dados ao vivo do SQL Server SISMOURA das seis unidades).

  python app.py             -> modo local: só este computador (http://localhost:PORTA)
  python app.py --producao  -> servidor da empresa: Waitress, aceita acesso da rede

Regras em config/consolidado.json; explicação em Docs/regras-para-o-consolidado.md.
Só quem tem login vê o painel (usuários em dados/usuarios.db; ver painel/usuarios.py).
O primeiro superusuário é criado pelo terminal:  python -m painel.usuarios criar-super
"""
import io
import json
import logging
import os
import secrets
import socket
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from urllib.parse import quote

from flask import Flask, Response, abort, redirect, request, send_from_directory, session
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from painel import consolidado, planilhas, usuarios
from painel.banco import ErroBanco
from painel.config import CACHE_MINUTOS, CFG, PORTA, RAIZ, UNIDADES
from painel.planilhas import ErroPlanilha
from painel.usuarios import ErroUsuario

PORTA_OCUPADA = 3
WEB = RAIZ / "web"
ANO_INICIAL = 2024

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
log = logging.getLogger("consolidado")

def _chave_sessao():
    """SECRET_KEY do .env; sem ela, uma chave aleatória guardada em dados/ (o login sobrevive a reinícios)."""
    if os.getenv("SECRET_KEY"):
        return os.getenv("SECRET_KEY")
    arq = RAIZ / "dados" / ".chave_sessao"
    if not arq.exists():
        arq.parent.mkdir(parents=True, exist_ok=True)
        arq.write_text(secrets.token_hex(32), encoding="ascii")
    return arq.read_text(encoding="ascii").strip()


app = Flask(__name__, static_folder=None)
app.json.ensure_ascii = False
app.secret_key = _chave_sessao()
app.config.update(
    # nome próprio: o cookie vale para todas as portas do servidor, e o painel por loja (3007) usa "painel_sessao"
    SESSION_COOKIE_NAME="consolidado_sessao",
    SESSION_COOKIE_HTTPONLY=True,      # o JavaScript da página não lê o cookie
    SESSION_COOKIE_SAMESITE="Strict",  # outro site não consegue usar a sessão
    PERMANENT_SESSION_LIFETIME=timedelta(hours=12),
)
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
# Login: tudo exige sessão, menos a tela de login, os arquivos de estilo/script e o /api/ping
# ------------------------------------------------------------------
LIVRES = {"/login", "/api/login", "/api/ping"}
PAGINAS_SUPER = {"/usuarios"}


def _usuario_atual():
    if "uid" not in session:
        return None
    return usuarios.por_sessao(session["uid"], session.get("versao"))


@app.before_request
def exigir_login():
    caminho = request.path
    if caminho in LIVRES or caminho.startswith("/assets/"):
        return None
    u = _usuario_atual()
    if not u:
        session.clear()
        if caminho.startswith("/api/"):
            return _erro("Sessão expirada. Entre de novo.", 401)
        volta = request.full_path.rstrip("?")  # volta ao mesmo endereço (inclusive ano e mês) depois do login
        volta = "" if volta == "/" else volta
        return redirect("/login" + (f"?volta={quote(volta)}" if volta else ""))
    request.usuario = u
    if (caminho.startswith("/api/usuarios") or caminho in PAGINAS_SUPER) and not u["super"]:
        return _erro("Só o superusuário pode gerenciar usuários.", 403) if caminho.startswith("/api/") else redirect("/")
    # alterações só por JSON: um formulário de outro site não consegue enviar esse tipo sem permissão (CSRF)
    if request.method in ("POST", "PUT", "PATCH", "DELETE") and not request.is_json:
        return _erro("Requisição inválida.", 400)
    return None


def _corpo():
    d = request.get_json(silent=True)
    return d if isinstance(d, dict) else {}


@app.get("/login")
def tela_login():
    if _usuario_atual():
        return redirect("/")
    return send_from_directory(WEB, "login.html")


@app.post("/api/login")
def entrar():
    if not request.is_json:
        return _erro("Requisição inválida.", 400)
    d = _corpo()
    try:
        u = usuarios.autenticar(d.get("login", ""), d.get("senha", ""), request.remote_addr)
    except ErroUsuario as e:
        log.warning("Login recusado para '%s' (%s)", usuarios.normaliza_login(d.get("login", ""))[:40], request.remote_addr)
        return _erro(str(e), 401)
    session.clear()
    session.permanent = True
    session["uid"], session["versao"] = u["id"], u["versao"]
    log.info("Login de '%s' (%s)", u["login"], request.remote_addr)
    return _json({"ok": True})


@app.post("/api/sair")
def sair():
    session.clear()
    return _json({"ok": True})


@app.get("/api/eu")
def eu():
    u = request.usuario
    return _json({"nome": u["nome"], "login": u["login"], "super": u["super"]})


@app.put("/api/minha-senha")
def minha_senha():
    d = _corpo()
    try:
        versao = usuarios.definir_senha(request.usuario["id"], d.get("nova", ""), senha_atual=d.get("atual", ""))
    except ErroUsuario as e:
        return _erro(str(e), 400)
    session["versao"] = versao  # continua logado aqui; as outras sessões caem
    log.info("'%s' trocou a própria senha", request.usuario["login"])
    return _json({"ok": True})


# ------------------------------------------------------------------
# Usuários (só superusuário)
# ------------------------------------------------------------------
@app.get("/api/usuarios")
def usuarios_listar():
    return _json(usuarios.listar())


@app.post("/api/usuarios")
def usuarios_criar():
    d = _corpo()
    try:
        uid = usuarios.criar(d.get("nome"), d.get("login"), d.get("senha"), bool(d.get("super")), request.usuario["login"])
    except ErroUsuario as e:
        return _erro(str(e), 400)
    log.info("'%s' criou o usuário %s", request.usuario["login"], usuarios.normaliza_login(d.get("login")))
    return _json({"id": uid}, 201)


@app.patch("/api/usuarios/<int:uid>")
def usuarios_alterar(uid):
    d = _corpo()
    try:
        usuarios.alterar(uid, request.usuario["id"], ativo=d.get("ativo"), super_=d.get("super"), nome=d.get("nome"))
    except ErroUsuario as e:
        return _erro(str(e), 400)
    log.info("'%s' alterou o usuário %d: %s", request.usuario["login"], uid,
             {k: v for k, v in d.items() if k in ("ativo", "super", "nome")})
    return _json({"ok": True})


@app.put("/api/usuarios/<int:uid>/senha")
def usuarios_senha(uid):
    try:
        versao = usuarios.definir_senha(uid, _corpo().get("senha", ""))
    except ErroUsuario as e:
        return _erro(str(e), 400)
    if uid == request.usuario["id"]:
        session["versao"] = versao
    log.info("'%s' redefiniu a senha do usuário %d", request.usuario["login"], uid)
    return _json({"ok": True})


@app.delete("/api/usuarios/<int:uid>")
def usuarios_excluir(uid):
    try:
        login = usuarios.excluir(uid, request.usuario["id"])
    except ErroUsuario as e:
        return _erro(str(e), 400)
    log.info("'%s' excluiu o usuário %s", request.usuario["login"], login)
    return _json({"ok": True})


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


@app.get("/usuarios")
def pagina_usuarios():
    return send_from_directory(WEB, "usuarios.html")


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
    if not usuarios.existe_algum():
        log.warning("Nenhum usuário cadastrado: crie o superusuário com  python -m painel.usuarios criar-super")
    if "--producao" in sys.argv:
        from waitress import serve
        log.info("Escutando na rede: http://%s:%d", socket.gethostname(), PORTA)
        serve(app, host="0.0.0.0", port=PORTA, threads=8, ident="consolidado")
    else:
        log.info("Consolidado local: http://localhost:%d", PORTA)
        app.run(host="127.0.0.1", port=PORTA, debug=False, threaded=True)
