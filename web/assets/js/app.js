// Consolidado do grupo: estado, somas (fórmulas da seção 5.2) e desenho da página.
//
//   Resultado do grupo      = Σ vendas − Σ pagamentos               (operação, sem externos)
//   Lucratividade do grupo  = Resultado do grupo ÷ Σ vendas
//   Total de pagamentos     = Σ pagamentos + Σ externos
//   Resultado com externos  = Σ vendas − Total de pagamentos
//   Lucratividade c/ ext.   = Resultado com externos ÷ Σ vendas
import { MESES, MESES_LONGOS, compacto, contar, esc, eixoMoeda, eixoPct, hora, moeda, moedaHero, numero, pct } from "./format.js";
import { GraficoLinhas, sparkline } from "./graficos.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const estado = {
  ano: null, mes: null, dados: null, metrica: "lucratividade",
  cache: new Map(), carregandoAnterior: new Set(), abertos: new Set(), todasAbertas: false,
};
const grafico = new GraficoLinhas($("#grafico"), $("#tooltip"));

// ------------------------------------------------------------------
// Dados
// ------------------------------------------------------------------
async function buscar(ano, atualizar = false) {
  if (!atualizar && estado.cache.has(ano)) return estado.cache.get(ano);
  const r = await fetch(`/api/consolidado?ano=${ano}${atualizar ? "&atualizar=1" : ""}`);
  let j;
  try { j = await r.json(); } catch { throw new Error("O servidor do consolidado não respondeu."); }
  if (!r.ok) throw new Error(j.erro || "Falha ao consultar o consolidado.");
  estado.cache.set(ano, j);
  return j;
}

/** Ano anterior, para comparar janeiro com dezembro e um ano fechado com o anterior. Carrega em segundo plano. */
function anoAnterior() {
  const ano = estado.ano - 1;
  if (estado.cache.has(ano)) return estado.cache.get(ano);
  if (!estado.dados.anos.includes(ano) || estado.carregandoAnterior.has(ano)) return null;
  estado.carregandoAnterior.add(ano);
  buscar(ano).then(() => render(false)).catch(() => {}).finally(() => estado.carregandoAnterior.delete(ano));
  return null;
}

const vazio = () => ({ vendas: 0, pag: 0, ext: 0, grupos: {}, externos: {}, semPlanilha: [] });

function acumular(mapa, nome, d) {
  const x = (mapa[nome] ??= { total: 0, contas: {} });
  x.total += d.total;
  for (const [c, v] of Object.entries(d.contas)) x.contas[c] = (x.contas[c] || 0) + v;
}

function juntar(destino, a) {
  destino.vendas += a.vendas; destino.pag += a.pag; destino.ext += a.ext;
  for (const [g, d] of Object.entries(a.grupos)) acumular(destino.grupos, g, d);
  for (const [g, d] of Object.entries(a.externos)) acumular(destino.externos, g, d);
}

/** Soma as unidades que responderam nos meses pedidos. */
function agregar(dados, meses) {
  const por = {}, total = vazio(), falhas = [];
  for (const u of dados.unidades) {
    if (!u.ok) { falhas.push(u); continue; }
    const a = vazio();
    for (const m of u.meses) {
      if (!meses.includes(m.mes)) continue;
      a.vendas += m.vendas;
      if (m.sem_planilha) a.semPlanilha.push(m.mes);
      for (const [g, d] of Object.entries(m.grupos)) { acumular(a.grupos, g, d); a.pag += d.total; }
      for (const [g, d] of Object.entries(m.externos)) { acumular(a.externos, g, d); a.ext += d.total; }
    }
    por[u.slug] = a;
    juntar(total, a);
  }
  return { por, total, falhas };
}

function indicadores(a) {
  const resultado = a.vendas - a.pag;
  const totalPag = a.pag + a.ext;
  const resultadoExt = a.vendas - totalPag;
  return {
    vendas: a.vendas, pagamentos: a.pag, externos: a.ext, totalPag,
    resultado, resultadoExt,
    lucratividade: a.vendas ? resultado / a.vendas : null,
    lucratividadeExt: a.vendas ? resultadoExt / a.vendas : null,
  };
}

// ------------------------------------------------------------------
// Período
// ------------------------------------------------------------------
const hoje = () => new Date(`${estado.dados.hoje}T12:00:00`);
const anoCorrente = () => estado.ano === hoje().getFullYear();
const mesesDoPeriodo = () => (estado.mes ? [estado.mes] : Array.from({ length: estado.dados.ultimo_mes }, (_, i) => i + 1));
const emAndamento = () => anoCorrente() && (estado.mes === 0 || estado.mes === estado.dados.ultimo_mes);
const indiceParcial = () => (anoCorrente() ? estado.dados.ultimo_mes - 1 : -1);
const aa = (ano) => String(ano).slice(2);

function nomePeriodo() {
  if (estado.mes) return `${MESES_LONGOS[estado.mes - 1][0].toUpperCase()}${MESES_LONGOS[estado.mes - 1].slice(1)} de ${estado.ano}`;
  return anoCorrente() ? `${estado.ano} até ${hoje().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}` : `Ano de ${estado.ano}`;
}

