// Página inicial: resumo das unidades, cada uma com as regras do painel por loja.
//   Faturamento total = vendas + transferências
//   Resultado (R$)    = faturamento total − pagamentos
//   Lucratividade (%) = resultado ÷ faturamento total
import "./comum.js";  // sessão, tema, menu lateral e menu do usuário
import { MESES, MESES_LONGOS, esc, moeda, pct } from "./format.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const estado = { dados: null, ano: null, mes: null };

const hoje = () => new Date(`${estado.dados.hoje}T12:00:00`);
const anoCorrente = () => estado.ano === hoje().getFullYear();
const mesLongo = (m) => MESES_LONGOS[m - 1][0].toUpperCase() + MESES_LONGOS[m - 1].slice(1);

/** Anos e meses que alguma unidade tem (o painel por loja guarda os últimos 24 meses). */
function anos() {
  return [...new Set(estado.dados.unidades.flatMap((u) => u.meses.map((m) => m.ano)))].sort((a, b) => b - a);
}
function ultimoMes(ano) {
  return Math.max(0, ...estado.dados.unidades.flatMap((u) => u.meses.filter((m) => m.ano === ano).map((m) => m.mes)));
}
const emAndamento = () => anoCorrente() && (estado.mes === 0 || estado.mes === hoje().getMonth() + 1);

/** Soma os meses do período na unidade (mês escolhido ou o ano todo). */
function periodo(u) {
  const meses = u.meses.filter((m) => m.ano === estado.ano && (estado.mes === 0 || m.mes === estado.mes));
  if (!meses.length) return null;
  const s = { vendas: 0, transferencias: 0, faturamento: 0, pagamentos: 0, sem_planilha: [] };
  for (const m of meses) {
    s.vendas += m.vendas; s.transferencias += m.transferencias; s.faturamento += m.faturamento; s.pagamentos += m.pagamentos;
    if (m.sem_planilha) s.sem_planilha.push(m.mes);
  }
  s.resultado = s.faturamento - s.pagamentos;
  s.lucratividade = s.faturamento ? s.resultado / s.faturamento : null;
  return s;
}

function nomePeriodo() {
  if (estado.mes) return `${mesLongo(estado.mes)} de ${estado.ano}`;
  return anoCorrente() ? `${estado.ano} até ${hoje().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}` : `Ano de ${estado.ano}`;
}

/** Botão que abre o relatório gerencial da unidade (painel por loja) numa aba nova. */
function botaoRelatorio(u) {
  const link = u.link || {};
  if (!link.url) return `<td class="col-link"></td>`;
  const dica = link.dica || `Abrir o relatório gerencial de ${u.nome}`;
  return `<td class="col-link"><a class="btn-relatorio" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer" title="${esc(dica)}">
    Abrir<svg class="ico"><use href="#i-abrir"/></svg></a></td>`;
}

