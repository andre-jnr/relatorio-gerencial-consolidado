// Página "Usuários" (só superusuário): cadastrar, redefinir senha, ativar/desativar,
// dar/tirar superusuário e excluir.
import { aviso, enviar, iniciais, janela, usuarioAtual } from "./comum.js";
import { esc } from "./format.js";

const $ = (s, r = document) => r.querySelector(s);
let lista = [];
let eu = null;

const dataBR = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)} ${s.slice(11, 16)}` : "–");

// "André Luiz" -> "andre.luiz"
function sugerirLogin(nome) {
  const p = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
  return p.length > 1 ? `${p[0]}.${p[p.length - 1]}` : (p[0] || "");
}

function novo() {
  const dlg = janela(`
    <h2>Novo usuário</h2>
    <p class="dialogo-sub">Passe o login e a senha para a pessoa. Ela pode trocar a senha depois, no menu do usuário.</p>
    <label class="campo"><span>Nome</span><input name="nome" maxlength="80" required autocomplete="off"></label>
    <label class="campo"><span>Login</span><input name="login" maxlength="40" required autocomplete="off" autocapitalize="none" spellcheck="false"></label>
    <label class="campo"><span>Senha inicial</span><input name="senha" type="password" minlength="6" required autocomplete="new-password"></label>
    <label class="campo"><span>Repita a senha</span><input name="senha2" type="password" required autocomplete="new-password"></label>
    <label class="interruptor"><input type="checkbox" name="super"><span class="trilho-int" aria-hidden="true"></span><span>Superusuário (pode cadastrar outros usuários)</span></label>`,
  async (f) => {
    if (f.get("senha") !== f.get("senha2")) throw new Error("As senhas não conferem.");
    await enviar("/api/usuarios", "POST", { nome: f.get("nome"), login: f.get("login"), senha: f.get("senha"), super: f.get("super") === "on" });
    aviso(`Usuário ${f.get("login")} criado.`);
    await carregar();
  }, { textoOk: "Criar usuário" });
  const nome = $('[name="nome"]', dlg), login = $('[name="login"]', dlg);
  let editado = false;
  login.oninput = () => { editado = true; };
  nome.oninput = () => { if (!editado) login.value = sugerirLogin(nome.value); };
}

function redefinir(u) {
  janela(`
    <h2>Redefinir senha</h2>
    <p class="dialogo-sub">${esc(u.nome)} (${esc(u.login)}) sai do consolidado e entra de novo com a nova senha.</p>
    <label class="campo"><span>Nova senha</span><input name="senha" type="password" minlength="6" required autocomplete="new-password"></label>
    <label class="campo"><span>Repita a senha</span><input name="senha2" type="password" required autocomplete="new-password"></label>`,
  async (f) => {
    if (f.get("senha") !== f.get("senha2")) throw new Error("As senhas não conferem.");
    await enviar(`/api/usuarios/${u.id}/senha`, "PUT", { senha: f.get("senha") });
    aviso("Senha redefinida.");
    await carregar();
  });
}

function excluir(u) {
  janela(`
    <h2>Excluir usuário</h2>
    <p class="dialogo-sub">Excluir <strong>${esc(u.nome)}</strong> (${esc(u.login)})? Isso não pode ser desfeito. Para só bloquear o acesso, use Desativar.</p>`,
  async () => {
    await enviar(`/api/usuarios/${u.id}`, "DELETE");
    aviso("Usuário excluído.");
    await carregar();
  }, { textoOk: "Excluir", perigo: true });
}

async function alterar(u, dados, msg) {
  try {
    await enviar(`/api/usuarios/${u.id}`, "PATCH", dados);
    aviso(msg);
  } catch (e) {
    aviso(e.message, "erro");
  }
  await carregar();
}

function render() {
  const ativos = lista.filter((u) => u.ativo).length;
  const supers = lista.filter((u) => u.super && u.ativo).length;
  $("#resumo").innerHTML = [["Usuários", lista.length], ["Ativos", ativos], ["Desativados", lista.length - ativos], ["Superusuários", supers]]
    .map(([r, v], i) => `<article class="card kpi kpi-mini anima" style="--i:${i}"><span class="kpi-cab">${r}</span><div class="kpi-valor num">${v}</div></article>`).join("");

  $("#lista").innerHTML = lista.length ? lista.map((u) => {
    const proprio = eu && u.login === eu.login;
    return `<tr class="${u.ativo ? "" : "inativo"}">
      <td><span class="usuario-nome"><span class="avatar pequeno">${esc(iniciais(u.nome))}</span>${esc(u.nome)}${proprio ? " <small>(você)</small>" : ""}</span></td>
      <td>${esc(u.login)}</td>
      <td>${u.super ? '<span class="selo super">Superusuário</span>' : '<span class="selo">Usuário</span>'}</td>
      <td>${u.ativo ? '<span class="selo ativo">Ativo</span>' : '<span class="selo inativo">Desativado</span>'}</td>
      <td class="num">${dataBR(u.ultimo_acesso)}</td>
      <td>${esc(u.criado_por || "–")}</td>
      <td><div class="acoes-linha">
        <button type="button" class="btn-fantasma" data-acao="senha" data-id="${u.id}">Redefinir senha</button>
        ${proprio ? "" : `
        <button type="button" class="btn-fantasma" data-acao="super" data-id="${u.id}">${u.super ? "Tirar super" : "Tornar super"}</button>
        <button type="button" class="btn-fantasma" data-acao="ativo" data-id="${u.id}">${u.ativo ? "Desativar" : "Ativar"}</button>
        <button type="button" class="btn-fantasma perigo" data-acao="excluir" data-id="${u.id}">Excluir</button>`}
      </div></td>
    </tr>`;
  }).join("") : '<tr><td colspan="7" class="vazio-estado">Nenhum usuário.</td></tr>';
}

async function carregar() {
  try {
    const res = await fetch("/api/usuarios", { cache: "no-store" });
    const corpo = await res.json();
    if (!res.ok) throw new Error(corpo.erro || `Erro ${res.status}`);
    lista = corpo;
    render();
  } catch (e) {
    $("#lista").innerHTML = `<tr><td colspan="7" class="vazio-estado">${esc(e.message)}</td></tr>`;
  }
}

$("#btn-novo").onclick = novo;
$("#lista").addEventListener("click", (e) => {
  const b = e.target.closest("[data-acao]");
  if (!b) return;
  const u = lista.find((x) => x.id === Number(b.dataset.id));
  if (!u) return;
  if (b.dataset.acao === "senha") redefinir(u);
  if (b.dataset.acao === "excluir") excluir(u);
  if (b.dataset.acao === "ativo") alterar(u, { ativo: !u.ativo }, u.ativo ? "Usuário desativado." : "Usuário ativado.");
  if (b.dataset.acao === "super") alterar(u, { super: !u.super }, u.super ? "Agora é usuário comum." : "Agora é superusuário.");
});

setTimeout(() => document.body.classList.remove("entrada"), 2000);
eu = await usuarioAtual;
await carregar();