/** Período de comparação. Mês ou ano em andamento não é comparado (seria parcial contra inteiro). */
function comparacao() {
  if (emAndamento()) return null;
  let dados, meses, rotulo;
  if (estado.mes > 1) {
    dados = estado.dados; meses = [estado.mes - 1]; rotulo = `vs ${MESES[estado.mes - 2].toLowerCase()}/${aa(estado.ano)}`;
  } else {
    dados = anoAnterior();
    if (!dados) return null;
    meses = estado.mes === 1 ? [12] : Array.from({ length: 12 }, (_, i) => i + 1);
    rotulo = estado.mes === 1 ? `vs dez/${aa(estado.ano - 1)}` : `vs ${estado.ano - 1}`;
  }
  const ag = agregar(dados, meses);
  if (ag.falhas.length || estado.dados.unidades.some((u) => !u.ok)) return null;  // unidades diferentes: não compara
  return { ind: indicadores(ag.total), rotulo };
}

// ------------------------------------------------------------------
// KPIs
// ------------------------------------------------------------------
const KPIS_GRUPO = [
  { id: "vendas", rotulo: "Vendas", icone: "i-vendas", tipo: "moeda", melhor: "maior" },
  { id: "pagamentos", rotulo: "Pagamentos", icone: "i-pag", tipo: "moeda", melhor: "menor", cor: "--s2" },
  { id: "resultado", rotulo: "Resultado do grupo", icone: "i-resultado", tipo: "moeda", melhor: "maior", destaque: true },
  { id: "lucratividade", rotulo: "Lucratividade do grupo", icone: "i-pct", tipo: "pct", melhor: "maior" },
];
const KPIS_EXT = [
  { id: "externos", rotulo: "Pagamentos externos", icone: "i-externo", tipo: "moeda", melhor: "menor", cor: "--s2" },
  { id: "totalPag", rotulo: "Total de pagamentos", icone: "i-pag", tipo: "moeda", melhor: "menor", cor: "--s2" },
  { id: "resultadoExt", rotulo: "Resultado com externos", icone: "i-resultado", tipo: "moeda", melhor: "maior", destaque: true },
  { id: "lucratividadeExt", rotulo: "Lucratividade com externos", icone: "i-pct", tipo: "pct", melhor: "maior" },
];

function criarKpis(caixa, lista, base) {
  caixa.innerHTML = lista.map((k, i) => `
    <article class="card kpi hover anima${k.destaque ? " destaque" : ""}" style="--i:${base + i}" data-kpi="${k.id}">
      <div class="kpi-cab"><span>${k.rotulo}</span><span class="ico-box"><svg class="ico"><use href="#${k.icone}"/></svg></span></div>
      <div class="kpi-valor num">&nbsp;</div>
      <div class="kpi-rodape"><div class="kpi-comp"></div><svg class="spark" aria-hidden="true"></svg></div>
    </article>`).join("");
}

function textoDelta(k, atual, anterior) {
  if (atual == null || anterior == null) return null;
  let d, texto;
  if (k.tipo === "pct") {
    d = atual - anterior;
    texto = `${Math.abs(d * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} p.p.`;
  } else {
    if (!anterior) return null;
    d = (atual - anterior) / Math.abs(anterior);
    texto = pct(Math.abs(d));
  }
  if (Math.abs(d) < 0.0005) return { classe: "neutro", texto: "estável" };
  const subiu = d > 0;
  const bom = k.melhor === "maior" ? subiu : !subiu;
  return { classe: bom ? "bom" : "ruim", texto: `${subiu ? "▲" : "▼"} ${texto}`, titulo: bom ? "melhorou" : "piorou" };
}

function atualizarKpis(lista, ind, comp, mensal, animar) {
  const sel = estado.mes ? estado.mes - 1 : -1;
  const parcial = indiceParcial();
  for (const k of lista) {
    const card = $(`[data-kpi="${k.id}"]`);
    const valor = ind[k.id];
    const caixaValor = $(".kpi-valor", card);
    caixaValor.classList.toggle("negativo", k.tipo === "moeda" && k.id.startsWith("resultado") && valor < 0
      || k.tipo === "pct" && valor < 0);
    contar(caixaValor, valor ?? 0, (v) => (k.tipo === "pct" ? (valor == null ? "–" : pct(v)) : moedaHero(v)));
    caixaValor.title = k.tipo === "pct" ? pct(valor, 2) : moeda(valor);

    const compEl = $(".kpi-comp", card);
    if (emAndamento()) {
      compEl.innerHTML = `<span class="tag-parcial">Parcial</span><span>sem comparação</span>`;
    } else {
      const d = comp && textoDelta(k, valor, comp.ind[k.id]);
      compEl.innerHTML = d
        ? `<span class="delta ${d.classe}" title="${d.titulo || ""}">${d.texto}</span><span>${comp.rotulo}${k.tipo === "moeda" ? ` · ${compacto(comp.ind[k.id])}` : ""}</span>`
        : `<span>${comp === null && (estado.mes === 1 || estado.mes === 0) ? "&nbsp;" : "sem comparação"}</span>`;
    }
    const serie = mensal.map((m) => (m ? m[k.id] : null));
    sparkline($(".spark", card), serie, { sel, parcial, cor: `var(${k.cor || "--s1"})`, animar });
  }
}

