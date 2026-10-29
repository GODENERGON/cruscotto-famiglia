// Utilità sui mesi: tutto lavora su stringhe 'YYYY-MM' e date 'YYYY-MM-DD'.
export const ym = (d) => String(d).slice(0, 7);
export const toIdx = (m) => { const [y, mo] = m.split('-').map(Number); return y * 12 + (mo - 1); };
export const fromIdx = (i) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
export const addMonths = (m, n) => fromIdx(toIdx(m) + n);
export const monthsBetween = (a, b) => toIdx(b) - toIdx(a);
export const firstDay = (m) => `${m}-01`;
export const lastDay = (m) => { const [y, mo] = m.split('-').map(Number); return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`; };
export const daysIn = (m) => Number(lastDay(m).slice(8));

export function today(clock) {
  const d = clock ? new Date(clock) : new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// La ricorrenza cade nel mese m?
export function occursIn(r, m) {
  const start = ym(r.dal);
  if (toIdx(m) < toIdx(start)) return false;
  if (r.al && toIdx(m) > toIdx(ym(r.al))) return false;
  return monthsBetween(start, m) % Math.max(1, r.ogni_mesi) === 0;
}

export function dayOf(r, m) {
  return `${m}-${String(Math.min(Math.max(1, r.giorno || 1), daysIn(m))).padStart(2, '0')}`;
}
