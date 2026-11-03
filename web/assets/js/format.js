// Formatação (pt-BR) e pequenos utilitários de movimento.

export const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
export const MESES_LONGOS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto",
  "setembro", "outubro", "novembro", "dezembro"];

const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const casas = (n) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: n, maximumFractionDigits: n });
const c1 = casas(1), c2 = casas(2);

export const reduzMovimento = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** R$ 1.234.567 */
export function moeda(v) {
  return `${v < 0 ? "−" : ""}R$ ${inteiro.format(Math.abs(Math.round(v)))}`;
}

/** 1.234.567 (tabela) */
export function numero(v) {
  if (!v) return "–";
  return `${v < 0 ? "−" : ""}${inteiro.format(Math.abs(Math.round(v)))}`;
}

/** Partes de um valor compacto: { sinal, num, sufixo } -> R$ 8,31 mi */
export function compactoPartes(v) {
  const a = Math.abs(v);
  const sinal = v < 0 ? "−" : "";
  if (a >= 1e9) return { sinal, num: c2.format(a / 1e9), sufixo: "bi" };
  if (a >= 1e6) return { sinal, num: c2.format(a / 1e6), sufixo: "mi" };
  if (a >= 1e4) return { sinal, num: c1.format(a / 1e3), sufixo: "mil" };
  return { sinal, num: inteiro.format(a), sufixo: "" };
}

export function compacto(v) {
  const p = compactoPartes(v);
  return `${p.sinal}R$ ${p.num}${p.sufixo ? " " + p.sufixo : ""}`;
}

/** Valor grande do KPI, com o "R$" menor */
export function moedaHero(v) {
  const p = compactoPartes(v);
  return `${p.sinal}<small>R$</small>${p.num}${p.sufixo ? `<small style="margin:0 0 0 4px">${p.sufixo}</small>` : ""}`;
}

/** 18,4% */
export function pct(v, n = 1) {
  if (v == null || !isFinite(v)) return "–";
  return `${v < 0 ? "−" : ""}${casas(n).format(Math.abs(v * 100))}%`;
}

/** Eixo do gráfico: R$ 2 mi / 12% */
export function eixoMoeda(v) {
  const a = Math.abs(v), s = v < 0 ? "−" : "";
  if (a >= 1e6) return `${s}${casas(a % 1e6 === 0 ? 0 : 1).format(a / 1e6)} mi`;
  if (a >= 1e3) return `${s}${inteiro.format(a / 1e3)} mil`;
  return `${s}${inteiro.format(a)}`;
}
export function eixoPct(v) {
  return `${v < 0 ? "−" : ""}${inteiro.format(Math.abs(v * 100))}%`;
}

export function hora(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Conta o número do valor anterior até o novo (ease-out, ~700 ms).
 * render(v) devolve o HTML do valor; el._valor guarda o último valor mostrado.
 */
export function contar(el, para, render, duracao = 750) {
  const de = el._valor ?? 0;
  el._valor = para;
  cancelAnimationFrame(el._raf);
  if (reduzMovimento() || de === para || !isFinite(de) || !isFinite(para)) {
    el.innerHTML = render(para);
    return;
  }
  const inicio = performance.now();
  const passo = (agora) => {
    const t = Math.min(1, (agora - inicio) / duracao);
    const e = 1 - Math.pow(1 - t, 3);
    el.innerHTML = render(de + (para - de) * e);
    if (t < 1) el._raf = requestAnimationFrame(passo);
  };
  el._raf = requestAnimationFrame(passo);
}