// ------------------------------------------------------------------
// Pagamentos externos por conta
// ------------------------------------------------------------------
function renderExternos(ag) {
  const caixa = $("#externos-lista");
  const cards = estado.dados.cards_externos;
  if (caixa.children.length !== cards.length) {
    caixa.innerHTML = cards.map((c, i) => `
      <div class="card ext hover anima" style="--i:${8 + i}" data-ext="${esc(c)}">
        <div class="nome">${esc(c)}</div>
        <div class="valor num">&nbsp;</div>
        <div class="barra"><i style="transform:scaleX(0)"></i></div>
        <div class="unid"></div>
      </div>`).join("");
  }
  const maior = Math.max(1, ...cards.map((c) => ag.total.externos[c]?.total || 0));
  const unidadesOk = estado.dados.unidades.filter((u) => u.ok);
  for (const c of cards) {
    const card = caixa.querySelector(`[data-ext="${CSS.escape(c)}"]`);
    const v = ag.total.externos[c]?.total || 0;
    card.hidden = !v;  // conta sem pagamento no período: o card some
    contar($(".valor", card), v, (x) => compacto(x));
    $(".valor", card).title = moeda(v);
    $(".barra i", card).style.transform = `scaleX(${v / maior})`;
    const quem = unidadesOk.filter((u) => ag.por[u.slug]?.externos[c]?.total).map((u) => u.nome);
    $(".unid", card).textContent = quem.join(", ");
  }
  caixa.hidden = !cards.some((c) => ag.total.externos[c]?.total);
}

// ------------------------------------------------------------------
// Pagamentos por grupo (barras horizontais, uma cor)
// ------------------------------------------------------------------
function ordemGrupos(grupos) {
  const nc = estado.dados.nao_classificados;
  return Object.entries(grupos).filter(([, d]) => d.total)
    .sort((a, b) => (a[0] === nc) - (b[0] === nc) || b[1].total - a[1].total);
}

function renderGrupos(ag) {
  const caixa = $("#grupos");
  const t = ag.total, nc = estado.dados.nao_classificados;
  const linhas = ordemGrupos(t.grupos).map(([g, d]) => ({ chave: g, nome: g, v: d.total, classe: g === nc ? "nc" : "" }));
  linhas.push({ chave: "__div" });
  linhas.push({ chave: "__ext", nome: "Pagamentos externos", v: t.ext, classe: "ext" });
  const maior = Math.max(1, ...linhas.filter((l) => l.v != null).map((l) => l.v));
  const existentes = new Map($$("[data-g]", caixa).map((n) => [n.dataset.g, n]));
  const vistos = new Set();
  for (const l of linhas) {
    vistos.add(l.chave);
    let n = existentes.get(l.chave);
    if (!n) {
      n = document.createElement("div");
      n.dataset.g = l.chave;
      if (l.chave === "__div") n.className = "divisor";
      else {
        n.className = `grupo ${l.classe}`;
        n.innerHTML = `<span class="nome"></span><span class="val num"></span><span class="trilho"><i style="transform:scaleX(0)"></i></span>`;
      }
    }
    caixa.appendChild(n);  // reordena sem recriar (a barra anima do valor antigo para o novo)
    if (l.chave === "__div") continue;
    $(".nome", n).textContent = l.nome;
    $(".val", n).innerHTML = `${compacto(l.v)}<small>${pct(t.vendas ? l.v / t.vendas : null)}</small>`;
    n.title = `${l.nome}: ${moeda(l.v)} · ${pct(t.vendas ? l.v / t.vendas : null)} das vendas · ${pct((t.pag + t.ext) ? l.v / (t.pag + t.ext) : null)} do total de pagamentos`;
    requestAnimationFrame(() => { $(".trilho i", n).style.transform = `scaleX(${l.v / maior})`; });
  }
  for (const [k, n] of existentes) if (!vistos.has(k)) n.remove();
  $("#grupos-sub").textContent = `Valor e % das vendas · ${nomePeriodo().toLowerCase()}`;
}

