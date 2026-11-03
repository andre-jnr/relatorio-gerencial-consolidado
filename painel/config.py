"""Configuração do consolidado: .env (porta e credenciais) + config/consolidado.json (regras).

Nada daqui vai para o navegador, a não ser slug e nome das unidades.
"""
import json
import os
import re
import unicodedata
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


def _ler_env():
    """Carrega o .env da pasta do projeto (sem sobrescrever variáveis já definidas no ambiente)."""
    arq = RAIZ / ".env"
    if not arq.exists():
        return
    for linha in arq.read_text(encoding="utf-8-sig").splitlines():
        linha = linha.strip()
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        nome, valor = linha.split("=", 1)
        os.environ.setdefault(nome.strip(), valor.strip().strip('"').strip("'"))


_ler_env()

CFG = json.loads((RAIZ / "config" / "consolidado.json").read_text(encoding="utf-8"))
PORTA = int(os.getenv("PORT", "3011"))
CACHE_MINUTOS = float(os.getenv("CACHE_MINUTOS", "15"))
# Pasta das planilhas (classificação, vendas do CD e recibos da Flores). Pode apontar para a
# pasta dados/ do painel por loja, para usar sempre as mesmas planilhas.
PASTA_DADOS = Path(os.getenv("PASTA_DADOS") or (RAIZ / "dados"))
if not PASTA_DADOS.is_absolute():
    PASTA_DADOS = RAIZ / PASTA_DADOS

UNIDADES = CFG["unidades"]


def lista_contas(valor):
    """"contas_flores" (nome de uma lista do topo) ou uma lista de contas."""
    if isinstance(valor, str):
        return CFG.get(valor, [])
    return valor or []


def credenciais(fonte):
    """Usuário e senha do .env. "credencial": "FLORES" usa FLORES_DB_USUARIO / FLORES_DB_SENHA."""
    prefixo = f"{fonte['credencial']}_" if fonte.get("credencial") else ""
    usuario = os.getenv(f"{prefixo}DB_USUARIO") or os.getenv("DB_USUARIO", "")
    senha = os.getenv(f"{prefixo}DB_SENHA") or os.getenv("DB_SENHA", "")
    return usuario, senha


def planilha(chave):
    return PASTA_DADOS / CFG["planilhas"][chave]


def normaliza(s):
    """Maiúsculas, sem acento e com espaços normalizados."""
    if not s:
        return ""
    s = unicodedata.normalize("NFD", str(s))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s).strip().upper()


def chave_conta(s):
    """Mesma regra do SQL: sem maiúsculas, acentos nem espaços."""
    return normaliza(s).replace(" ", "")
