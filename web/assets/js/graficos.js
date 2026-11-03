// Gráficos em SVG puro: sparkline dos KPIs e gráfico de linhas mês a mês.
import { MESES, esc, reduzMovimento } from "./format.js";

const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}, pai) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (pai) pai.appendChild(n);
  return n;
};

/** Curva monotônica (não passa do valor real entre dois meses, ao contrário de uma spline comum). */
function caminho(pts) {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : "";
  const n = pts.length, d = [], m = [];
  for (let i = 0; i < n - 1; i++) d.push((pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  let p = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = (pts[i + 1][0] - pts[i][0]) / 3;
    p += ` C${pts[i][0] + h},${pts[i][1] + m[i] * h} ${pts[i + 1][0] - h},${pts[i + 1][1] - m[i + 1] * h} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  return p;
}

function desenhar(path, atraso = 0, duracao = 900) {
  if (reduzMovimento() || !path.getTotalLength) return;
  const L = path.getTotalLength();
  path.style.strokeDasharray = `${L}`;
  path.animate([{ strokeDashoffset: L }, { strokeDashoffset: 0 }],
    { duration: duracao, delay: atraso, easing: "cubic-bezier(.23,1,.32,1)", fill: "backwards" })
    .finished.then(() => { path.style.strokeDasharray = ""; }).catch(() => {});
}

function aparecer(n, atraso, duracao = 300) {
  if (reduzMovimento()) return;
  n.animate([{ opacity: 0 }, { opacity: 1 }], { duration: duracao, delay: atraso, easing: "ease-out", fill: "backwards" });
}

/** Escala "bonita" para o eixo: ~5 marcas em passos de 1, 2, 2,5 ou 5. */
function escala(min, max, marcas = 5) {
  if (min === max) { max = min + (Math.abs(min) || 1); }
  const bruto = (max - min) / marcas;
  const pot = Math.pow(10, Math.floor(Math.log10(bruto)));
  const passo = [1, 2, 2.5, 5, 10].map((f) => f * pot).find((p) => p >= bruto);
  const ini = Math.floor(min / passo) * passo, fim = Math.ceil(max / passo) * passo;
  const ticks = [];
  for (let v = ini; v <= fim + passo / 2; v += passo) ticks.push(Math.round(v / passo) * passo);
  return { ini, fim, ticks };
}

// ------------------------------------------------------------------
// Sparkline: tendência do ano no card do KPI (o mês escolhido em destaque)
// ------------------------------------------------------------------
export function sparkline(svg, valores, { sel = -1, parcial = -1, cor = "var(--s1)", animar = true } = {}) {
  svg.innerHTML = "";
  const W = 108, H = 40, pad = 5;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const v = valores.filter((x) => x != null && isFinite(x));
  if (v.length < 2) return;
  const min = Math.min(...v), max = Math.max(...v), amp = max - min || 1;
  const x = (i) => pad + (i * (W - pad * 2)) / Math.max(1, 11);
  const y = (val) => H - pad - ((val - min) / amp) * (H - pad * 2);
  const idx = valores.map((val, i) => (val != null && isFinite(val) ? i : -1)).filter((i) => i >= 0);
  const pts = idx.map((i) => [x(i), y(valores[i])]);
  sel = idx.indexOf(sel);
  parcial = idx.indexOf(parcial);
  const grad = `sg${Math.random().toString(36).slice(2, 8)}`;
  const defs = el("defs", {}, svg);
  const lg = el("linearGradient", { id: grad, x1: 0, x2: 0, y1: 0, y2: 1 }, defs);
  el("stop", { offset: "0%", style: `stop-color:${cor};stop-opacity:.18` }, lg);
  el("stop", { offset: "100%", style: `stop-color:${cor};stop-opacity:0` }, lg);
  const linha = caminho(pts);
  const area = el("path", { d: `${linha} L${pts.at(-1)[0]},${H} L${pts[0][0]},${H} Z`, fill: `url(#${grad})` }, svg);
  const p = el("path", { d: linha, fill: "none", style: `stroke:${cor}`, "stroke-width": 1.75, "stroke-linecap": "round", "stroke-linejoin": "round" }, svg);
  if (min < 0 && max > 0) el("line", { x1: pad, x2: W - pad, y1: y(0), y2: y(0), style: "stroke:var(--baseline)", "stroke-width": .75 }, svg);
  if (sel >= 0 && sel < pts.length) {
    const vaz = sel === parcial;
    const c = el("circle", { cx: pts[sel][0], cy: pts[sel][1], r: 3.25, style: `fill:${vaz ? "var(--surface)" : cor};stroke:${vaz ? cor : "var(--surface)"}`, "stroke-width": vaz ? 1.75 : 1.5 }, svg);
    if (animar) aparecer(c, 650);
  }
  if (animar) { desenhar(p, 120, 800); aparecer(area, 350, 500); }
}

// ------------------------------------------------------------------
// Gráfico de linhas: 12 meses no eixo, dados até o último mês do ano
// ------------------------------------------------------------------
export class GraficoLinhas {
  constructor(caixa, tooltip) {
    this.caixa = caixa;
    this.tooltip = tooltip;
    this.cfg = null;
    new ResizeObserver(() => this.cfg && this.render(false)).observe(caixa);
  }

  /**
   * cfg: { series: [{ nome, cor, valores: [12 posições, null = sem dado] }], formatoEixo, formatoValor,
   *        sel: índice do mês escolhido (-1 = ano), parcial: índice do mês em andamento, nota(i) }
   */
  atualizar(cfg) {
    this.cfg = cfg;
    this.render(true);
  }

  render(animar) {
    const { series, formatoEixo, formatoValor, sel = -1, parcial = -1 } = this.cfg;
    this.caixa.querySelector("svg")?.remove();
    const W = this.caixa.clientWidth, H = this.caixa.clientHeight;
    if (!W || !H) return;
    const m = { t: 14, r: 16, b: 30, l: 58 };
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": series.map((s) => s.nome).join(" e ") });
    this.caixa.prepend(svg);

    const todos = series.flatMap((s) => s.valores).filter((v) => v != null && isFinite(v));
    if (!todos.length) return;
    // folga em cima e embaixo para os rótulos dos pontos
    const lo = Math.min(0, ...todos), hi = Math.max(0, ...todos), folga = (hi - lo || 1) * 0.1;
    const { ini, fim, ticks } = escala(lo < 0 ? lo - folga : lo, hi + folga);
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const x = (i) => m.l + (i + .5) * (iw / 12);
    const y = (v) => m.t + ih - ((v - ini) / (fim - ini)) * ih;

    // faixa do mês escolhido
    if (sel >= 0) el("rect", { class: "faixa-sel", x: x(sel) - iw / 24, y: m.t, width: iw / 12, height: ih, rx: 10 }, svg);

    // grade e eixo Y (linhas finas, sólidas)
    const g = el("g", { class: "grid" }, svg), eixo = el("g", { class: "eixo" }, svg);
    for (const t of ticks) {
      if (t !== 0) el("line", { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t) }, g);
      const tx = el("text", { x: m.l - 12, y: y(t) + 4, "text-anchor": "end" }, eixo);
      tx.textContent = formatoEixo(t);
    }
    el("line", { class: "zero", x1: m.l, x2: W - m.r, y1: y(0), y2: y(0) }, svg);
    MESES.forEach((rot, i) => {
      const tx = el("text", { x: x(i), y: H - 8, "text-anchor": "middle", class: i === sel ? "sel" : "" }, eixo);
      tx.textContent = rot;
    });

    // séries
    series.forEach((s, k) => {
      const pts = s.valores.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
      if (!pts.length) return;
      const d = caminho(pts);
      if (k === 0) {
        const grad = `ga${Math.random().toString(36).slice(2, 8)}`;
        const lg = el("linearGradient", { id: grad, x1: 0, x2: 0, y1: 0, y2: 1 }, el("defs", {}, svg));
        el("stop", { offset: "0%", style: `stop-color:${s.cor};stop-opacity:.9` }, lg);
        el("stop", { offset: "100%", style: `stop-color:${s.cor};stop-opacity:0` }, lg);
        const area = el("path", { class: "area", d: `${d} L${pts.at(-1)[0]},${y(0)} L${pts[0][0]},${y(0)} Z`, fill: `url(#${grad})` }, svg);
        if (animar) aparecer(area, 400, 600);
      }
      const linha = el("path", { class: "linha", d, style: `stroke:${s.cor}` }, svg);
      if (animar) desenhar(linha, k * 120);
      s.valores.forEach((v, i) => {
        if (v == null) return;
        const vazado = i === parcial;
        const c = el("circle", { class: `ponto${vazado ? " vazado" : ""}`, cx: x(i), cy: y(v), r: i === sel ? 5 : 4, style: vazado ? `stroke:${s.cor}` : `fill:${s.cor}`, "data-i": i }, svg);
        if (animar) aparecer(c, 300 + i * 45 + k * 80);
      });
    });

    // rótulo de dados em todos os pontos: em cada mês, a série maior fica acima do ponto e a menor abaixo
    const rotulo = this.cfg.formatoRotulo || formatoValor;
    const passo = iw / 12, alterna = passo < 46;  // tela estreita: um mês sim, outro não (o escolhido sempre)
    for (let i = 0; i < 12; i++) {
      const vals = series.map((s) => s.valores[i]);
      if (vals.every((v) => v == null)) continue;
      if (alterna && i % 2 && i !== sel) continue;
      const maior = vals.reduce((a, v, k) => (v != null && (a < 0 || v > vals[a]) ? k : a), -1);
      vals.forEach((v, k) => {
        if (v == null) return;
        const acima = k === maior;
        const ty = Math.max(10, Math.min(m.t + ih + 12, y(v) + (acima ? -10 : 18)));
        const t = el("text", { class: `rotulo-ponto${k ? " s2" : ""}${i === sel ? " sel" : ""}`, x: x(i), y: ty, "text-anchor": "middle" }, svg);
        t.textContent = rotulo(v);
        if (animar) aparecer(t, 500 + i * 45 + k * 80);
      });
    }

    // camada de interação: mira + tooltip por mês
    const mira = el("line", { class: "mira", y1: m.t, y2: m.t + ih }, svg);
    const alvo = el("rect", { x: m.l, y: 0, width: iw, height: H, fill: "transparent" }, svg);
    const mover = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(11, Math.floor((px - m.l) / (iw / 12))));
      if (series.every((s) => s.valores[i] == null)) return sair();
      mira.setAttribute("x1", x(i)); mira.setAttribute("x2", x(i));
      this.caixa.classList.add("com-mira");
      svg.querySelectorAll(".ponto").forEach((c) => c.setAttribute("r", +c.dataset.i === i ? 6 : (+c.dataset.i === sel ? 5 : 4)));
      const linhas = series.map((s) => `<div class="linha-tt"><span><i style="background:${s.cor}"></i>${esc(s.nome)}</span><strong>${s.valores[i] == null ? "–" : formatoValor(s.valores[i])}</strong></div>`).join("");
      const nota = this.cfg.nota ? this.cfg.nota(i) : "";
      this.tooltip.innerHTML = `<b>${esc(this.cfg.rotuloMes(i))}</b>${linhas}${nota ? `<small>${nota}</small>` : ""}`;
      const tw = this.tooltip.offsetWidth, cx = (x(i) / W) * r.width;
      const esquerda = cx + 16 + tw > r.width ? cx - 16 - tw : cx + 16;
      this.tooltip.style.left = `${esquerda}px`;
      this.tooltip.style.top = `${Math.max(0, (m.t / H) * r.height + 8)}px`;
      this.tooltip.classList.add("visivel");
    };
    const sair = () => {
      this.caixa.classList.remove("com-mira");
      this.tooltip.classList.remove("visivel");
      svg.querySelectorAll(".ponto").forEach((c) => c.setAttribute("r", +c.dataset.i === sel ? 5 : 4));
    };
    alvo.addEventListener("pointermove", mover);
    alvo.addEventListener("pointerleave", sair);
  }
}