// ------------------------------------------------------------------
// Unidades
// ------------------------------------------------------------------
function renderUnidades(ag) {
  const caixa = $("#lista-unidades");
  const unidades = estado.dados.unidades;
  const assinatura = unidades.map((u) => `${u.slug}:${u.ok}`).join(",");
  if (caixa.dataset.assinatura !== assinatura) {
    caixa.dataset.assinatura = assinatura;
    caixa.innerHTML = unidades.map((u, i) => u.ok ? `
      <article class="card unidade hover anima" style="--i:${14 + i}" data-u="${u.slug}">
        <div class="unidade-cab"><h3>${esc(u.nome)}</h3><span class="part num"></span></div>
        <div class="unidade-vendas num">&nbsp;</div>
        <div class="margem">
          <div class="trilho"><i class="pag" style="transform:scaleX(0)"></i></div>
          <div class="rot"><span class="r-pag"></span><span class="r-res"></span></div>
        </div>
        <div class="unidade-linhas">
          <div><span>Pagamentos</span><strong class="num u-pag"></strong></div>
          <div><span>Resultado</span><strong class="num u-res"></strong></div>
          <div><span>Lucratividade</span><strong class="num u-luc"></strong></div>
          <div><span>Externos</span><strong class="num u-ext"></strong></div>
        </div>
      </article>` : `
      <article class="card unidade falhou anima" style="--i:${14 + i}">
        <h3>${esc(u.nome)}</h3>
        <p>Não respondeu: ${esc(u.erro || "erro ao consultar")}. Fica fora dos totais.</p>
      </article>`).join("");
  }
  const totalVendas = ag.total.vendas;
  for (const u of unidades) {
    if (!u.ok) continue;
    const card = caixa.querySelector(`[data-u="${u.slug}"]`);
    const ind = indicadores(ag.por[u.slug] || vazio());
    contar($(".unidade-vendas", card), ind.vendas, (v) => `${compacto(v)}<small>vendas</small>`);
    $(".unidade-vendas", card).title = moeda(ind.vendas);
    $(".part", card).textContent = `${pct(totalVendas ? ind.vendas / totalVendas : null)} das vendas do grupo`;
    $(".u-pag", card).textContent = compacto(ind.pagamentos);
    $(".u-pag", card).title = moeda(ind.pagamentos);
    const res = $(".u-res", card);
    res.textContent = compacto(ind.resultado);
    res.title = moeda(ind.resultado);
    res.classList.toggle("negativo", ind.resultado < 0);
    const luc = $(".u-luc", card);
    luc.textContent = pct(ind.lucratividade);
    luc.classList.toggle("negativo", ind.lucratividade < 0);
    $(".u-ext", card).textContent = ind.externos ? compacto(ind.externos) : "–";
    $(".u-ext", card).title = moeda(ind.externos);
    // quanto das vendas foi consumido pelos pagamentos
    const consumo = ind.vendas ? ind.pagamentos / ind.vendas : (ind.pagamentos ? Infinity : 0);
    const barra = $(".trilho i", card);
    barra.classList.toggle("neg", consumo > 1);
    barra.style.transform = `scaleX(${Math.min(1, consumo || 0)})`;
    $(".r-pag", card).textContent = isFinite(consumo) ? `Pagamentos = ${pct(consumo, 0)} das vendas` : "Pagamentos sem vendas no período";
    $(".r-res", card).textContent = consumo <= 1 ? `sobra ${pct(1 - consumo, 0)}` : "";
    card.title = u.nota || "";
  }
}

// ------------------------------------------------------------------
// Gráfico mês a mês
// ------------------------------------------------------------------
const METRICAS = {
  lucratividade: {
    titulo: "Lucratividade", sub: "Resultado ÷ vendas, mês a mês",
    series: [["Grupo (operação)", "lucratividade", "--s1"], ["Com pagamentos externos", "lucratividadeExt", "--s2"]],
    eixo: eixoPct, valor: (v) => pct(v), rotulo: (v) => pct(v),
  },
  resultado: {
    titulo: "Resultado", sub: "Vendas − pagamentos, mês a mês",
    series: [["Resultado do grupo", "resultado", "--s1"], ["Resultado com externos", "resultadoExt", "--s2"]],
    eixo: eixoMoeda, valor: (v) => compacto(v), rotulo: (v) => compacto(v).replace("R$ ", ""),
  },
  fluxo: {
    titulo: "Vendas × pagamentos", sub: "Pagamentos da operação, sem os externos",
    series: [["Vendas", "vendas", "--s1"], ["Pagamentos", "pagamentos", "--s2"]],
    eixo: eixoMoeda, valor: (v) => compacto(v), rotulo: (v) => compacto(v).replace("R$ ", ""),
  },
};

function renderGrafico(mensal) {
  const m = METRICAS[estado.metrica];
  $("#graf-titulo").textContent = m.titulo;
  $("#graf-sub").textContent = m.sub;
  const parcial = indiceParcial();
  $("#legenda").innerHTML = m.series.map(([nome, , cor]) => `<span style="color:var(${cor})"><i></i><b style="color:var(--text-2);font-weight:500">${nome}</b></span>`).join("")
    + (parcial >= 0 && mensal[parcial] ? `<span><span class="vazado"></span>Mês em andamento</span>` : "");
  grafico.atualizar({
    series: m.series.map(([nome, chave, cor]) => ({ nome, cor: `var(${cor})`, valores: mensal.map((x) => (x ? x[chave] : null)) })),
    formatoEixo: m.eixo, formatoValor: m.valor, formatoRotulo: m.rotulo,
    sel: estado.mes ? estado.mes - 1 : -1, parcial,
    rotuloMes: (i) => `${MESES_LONGOS[i][0].toUpperCase()}${MESES_LONGOS[i].slice(1)} de ${estado.ano}`,
    nota: (i) => {
      const x = mensal[i];
      const partes = [];
      if (estado.metrica === "fluxo" && x) partes.push(`Externos no mês: ${compacto(x.externos)}`);
      if (estado.metrica !== "fluxo" && x) partes.push(`Vendas: ${compacto(x.vendas)}`);
      if (i === parcial) partes.push("Mês em andamento");
      return partes.join(" · ");
    },
  });
  $("#evolucao-sub").textContent = `Mês a mês de ${estado.ano}${anoCorrente() ? " (até hoje)" : ""}`;
}

