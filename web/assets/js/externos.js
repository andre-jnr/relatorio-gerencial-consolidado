// Pagamentos externos lançamento por lançamento (todas as unidades), com as colunas da página
// Pagamentos do painel por loja, mais Unidade e Card. Os cards no topo filtram a lista.
import "./comum.js";  // sessão, tema, menu lateral e menu do usuário
import { MESES, MESES_LONGOS, compacto, esc, moeda } from "./format.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const estado = { dados: null, ano: null, mes: null, card: "", busca: "", ordem: { col: "pagamento", dir: "desc" } };
const cache = new Map();

const COLUNAS = [
  { col: "codigo", rotulo: "Código", tipo: "num" },
  { col: "unidade", rotulo: "Unidade" },
  { col: "fornecedor", rotulo: "Fornecedor" },
  { col: "conta", rotulo: "Conta" },
  { col: "emissao", rotulo: "Emissão", tipo: "data" },
  { col: "pagamento", rotulo: "Pagamento", tipo: "data" },
  { col: "vencimento", rotulo: "Vencimento", tipo: "data" },
  { col: "valor_pago", rotulo: "Valor pago", tipo: "valor" },
  { col: "observacao", rotulo: "Observação", classe: "col-obs" },
  { col: "origem", rotulo: "Origem" },
  { col: "card", rotulo: "Card" },
];

const hoje = () => new Date(`${estado.dados?.hoje || new Date().toISOString().slice(0, 10)}T12:00:00`);
const anoCorrente = () => estado.ano === hoje().getFullYear();
const mesLongo = (m) => MESES_LONGOS[m - 1][0].toUpperCase() + MESES_LONGOS[m - 1].slice(1);
const dataBR = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "–");
const sem = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

function nomePeriodo() {
  if (estado.mes) return `${mesLongo(estado.mes)} de ${estado.ano}`;
  return anoCorrente() ? `${estado.ano} até ${hoje().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}` : `Ano de ${estado.ano}`;
}

// ------------------------------------------------------------------
// Dados
// ------------------------------------------------------------------
async function buscar(ano, mes) {
  const chave = `${ano}-${mes}`;
  if (cache.has(chave)) return cache.get(chave);
  const r = await fetch(`/api/externos?ano=${ano}&mes=${mes}`, { cache: "no-store" });
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(corpo.erro || "Falha ao consultar os pagamentos externos.");
  cache.set(chave, corpo);
  return corpo;
}

async function carregar() {
  $("#linhas").innerHTML = `<tr><td colspan="${COLUNAS.length}" class="vazio-estado">Consultando as unidades…</td></tr>`;
  $("#rodape").innerHTML = "";
  try {
    estado.dados = await buscar(estado.ano, estado.mes);
  } catch (e) {
    $("#contexto").textContent = "Não foi possível carregar os pagamentos externos.";
    $("#linhas").innerHTML = `<tr><td colspan="${COLUNAS.length}" class="vazio-estado">${esc(e.message)}</td></tr>`;
    return;
  }
  render();
}

// ------------------------------------------------------------------
// Cards (filtro), lista e total
// ------------------------------------------------------------------
function renderCards() {
  const linhas = estado.dados.linhas;
  const porCard = new Map();
  for (const l of linhas) {
    const x = porCard.get(l.card) || { total: 0, qtde: 0 };
    x.total += l.valor_pago; x.qtde += 1;
    porCard.set(l.card, x);
  }
  // só os cards com lançamento no período, na ordem do consolidado
  const cards = estado.dados.cards.filter((c) => porCard.has(c));
  if (estado.card && !porCard.has(estado.card)) estado.card = "";
  const total = linhas.reduce((s, l) => s + l.valor_pago, 0);
  const botao = (valor, nome, t, q) => `
    <button type="button" class="card cartao-filtro hover" data-card="${esc(valor)}" aria-pressed="${estado.card === valor}">
      <span class="nome">${esc(nome)}</span>
      <span class="valor num" title="${esc(moeda(t))}">${compacto(t)}</span>
      <span class="qtde">${q} lançamento${q === 1 ? "" : "s"}</span>
    </button>`;
  $("#cards").innerHTML = botao("", "Todos os externos", total, linhas.length)
    + cards.map((c) => botao(c, c, porCard.get(c).total, porCard.get(c).qtde)).join("");
}

