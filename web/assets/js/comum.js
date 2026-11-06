// Comum às páginas logadas: sessão expirada volta ao login, tema, menu lateral recolhível,
// menu do usuário (trocar a própria senha, sair), janelas e avisos.
import { esc } from "./format.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ------------------------------------------------------------------
// Qualquer chamada da API com 401 (sessão expirada, usuário desativado, senha trocada) leva ao login
// ------------------------------------------------------------------
const fetchOriginal = window.fetch.bind(window);
window.fetch = async (...args) => {
  const res = await fetchOriginal(...args);
  const url = String(args[0] instanceof Request ? args[0].url : args[0]);
  if (res.status === 401 && url.includes("/api/") && !url.includes("/api/login")) {
    location.href = `/login?volta=${encodeURIComponent(location.pathname + location.search)}`;
    return new Promise(() => {});  // a página está saindo: não deixa o erro aparecer
  }
  return res;
};

export async function enviar(url, metodo, dados) {
  const res = await fetch(url, { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(dados || {}) });
  const corpo = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(corpo.erro || `Erro ${res.status}`);
  return corpo;
}

// ------------------------------------------------------------------
// Avisos (toast) e janelas
// ------------------------------------------------------------------
export function aviso(texto, tipo = "ok") {
  let caixa = $("#avisos-flutuantes");
  if (!caixa) {
    caixa = Object.assign(document.createElement("div"), { id: "avisos-flutuantes" });
    caixa.setAttribute("aria-live", "polite");
    document.body.appendChild(caixa);
  }
  const n = document.createElement("div");
  n.className = `toast ${tipo}`;
  n.textContent = texto;
  caixa.appendChild(n);
  setTimeout(() => { n.classList.add("saindo"); n.addEventListener("animationend", () => n.remove(), { once: true }); }, 3200);
}

/** Janela com formulário. aoEnviar(FormData) salva; se lançar erro, a mensagem aparece na janela. */
export function janela(html, aoEnviar, { textoOk = "Salvar", perigo = false } = {}) {
  const dlg = document.createElement("dialog");
  dlg.className = "dialogo";
  dlg.innerHTML = `<form class="dialogo-corpo" novalidate>${html}
    <p class="form-erro" role="alert" hidden></p>
    <div class="dialogo-acoes">
      <button type="button" class="btn" data-cancelar>Cancelar</button>
      <button type="submit" class="btn primario${perigo ? " perigo" : ""}" data-ok>${esc(textoOk)}</button>
    </div></form>`;
  document.body.appendChild(dlg);
  const form = $("form", dlg), erro = $(".form-erro", dlg), ok = $("[data-ok]", dlg);
  $("[data-cancelar]", dlg).onclick = () => dlg.close();
  dlg.addEventListener("close", () => dlg.remove());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });  // clique fora fecha
  form.onsubmit = async (e) => {
    e.preventDefault();
    erro.hidden = true;
    ok.disabled = true;
    try {
      await aoEnviar(new FormData(form));
      dlg.close();
    } catch (err) {
      erro.textContent = err.message;
      erro.hidden = false;
      form.classList.remove("tremer"); void form.offsetWidth; form.classList.add("tremer");
    } finally {
      ok.disabled = false;
    }
  };
  dlg.showModal();
  return dlg;
}

function abrirMinhaSenha() {
  janela(`
    <h2>Trocar minha senha</h2>
    <p class="dialogo-sub">As outras sessões abertas com a senha antiga serão encerradas.</p>
    <label class="campo"><span>Senha atual</span><input type="password" name="atual" autocomplete="current-password" required></label>
    <label class="campo"><span>Nova senha</span><input type="password" name="nova" autocomplete="new-password" minlength="6" required></label>
    <label class="campo"><span>Repita a nova senha</span><input type="password" name="nova2" autocomplete="new-password" required></label>`,
  async (f) => {
    if (f.get("nova") !== f.get("nova2")) throw new Error("As novas senhas não conferem.");
    await enviar("/api/minha-senha", "PUT", { atual: f.get("atual"), nova: f.get("nova") });
    aviso("Senha alterada.");
  });
}