// ------------------------------------------------------------------
// Tabela por grupo
// ------------------------------------------------------------------
function modeloTabela(ag) {
  const unidades = estado.dados.unidades.filter((u) => u.ok);
  const cols = [...unidades.map((u) => ({ nome: u.nome, a: ag.por[u.slug] })), { nome: "Total", a: ag.total, total: true }];
  const linha = (tipo, rotulo, f, extra = {}) => ({
    tipo, rotulo, ...extra,
    celulas: cols.map((c) => {
      const v = f(c.a) || 0;
      return { v, p: c.a.vendas ? v / c.a.vendas : null };
    }),
  });
  const linhas = [linha("vendas", "Vendas", (a) => a.vendas)];
  for (const [g, d] of ordemGrupos(ag.total.grupos)) {
    linhas.push(linha("grupo", g, (a) => a.grupos[g]?.total, { chave: g, nc: g === estado.dados.nao_classificados }));
    const contas = Object.entries(d.contas).filter(([, v]) => v).sort((a, b) => b[1] - a[1]);
    for (const [c] of contas) linhas.push(linha("conta", c, (a) => a.grupos[g]?.contas[c], { pai: g }));
  }
  linhas.push(linha("total", "Pagamentos do grupo", (a) => a.pag));
  linhas.push(linha("resultado", "Resultado do grupo", (a) => a.vendas - a.pag));
  return { cols, linhas };
}

/** Pagamentos externos vistos para o grupo todo (não por unidade): contas e a ponte até o resultado com externos. */
function modeloExternosGrupo(ag) {
  const t = ag.total, p = (v) => (t.vendas ? v / t.vendas : null);
  const contas = estado.dados.cards_externos
    .map((c) => ({ rotulo: c, v: t.externos[c]?.total || 0 }))
    .filter((c) => c.v).sort((a, b) => b.v - a.v)
    .map((c) => ({ ...c, p: p(c.v), tipo: "conta" }));
  const resultado = t.vendas - t.pag, resultadoExt = resultado - t.ext;
  return {
    contas,
    resumo: [
      { rotulo: "Pagamentos externos", v: t.ext, p: p(t.ext), tipo: "grupo" },
      ...contas,
      { rotulo: "Total de pagamentos (grupo + externos)", v: t.pag + t.ext, p: p(t.pag + t.ext), tipo: "total" },
      { rotulo: "Resultado com externos", v: resultadoExt, p: p(resultadoExt), tipo: "resultado" },
    ],
    ponte: { vendas: t.vendas, pag: t.pag, resultado, ext: t.ext, resultadoExt },
  };
}

function renderExternosGrupo(ag) {
  const { contas, ponte: b } = modeloExternosGrupo(ag);
  const p = (v) => pct(b.vendas ? v / b.vendas : null);
  const maior = Math.max(1, ...contas.map((c) => c.v));
  $("#externos-grupo-barras").innerHTML = contas.length
    ? contas.map((c) => `
      <div class="grupo" title="${esc(c.rotulo)}: ${moeda(c.v)} · ${p(c.v)} das vendas do grupo">
        <span class="nome">${esc(c.rotulo)}</span>
        <span class="val num">${compacto(c.v)}<small>${p(c.v)}</small></span>
        <span class="trilho"><i style="transform:scaleX(0)" data-x="${c.v / maior}"></i></span>
      </div>`).join("")
    : `<div class="vazio-estado">Nenhum pagamento externo em ${esc(nomePeriodo().toLowerCase())}.</div>`;
  requestAnimationFrame(() => $$("#externos-grupo-barras .trilho i").forEach((i) => { i.style.transform = `scaleX(${i.dataset.x})`; }));
  const neg = (v) => (v < 0 ? ' class="neg"' : "");
  const consumo = b.resultado > 0 && b.ext
    ? `<div class="consumo">
        <div class="trilho"><i class="a" style="flex-grow:${Math.max(b.resultadoExt, 0)}"></i><i class="b" style="flex-grow:${Math.min(b.ext, b.resultado)}"></i></div>
        Os externos consumiram <b>${pct(b.ext / b.resultado, 0)}</b> do resultado do grupo.
        <div class="legenda-c"><span>Fica com o grupo</span><span class="b">Pagamentos externos</span></div>
      </div>` : "";
  $("#externos-grupo-ponte").innerHTML = `
    <div class="passo"><span>Vendas</span><strong>${compacto(b.vendas)}</strong><small>100%</small></div>
    <div class="passo"><span>− Pagamentos do grupo</span><strong>${compacto(b.pag)}</strong><small>${p(b.pag)}</small></div>
    <div class="passo res"><span>= Resultado do grupo</span><strong${neg(b.resultado)}>${compacto(b.resultado)}</strong><small>${p(b.resultado)}</small></div>
    <div class="passo"><span>− Pagamentos externos</span><strong>${compacto(b.ext)}</strong><small>${p(b.ext)}</small></div>
    <div class="passo res final"><span>= Resultado com externos</span><strong${neg(b.resultadoExt)}>${compacto(b.resultadoExt)}</strong><small>${p(b.resultadoExt)}</small></div>
    ${consumo}`;
}