function filtradas() {
  const termo = sem(estado.busca.trim());
  return estado.dados.linhas.filter((l) => (!estado.card || l.card === estado.card)
    && (!termo || sem([l.codigo, l.unidade, l.fornecedor, l.conta, l.observacao, l.card, l.motivo].join(" ")).includes(termo)));
}

function ordenar(linhas) {
  const { col, dir } = estado.ordem;
  const tipo = COLUNAS.find((c) => c.col === col)?.tipo;
  const f = dir === "asc" ? 1 : -1;
  return [...linhas].sort((a, b) => {
    const va = a[col], vb = b[col];
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    const r = tipo === "num" || tipo === "valor" ? va - vb : String(va).localeCompare(String(vb), "pt-BR");
    return r * f || (b.pagamento || "").localeCompare(a.pagamento || "");
  });
}

function renderCabecalho() {
  $("#cabecalho").innerHTML = COLUNAS.map((c) => {
    const ativa = estado.ordem.col === c.col;
    const sort = ativa ? (estado.ordem.dir === "asc" ? "ascending" : "descending") : "none";
    return `<th scope="col" class="${c.tipo === "valor" || c.tipo === "num" ? "dir" : ""} ${c.classe || ""}" aria-sort="${sort}">
      <button type="button" class="ordenar${ativa ? " ativa" : ""}" data-col="${c.col}">${c.rotulo}<svg class="ico"><use href="#i-ordem"/></svg></button></th>`;
  }).join("");
}

function renderLista() {
  const linhas = ordenar(filtradas());
  const total = linhas.reduce((s, l) => s + l.valor_pago, 0);
  $("#lista-conta").textContent = `${linhas.length} lançamento${linhas.length === 1 ? "" : "s"} · ${moeda(total)}`;
  if (!linhas.length) {
    $("#linhas").innerHTML = `<tr><td colspan="${COLUNAS.length}" class="vazio-estado">${estado.dados.linhas.length ? "Nenhum lançamento com esse filtro." : `Nenhum pagamento externo em ${esc(nomePeriodo().toLowerCase())}.`}</td></tr>`;
    $("#rodape").innerHTML = "";
    return;
  }
  $("#linhas").innerHTML = linhas.map((l, i) => `<tr style="--i:${Math.min(i, 20)}">
    <td class="dir num">${l.codigo}</td>
    <td>${esc(l.unidade)}</td>
    <td class="quebra">${esc(l.fornecedor || "–")}</td>
    <td class="quebra">${esc(l.conta)}</td>
    <td class="num">${dataBR(l.emissao)}</td>
    <td class="num">${dataBR(l.pagamento)}</td>
    <td class="num">${dataBR(l.vencimento)}</td>
    <td class="dir num forte">${moeda(l.valor_pago).replace("R$ ", "")}</td>
    <td class="col-obs" title="${esc(l.observacao)}">${esc(l.observacao || "–")}</td>
    <td>${esc(l.origem)}</td>
    <td class="col-card"><span class="selo">${esc(l.card)}</span><small>${esc(l.motivo)}</small></td>
  </tr>`).join("");
  $("#rodape").innerHTML = `<tr><th scope="row" colspan="7">Total ${estado.card ? `de ${esc(estado.card)}` : "dos externos"}${estado.busca.trim() ? " (com a busca)" : ""}</th>
    <td class="dir num forte">${moeda(total).replace("R$ ", "")}</td><td colspan="3"></td></tr>`;
}

function renderAvisos() {
  $("#avisos").innerHTML = estado.dados.unidades.filter((u) => !u.ok).map((u) => `<div class="aviso erro"><svg class="ico"><use href="#i-alerta"/></svg>
    <div><b>${esc(u.nome)}</b> não respondeu (${esc(u.erro || "erro")}): os lançamentos dela estão fora da lista.</div></div>`).join("");
}

// ------------------------------------------------------------------
// Período
// ------------------------------------------------------------------
function posicionarIndicador(grupo) {
  const ativo = grupo.querySelector('button[aria-pressed="true"]');
  const ind = grupo.querySelector(".indicador");
  if (!ativo || !ind) return;
  ind.style.width = `${ativo.offsetWidth}px`;
  ind.style.transform = `translateX(${ativo.offsetLeft}px)`;
}