function renderTabela() {
  const avisos = [];
  $("#linhas").innerHTML = estado.dados.unidades.map((u, i) => {
    if (!u.ok) {
      avisos.push(`<b>${esc(u.nome)}</b> não respondeu (${esc(u.erro || "erro")}). Tente de novo em alguns minutos.`);
      return `<tr class="falhou" style="--i:${i}"><th scope="row">${esc(u.nome)}</th><td colspan="5">não respondeu</td>${botaoRelatorio(u)}</tr>`;
    }
    const s = periodo(u);
    if (!s) return `<tr style="--i:${i}"><th scope="row">${esc(u.nome)}</th><td colspan="5" class="sem-dado">sem movimento no período</td>${botaoRelatorio(u)}</tr>`;
    if (s.sem_planilha.length) {
      const meses = s.sem_planilha.map((m) => `${MESES[m - 1].toLowerCase()}/${String(estado.ano).slice(2)}`).join(", ");
      avisos.push(`A planilha de vendas do <b>${esc(u.nome)}</b> não tem lançamentos em <b>${meses}</b>: o faturamento desse período aparece zerado.`);
    }
    const neg = (v) => (v < 0 ? ' class="neg"' : "");
    return `<tr style="--i:${i}">
      <th scope="row">${esc(u.nome)}</th>
      <td class="num">${moeda(s.vendas)}</td>
      <td class="num">${moeda(s.transferencias)}</td>
      <td class="num forte">${moeda(s.faturamento)}</td>
      <td class="num forte"><span${neg(s.resultado)}>${moeda(s.resultado)}</span></td>
      <td class="num forte"><span${neg(s.lucratividade)}>${pct(s.lucratividade, 2)}</span></td>
      ${botaoRelatorio(u)}
    </tr>`;
  }).join("");
  $("#avisos").innerHTML = avisos.map((a) => `<div class="aviso"><svg class="ico"><use href="#i-alerta"/></svg><div>${a}</div></div>`).join("");
}

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
      render();
    });
  }
  const ultimo = ultimoMes(estado.ano);
  const andamento = anoCorrente() ? hoje().getMonth() + 1 : 0;
  $$("button", caixa).forEach((b) => {
    const m = +b.dataset.mes;
    b.disabled = m > ultimo;
    b.classList.toggle("andamento", m === andamento);
    b.title = m === andamento ? "Mês em andamento" : "";
    b.setAttribute("aria-pressed", m === estado.mes);
  });
  posicionarIndicador(caixa);
  const sel = $("#ano");
  sel.innerHTML = anos().map((a) => `<option value="${a}">${a}</option>`).join("");
  sel.value = estado.ano;
  $("#legenda-periodo").textContent = emAndamento() ? `Em andamento: dados até ${hoje().toLocaleDateString("pt-BR")}` : "";
}

function render() {
  renderPeriodo();
  renderTabela();
  $("#contexto").innerHTML = `<b>${esc(nomePeriodo())}</b> · cada unidade como no painel por loja`;
  document.title = `Resumo das unidades · ${nomePeriodo()}`;
  const url = new URL(location.href);
  url.searchParams.set("ano", estado.ano);
  url.searchParams.set("mes", estado.mes);
  history.replaceState(null, "", url);
}

async function carregar() {
  try {
    const r = await fetch("/api/resumo", { cache: "no-store" });
    const corpo = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(corpo.erro || "Falha ao consultar as unidades.");
    estado.dados = corpo;
  } catch (e) {
    $("#contexto").textContent = "Não foi possível carregar o resumo.";
    $("#linhas").innerHTML = `<tr><td colspan="7" class="vazio-estado">${esc(e.message)}</td></tr>`;
    return;
  }
  // período: o do endereço, ou o último mês fechado (em janeiro, dezembro do ano anterior)
  const p = new URLSearchParams(location.search);
  const h = hoje();
  const anoUrl = +p.get("ano"), mesUrl = p.has("mes") ? +p.get("mes") : null;
  if (anos().includes(anoUrl)) {
    estado.ano = anoUrl;
    estado.mes = mesUrl != null && mesUrl >= 0 && mesUrl <= ultimoMes(anoUrl) ? mesUrl : ultimoMes(anoUrl);
  } else if (h.getMonth() === 0) {
    estado.ano = h.getFullYear() - 1; estado.mes = 12;
  } else {
    estado.ano = h.getFullYear(); estado.mes = h.getMonth();
  }
  render();
}

$("#ano").addEventListener("change", (ev) => {
  estado.ano = +ev.target.value;
  estado.mes = Math.min(estado.mes, ultimoMes(estado.ano)) || 0;
  render();
});
const reposicionar = () => posicionarIndicador($("#meses"));
document.fonts?.ready.then(reposicionar);
new ResizeObserver(reposicionar).observe($("#meses"));
setTimeout(() => document.body.classList.remove("entrada"), 2000);
carregar();