function renderTabela(ag) {
  const { cols, linhas } = modeloTabela(ag);
  const temFilhos = new Set(linhas.filter((l) => l.pai).map((l) => l.pai));
  const cab1 = `<tr><th></th>${cols.map((c) => `<th colspan="2" class="${c.total ? "total" : ""}">${esc(c.nome)}</th>`).join("")}</tr>`;
  const cab2 = `<tr><th>${esc(nomePeriodo())}</th>${cols.map((c) => `<th class="${c.total ? "total" : ""}">Valor</th><th class="pct ${c.total ? "total" : ""}">%</th>`).join("")}</tr>`;
  const classe = { vendas: "vendas", total: "subtotal", resultado: "resultado", conta: "conta", grupo: "" };
  const corpo = linhas.map((l) => {
    const aberto = l.pai && (estado.todasAbertas || estado.abertos.has(l.pai));
    let rot = esc(l.tipo === "grupo" ? l.rotulo.charAt(0) + l.rotulo.slice(1).toLowerCase() : l.rotulo);
    if (l.tipo === "grupo" && temFilhos.has(l.chave)) {
      const exp = estado.todasAbertas || estado.abertos.has(l.chave);
      rot = `<button class="expandir" type="button" data-chave="${esc(l.chave)}" aria-expanded="${exp}"><svg class="ico"><use href="#i-seta"/></svg>${rot}</button>`;
    }
    if (l.nc) rot += ` <span title="Contas fora da planilha de classificação" style="color:var(--warning)">●</span>`;
    const tds = l.celulas.map((c, i) => {
      const tot = cols[i].total ? " total" : "";
      const neg = c.v < 0 ? ` class="neg"` : "";
      const p = l.tipo === "vendas" ? (c.v ? "100%" : "–") : pct(c.p);
      return `<td class="num${tot}"><span${neg}>${numero(c.v)}</span></td><td class="pct${tot}">${c.v ? p : ""}</td>`;
    }).join("");
    return `<tr class="${classe[l.tipo]}${aberto ? " aberta" : ""}"${l.pai ? ` data-pai="${esc(l.pai)}"` : ""}><td>${rot}</td>${tds}</tr>`;
  }).join("");
  $("#tabela-grupos").innerHTML = `<thead>${cab1}${cab2}</thead><tbody>${corpo}</tbody>`;
  $("#btn-expandir").textContent = estado.todasAbertas ? "Fechar todas as contas" : "Abrir todas as contas";
}

$("#tabela-grupos").addEventListener("click", (ev) => {
  const b = ev.target.closest(".expandir");
  if (!b) return;
  const chave = b.dataset.chave;
  const abrir = b.getAttribute("aria-expanded") !== "true";
  b.setAttribute("aria-expanded", abrir);
  if (abrir) estado.abertos.add(chave); else estado.abertos.delete(chave);
  $$(`tr[data-pai="${CSS.escape(chave)}"]`).forEach((tr) => tr.classList.toggle("aberta", abrir));
});

$("#btn-expandir").addEventListener("click", () => {
  estado.todasAbertas = !estado.todasAbertas;
  if (!estado.todasAbertas) estado.abertos.clear();
  renderTabela(agregar(estado.dados, mesesDoPeriodo()));
});