function renderPeriodo() {
  const caixa = $("#meses");
  if (!caixa.querySelector("button")) {
    caixa.insertAdjacentHTML("beforeend", MESES.map((m, i) => `<button type="button" data-mes="${i + 1}">${m}</button>`).join("")
      + `<span class="sep"></span><button type="button" data-mes="0">Ano</button>`);
    caixa.addEventListener("click", (ev) => {
      const b = ev.target.closest("button");
      if (!b || b.disabled) return;
      estado.mes = +b.dataset.mes;
      marcarPeriodo();
      carregar();
    });
  }
  marcarPeriodo();
}

function marcarPeriodo() {
  const caixa = $("#meses");
  const ultimo = anoCorrente() ? hoje().getMonth() + 1 : 12;
  $$("button", caixa).forEach((b) => {
    const m = +b.dataset.mes;
    b.disabled = m > ultimo;
    b.classList.toggle("andamento", anoCorrente() && m === hoje().getMonth() + 1);
    b.setAttribute("aria-pressed", m === estado.mes);
  });
  posicionarIndicador(caixa);
  const andamento = anoCorrente() && (estado.mes === 0 || estado.mes === hoje().getMonth() + 1);
  $("#legenda-periodo").textContent = andamento ? `Em andamento: dados até ${hoje().toLocaleDateString("pt-BR")}` : "";
}

function render() {
  const sel = $("#ano");
  if (!sel.options.length) sel.innerHTML = estado.dados.anos.map((a) => `<option value="${a}">${a}</option>`).join("");
  sel.value = estado.ano;
  marcarPeriodo();
  renderAvisos();
  renderCards();
  renderCabecalho();
  renderLista();
  const total = estado.dados.linhas.reduce((s, l) => s + l.valor_pago, 0);
  $("#contexto").innerHTML = `<b>${esc(nomePeriodo())}</b> · ${estado.dados.linhas.length} lançamentos · ${esc(moeda(total))} em pagamentos externos`;
  document.title = `Pagamentos externos · ${nomePeriodo()}`;
  const url = new URL(location.href);
  url.searchParams.set("ano", estado.ano);
  url.searchParams.set("mes", estado.mes);
  if (estado.card) url.searchParams.set("card", estado.card); else url.searchParams.delete("card");
  history.replaceState(null, "", url);
}

// ------------------------------------------------------------------
// Controles
// ------------------------------------------------------------------
$("#cards").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-card]");
  if (!b) return;
  estado.card = b.dataset.card;
  $$("[data-card]", $("#cards")).forEach((x) => x.setAttribute("aria-pressed", x === b));
  render();
});
$("#cabecalho").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-col]");
  if (!b) return;
  const col = b.dataset.col;
  const tipo = COLUNAS.find((c) => c.col === col)?.tipo;
  estado.ordem = estado.ordem.col === col
    ? { col, dir: estado.ordem.dir === "asc" ? "desc" : "asc" }
    : { col, dir: tipo === "valor" || tipo === "data" ? "desc" : "asc" };
  renderCabecalho();
  renderLista();
});
let espera;
$("#busca").addEventListener("input", (ev) => {
  clearTimeout(espera);
  espera = setTimeout(() => { estado.busca = ev.target.value; renderLista(); }, 150);
});
$("#ano").addEventListener("change", (ev) => {
  estado.ano = +ev.target.value;
  const ultimo = estado.ano === new Date().getFullYear() ? new Date().getMonth() + 1 : 12;
  estado.mes = Math.min(estado.mes, ultimo);
  marcarPeriodo();
  carregar();
});
const reposicionar = () => posicionarIndicador($("#meses"));
document.fonts?.ready.then(reposicionar);
new ResizeObserver(reposicionar).observe($("#meses"));
setTimeout(() => document.body.classList.remove("entrada"), 2000);

// período e card do endereço (vindo de um card do Consolidado); sem período: o mês atual
const p = new URLSearchParams(location.search);
const agora = new Date();
const anoUrl = +p.get("ano"), mesUrl = p.has("mes") ? +p.get("mes") : null;
estado.ano = anoUrl >= 2024 && anoUrl <= agora.getFullYear() ? anoUrl : agora.getFullYear();
const ultimoUrl = estado.ano === agora.getFullYear() ? agora.getMonth() + 1 : 12;
estado.mes = mesUrl != null && mesUrl >= 0 && mesUrl <= ultimoUrl ? mesUrl : (estado.ano === agora.getFullYear() ? agora.getMonth() + 1 : 12);
estado.card = p.get("card") || "";
renderPeriodo();
carregar();