// ------------------------------------------------------------------
// Menu do usuário (no rodapé do menu lateral)
// ------------------------------------------------------------------
export const iniciais = (nome) => String(nome || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();

function montarMenuUsuario(eu) {
  const caixa = $("#usuario-menu");
  if (!caixa) return;
  caixa.innerHTML = `
    <button type="button" class="usuario-botao" aria-haspopup="menu" aria-expanded="false" title="${esc(eu.nome)}">
      <span class="avatar">${esc(iniciais(eu.nome))}</span>
      <span class="rotulo usuario-quem"><b>${esc(eu.nome)}</b><small>${eu.super ? "Superusuário" : esc(eu.login)}</small></span>
    </button>
    <div class="usuario-pop" role="menu" hidden>
      <div class="usuario-pop-cab"><b>${esc(eu.nome)}</b><small>${esc(eu.login)}${eu.super ? " · superusuário" : ""}</small></div>
      <button type="button" role="menuitem" data-acao="senha"><svg class="ico"><use href="#i-chave"/></svg>Trocar minha senha</button>
      <button type="button" role="menuitem" data-acao="sair"><svg class="ico"><use href="#i-sair"/></svg>Sair</button>
    </div>`;
  const botao = $(".usuario-botao", caixa), pop = $(".usuario-pop", caixa);
  const fechar = () => { pop.hidden = true; botao.setAttribute("aria-expanded", "false"); };
  botao.onclick = (e) => {
    e.stopPropagation();
    pop.hidden = !pop.hidden;
    botao.setAttribute("aria-expanded", String(!pop.hidden));
  };
  document.addEventListener("click", (e) => { if (!caixa.contains(e.target)) fechar(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") fechar(); });
  $('[data-acao="senha"]', pop).onclick = () => { fechar(); abrirMinhaSenha(); };
  $('[data-acao="sair"]', pop).onclick = async () => {
    try { await enviar("/api/sair", "POST"); } finally { location.href = "/login"; }
  };
}

/** Quem está logado (ou null). Mostra os itens só de superusuário e monta o menu do usuário. */
export const usuarioAtual = (async () => {
  try {
    const r = await fetch("/api/eu", { cache: "no-store" });
    if (!r.ok) return null;
    const eu = await r.json();
    $$("[data-super]").forEach((el) => { el.hidden = !eu.super; });
    montarMenuUsuario(eu);
    return eu;
  } catch { return null; }
})();

// ------------------------------------------------------------------
// Tema: claro, automático (sistema) ou escuro
// ------------------------------------------------------------------
export function aplicarTema(t) {
  if (t === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try { t === "auto" ? localStorage.removeItem("consolidado.tema") : localStorage.setItem("consolidado.tema", t); } catch { /* sem armazenamento */ }
  $$(".tema button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.tema === t));
}
$$(".tema button").forEach((b) => b.addEventListener("click", () => aplicarTema(b.dataset.tema)));
aplicarTema(document.documentElement.dataset.theme || "auto");

// ------------------------------------------------------------------
// Menu lateral recolhível (lembrado neste navegador)
// ------------------------------------------------------------------
function aplicarMenu(recolhido) {
  document.documentElement.classList.toggle("menu-recolhido", recolhido);
  const b = $("#btn-menu");
  if (!b) return;
  const texto = recolhido ? "Expandir o menu" : "Recolher o menu";
  b.setAttribute("aria-label", texto); b.title = texto;
  b.setAttribute("aria-expanded", !recolhido);
  try { recolhido ? localStorage.setItem("consolidado.menu", "recolhido") : localStorage.removeItem("consolidado.menu"); } catch { /* sem armazenamento */ }
}
$("#btn-menu")?.addEventListener("click", () => aplicarMenu(!document.documentElement.classList.contains("menu-recolhido")));
aplicarMenu(document.documentElement.classList.contains("menu-recolhido"));