async function exportarExcel() {
  const ag = agregar(estado.dados, mesesDoPeriodo());
  const { cols, linhas } = modeloTabela(ag);
  const corpo = {
    titulo: `${estado.dados.nome_grupo}: resultado por grupo`,
    subtitulo: `${nomePeriodo()} · regime de caixa · gerado em ${new Date().toLocaleString("pt-BR")}`,
    arquivo: `consolidado_${estado.ano}${estado.mes ? "-" + String(estado.mes).padStart(2, "0") : ""}`,
    colunas: ["", ...cols.flatMap((c) => [c.nome, "%"])],
    linhas: linhas.map((l) => ({
      rotulo: l.rotulo, tipo: l.tipo,
      valores: l.celulas.flatMap((c) => [Math.round(c.v * 100) / 100, l.tipo === "vendas" ? (c.v ? 1 : null) : (c.p == null ? null : Math.round(c.p * 10000) / 10000)]),
    })),
  };
  // externos: do grupo todo, só na coluna Total
  const vazias = Array((cols.length - 1) * 2).fill(null);
  corpo.linhas.push({ rotulo: "", tipo: "", valores: [] });
  corpo.linhas.push({ rotulo: "PAGAMENTOS EXTERNOS DO GRUPO (grupo todo)", tipo: "total", valores: [] });
  for (const l of modeloExternosGrupo(ag).resumo) {
    corpo.linhas.push({ rotulo: l.rotulo, tipo: l.tipo, valores: [...vazias, Math.round(l.v * 100) / 100, l.p == null ? null : Math.round(l.p * 10000) / 10000] });
  }
  const b = $("#btn-excel");
  b.disabled = true;
  try {
    const r = await fetch("/api/exportar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
    if (!r.ok) throw new Error((await r.json()).erro);
    const url = URL.createObjectURL(await r.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: `${corpo.arquivo}.xlsx` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) {
    mostrarErro(`Não foi possível gerar o Excel: ${e.message}`);
  } finally { b.disabled = false; }
}

// ------------------------------------------------------------------
// Avisos, cabeçalho e seletores
// ------------------------------------------------------------------
function renderAvisos(ag) {
  const avisos = [];
  for (const u of ag.falhas) {
    avisos.push({ erro: true, html: `<b>${esc(u.nome)}</b> não respondeu (${esc(u.erro || "erro")}) e está fora dos totais. Tente Atualizar em alguns minutos.` });
  }
  const semPlanilha = Object.values(ag.por).flatMap((a) => a.semPlanilha);
  if (semPlanilha.length) {
    const meses = [...new Set(semPlanilha)].sort((a, b) => a - b).map((m) => `${MESES[m - 1].toLowerCase()}/${aa(estado.ano)}`);
    avisos.push({ html: `A planilha do CD não tem vendas em <b>${meses.join(", ")}</b>: as vendas do CD contam como zero nesse período.` });
  }
  const nc = ag.total.grupos[estado.dados.nao_classificados];
  if (nc?.total) {
    const contas = Object.entries(nc.contas).sort((a, b) => b[1] - a[1]);
    avisos.push({
      html: `<div><b>${compacto(nc.total)}</b> em ${contas.length} conta(s) fora da planilha de classificação (entram como NÃO CLASSIFICADOS).
        <details><summary>Ver contas</summary><ul>${contas.map(([c, v]) => `<li>${esc(c)}: ${moeda(v)}</li>`).join("")}</ul></details></div>`,
    });
  }
  $("#avisos").innerHTML = avisos.map((a) => `<div class="aviso${a.erro ? " erro" : ""}"><svg class="ico"><use href="#i-alerta"/></svg>${a.html}</div>`).join("");
}

function mostrarErro(msg) {
  $("#avisos").insertAdjacentHTML("afterbegin", `<div class="aviso erro"><svg class="ico"><use href="#i-alerta"/></svg><div>${esc(msg)}</div></div>`);
}

function posicionarIndicador(grupo) {
  const ativo = grupo.querySelector('button[aria-pressed="true"]');
  const ind = grupo.querySelector(".indicador");
  if (!ativo || !ind) return;
  ind.style.width = `${ativo.offsetWidth}px`;
  ind.style.transform = `translateX(${ativo.offsetLeft}px)`;
}

function renderMeses() {
  const caixa = $("#meses");
  if (!caixa.querySelector("button")) {
    caixa.insertAdjacentHTML("beforeend", MESES.map((m, i) => `<button type="button" data-mes="${i + 1}">${m}</button>`).join("")
      + `<span class="sep"></span><button type="button" data-mes="0">Ano</button>`);
    caixa.addEventListener("click", (ev) => {
      const b = ev.target.closest("button");
      if (!b || b.disabled) return;
      estado.mes = +b.dataset.mes;
      render(false);
    });
  }
  const ultimo = estado.dados.ultimo_mes, parcial = indiceParcial();
  $$("button", caixa).forEach((b) => {
    const m = +b.dataset.mes;
    b.disabled = m > ultimo;
    b.classList.toggle("andamento", m - 1 === parcial);
    b.title = m - 1 === parcial ? "Mês em andamento" : "";
    b.setAttribute("aria-pressed", m === estado.mes);
  });
  posicionarIndicador(caixa);
  $("#legenda-periodo").textContent = emAndamento()
    ? `Em andamento: dados até ${hoje().toLocaleDateString("pt-BR")}`
    : "";
}

function renderCabecalho(ag) {
  const d = estado.dados;
  $("#titulo").textContent = d.nome_grupo;
  document.title = `Consolidado · ${nomePeriodo()}`;
  const ok = d.unidades.filter((u) => u.ok).length;
  $("#contexto").innerHTML = `<b>${esc(nomePeriodo())}</b> · ${ok} unidades somadas como uma empresa só`;
  $("#nome-grupo-h2").textContent = d.nome_grupo;
  const sel = $("#ano");
  if (!sel.options.length) sel.innerHTML = d.anos.map((a) => `<option value="${a}">${a}</option>`).join("");
  sel.value = estado.ano;
  const falhas = ag.falhas.length;
  $("#status-dados").innerHTML = `<b><span class="pulso${falhas ? " falha" : ""}"></span>${ok} de ${d.unidades.length} unidades</b>Atualizado às ${hora(d.atualizado_em)}`;
}

// ------------------------------------------------------------------
// Render geral
// ------------------------------------------------------------------
/** Indicadores de cada mês do ano. O mês em andamento (poucos dias) distorce a escala: só aparece quando escolhido. */
function serieMensal() {
  const parcial = indiceParcial();
  const mensal = Array.from({ length: 12 }, (_, i) =>
    i < estado.dados.ultimo_mes && (i !== parcial || estado.mes === i + 1)
      ? indicadores(agregar(estado.dados, [i + 1]).total) : null);
  for (const m of mensal) if (m && !m.vendas) { m.lucratividade = m.lucratividadeExt = null; }
  return mensal;
}

function render(animarGrafico = true) {
  const ag = agregar(estado.dados, mesesDoPeriodo());
  const ind = indicadores(ag.total);
  const comp = comparacao();
  const mensal = serieMensal();

  renderCabecalho(ag);
  renderMeses();
  renderAvisos(ag);
  atualizarKpis(KPIS_GRUPO, ind, comp, mensal, animarGrafico);
  atualizarKpis(KPIS_EXT, ind, comp, mensal, animarGrafico);
  renderExternos(ag);
  renderGrupos(ag);
  renderUnidades(ag);
  renderTabela(ag);
  renderExternosGrupo(ag);
  if (animarGrafico || grafico._ano !== estado.ano || grafico._sel !== estado.mes) {
    renderGrafico(mensal);
    grafico._ano = estado.ano; grafico._sel = estado.mes;
  }
  $("#conteudo").classList.remove("carregando");
  const url = new URL(location.href);
  url.searchParams.set("ano", estado.ano);
  url.searchParams.set("mes", estado.mes);
  history.replaceState(null, "", url);
}

async function carregarAno(ano, { atualizar = false, mes = null } = {}) {
  const btn = $("#btn-atualizar");
  btn.classList.add("girando"); btn.disabled = true;
  $("#conteudo").classList.toggle("carregando", !estado.dados);
  try {
    const dados = await buscar(ano, atualizar);
    estado.ano = ano;
    estado.dados = dados;
    const ultimo = dados.ultimo_mes;
    if (mes != null) estado.mes = Math.min(mes, ultimo);
    else if (estado.mes == null) estado.mes = anoCorrente() ? ultimo - 1 : 12;  // abre no último mês fechado
    else estado.mes = Math.min(estado.mes, ultimo);
    render(true);
  } catch (e) {
    mostrarErro(e.message);
    if (!estado.dados) $("#contexto").textContent = "Não foi possível carregar o consolidado.";
  } finally {
    btn.classList.remove("girando"); btn.disabled = false;
  }
}

// ------------------------------------------------------------------
// Controles
// ------------------------------------------------------------------
$("#ano").addEventListener("change", (ev) => carregarAno(+ev.target.value));
$("#btn-atualizar").addEventListener("click", () => carregarAno(estado.ano, { atualizar: true, mes: estado.mes }));
$("#btn-excel").addEventListener("click", exportarExcel);
$("#btn-pdf").addEventListener("click", () => window.print());

$("#abas").addEventListener("click", (ev) => {
  const b = ev.target.closest("button");
  if (!b) return;
  estado.metrica = b.dataset.metrica;
  $$("#abas button").forEach((x) => x.setAttribute("aria-pressed", x === b));
  posicionarIndicador($("#abas"));
  renderGrafico(serieMensal());
});

// tema: claro, automático (sistema) ou escuro
function aplicarTema(t) {
  if (t === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try { t === "auto" ? localStorage.removeItem("consolidado.tema") : localStorage.setItem("consolidado.tema", t); } catch { /* sem armazenamento */ }
  $$(".tema button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.tema === t));
}
$$(".tema button").forEach((b) => b.addEventListener("click", () => aplicarTema(b.dataset.tema)));
aplicarTema(document.documentElement.dataset.theme || "auto");

// menu lateral recolhível (lembrado neste navegador)
function aplicarMenu(recolhido) {
  document.documentElement.classList.toggle("menu-recolhido", recolhido);
  const b = $("#btn-menu");
  const texto = recolhido ? "Expandir o menu" : "Recolher o menu";
  b.setAttribute("aria-label", texto); b.title = texto;
  b.setAttribute("aria-expanded", !recolhido);
  try { recolhido ? localStorage.setItem("consolidado.menu", "recolhido") : localStorage.removeItem("consolidado.menu"); } catch { /* sem armazenamento */ }
}
$("#btn-menu").addEventListener("click", () => aplicarMenu(!document.documentElement.classList.contains("menu-recolhido")));
aplicarMenu(document.documentElement.classList.contains("menu-recolhido"));

// item do menu acompanha a seção visível
const espiao = new IntersectionObserver((entradas) => {
  for (const e of entradas) {
    if (!e.isIntersecting) continue;
    $$("#nav a").forEach((a) => a.classList.toggle("ativo", a.getAttribute("href") === `#${e.target.id}`));
  }
}, { rootMargin: "-30% 0px -60% 0px" });
$$("main .secao").forEach((s) => espiao.observe(s));

window.addEventListener("resize", () => { posicionarIndicador($("#meses")); posicionarIndicador($("#abas")); });

// ------------------------------------------------------------------
// Início: esqueleto (para a entrada animada) e primeira consulta
// ------------------------------------------------------------------
criarKpis($("#kpis-grupo"), KPIS_GRUPO, 0);
criarKpis($("#kpis-externos"), KPIS_EXT, 4);
// os indicadores deslizantes acompanham a largura real dos botões (a fonte web chega depois)
const reposicionar = () => { posicionarIndicador($("#meses")); posicionarIndicador($("#abas")); };
reposicionar();
document.fonts?.ready.then(reposicionar);
new ResizeObserver(reposicionar).observe($("#meses"));
new ResizeObserver(reposicionar).observe($("#abas"));
setTimeout(() => document.body.classList.remove("entrada"), 2600);  // a entrada roda uma vez só

const params = new URLSearchParams(location.search);
const anoUrl = +params.get("ano"), mesUrl = params.has("mes") ? +params.get("mes") : null;
const anoInicial = anoUrl >= 2000 && anoUrl <= new Date().getFullYear() ? anoUrl : new Date().getFullYear();
// janeiro do ano corrente ainda não tem mês fechado: abre em dezembro do ano anterior
const abrirAnterior = mesUrl == null && !anoUrl && new Date().getMonth() === 0;
carregarAno(abrirAnterior ? anoInicial - 1 : anoInicial, { mes: mesUrl != null && mesUrl >= 0 && mesUrl <= 12 ? mesUrl : null });
