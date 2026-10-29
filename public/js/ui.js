// Strumenti condivisi dalle viste: API, formati, piccoli componenti.
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.errore || `Errore ${res.status}`);
  return data;
}

const MINUS = '−';
const nf2 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 });

// 123456 → "1.234,56 €" ; con sign: "+1.234,56 €" / "−1.234,56 €"
export function euro(cents, { sign = false, dec = 2 } = {}) {
  if (cents == null) return '—';
  const v = Math.abs(cents) / 100;
  const s = (dec === 0 ? nf0.format(Math.round(v)) : nf2.format(v)) + ' €';
  if (cents < 0) return MINUS + s;
  return (sign && cents > 0 ? '+' : '') + s;
}
// Cifra grande: i centesimi più piccoli e grigi.
export function euroBig(cents, { sign = false } = {}) {
  if (cents == null) return '<span class="dash">—</span>';
  const v = Math.abs(cents);
  const int = nf0.format(Math.floor(v / 100));
  const dec = String(v % 100).padStart(2, '0');
  const pre = cents < 0 ? MINUS : sign && cents > 0 ? '+' : '';
  return `${pre}${int}<small>,${dec} €</small>`;
}
// Importo in tabella: entrate in verde con il più, uscite in inchiostro con il meno.
export function amountCell(cents) {
  return `<span class="${cents > 0 ? 'in' : ''}">${euro(cents, { sign: true })}</span>`;
}
// Euro interi per i grafici (valori già in euro)
export const euroAxis = (v) => nf0.format(v) + ' €';
export const euroTip = (v) => nf0.format(Math.round(v)) + ' €';

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const MESI_BREVI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
export const meseNome = (m, { anno = true } = {}) => { const [y, mo] = m.split('-').map(Number); return MESI[mo - 1] + (anno ? ' ' + y : ''); };
export const meseBreve = (m, { anno = false } = {}) => { const [y, mo] = m.split('-').map(Number); return MESI_BREVI[mo - 1] + (anno ? ' ' + String(y).slice(2) : ''); };
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export function dataBreve(d) { const [, mo, g] = d.split('-').map(Number); return `${g} ${MESI_BREVI[mo - 1]}`; }
export function dataLunga(d) { const [y, mo, g] = d.split('-').map(Number); return `${g} ${MESI[mo - 1]} ${y}`; }
export function addMonths(m, n) { const [y, mo] = m.split('-').map(Number); const i = y * 12 + mo - 1 + n; return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`; }
export function mesiTra(a, b) { const [y1, m1] = a.split('-').map(Number), [y2, m2] = b.split('-').map(Number); return (y2 - y1) * 12 + m2 - m1; }

// "12,50" o "-12,50" o "1.200" → centesimi
export function parseEuro(s) {
  s = String(s ?? '').replace(/[€\s ]/g, '').replace(MINUS, '-');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const v = Number(s);
  return Number.isFinite(v) ? Math.round(v * 100) : null;
}
export const centsToInput = (c) => (c == null ? '' : nf2.format(c / 100).replace(/\./g, ''));

// Etichetta di una persona: iniziale nella sua tinta e nome.
export function personaChip(p, { nome = true } = {}) {
  if (!p) return '<span class="dash">—</span>';
  return `<span class="persona" style="--tinta:${esc(p.tinta || '#eef1f4')};--inchiostro:${esc(p.inchiostro || '#3a3d40')}"><span class="iniziale" aria-hidden="true">${esc(p.nome[0])}</span>${nome ? `<span>${esc(p.nome)}</span>` : `<span class="sr">${esc(p.nome)}</span>`}</span>`;
}

// Messaggio breve in basso
let toastTimer;
export function toast(msg, { azione, onAzione, errore = false } = {}) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.className = errore ? 'errore' : '';
  t.innerHTML = `<span>${esc(msg)}</span>${azione ? `<button type="button" class="btn ghost">${esc(azione)}</button>` : ''}`;
  if (azione) t.querySelector('button').onclick = () => { onAzione?.(); t.classList.remove('on'); };
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), azione ? 7000 : 3200);
}

// Finestra di dialogo con un modulo. campi: [{ nome, etichetta, tipo, opzioni, valore, aiuto, richiesto }]
export function dialogo({ titolo, testo = '', campi = [], conferma = 'Salva', pericolo = null, onPericolo }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'sheet';
    d.innerHTML = `<form method="dialog">
      <header><h2>${esc(titolo)}</h2><button type="button" class="btn ghost icon" data-chiudi aria-label="Chiudi">${ICONE.x}</button></header>
      ${testo ? `<p class="lead">${esc(testo)}</p>` : ''}
      <div class="campi">${campi.map(campoHtml).join('')}</div>
      <p class="errore-form" role="alert" hidden></p>
      <footer>${pericolo ? `<button type="button" class="btn danger" data-pericolo>${esc(pericolo)}</button>` : ''}<span class="spacer"></span><button type="button" class="btn" data-chiudi>Annulla</button><button type="submit" class="btn primary" value="ok">${esc(conferma)}</button></footer>
    </form>`;
    document.body.appendChild(d);
    const chiudi = (v) => { d.close(); d.remove(); resolve(v); };
    d.querySelectorAll('[data-chiudi]').forEach((b) => (b.onclick = () => chiudi(null)));
    d.addEventListener('cancel', (e) => { e.preventDefault(); chiudi(null); });
    if (pericolo) d.querySelector('[data-pericolo]').onclick = async () => { if (await onPericolo?.()) chiudi({ eliminato: true }); };
    d.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const out = {};
      for (const c of campi) {
        const el = d.querySelector(`[name="${c.nome}"]`);
        let v = c.tipo === 'checkbox' ? el.checked : el.value.trim();
        if (c.tipo === 'euro') { v = v === '' ? null : parseEuro(v); if (v == null && el.value.trim()) return errore(`${c.etichetta}: importo non valido`); }
        if (c.tipo === 'numero') v = v === '' ? null : Number(String(v).replace(',', '.'));
        if (c.tipo === 'select' && v !== '' && /^\d+$/.test(v)) v = Number(v);
        if (c.tipo === 'select' && v === '') v = null;
        if (c.richiesto && (v == null || v === '')) return errore(`Compila «${c.etichetta}»`);
        out[c.nome] = v;
      }
      chiudi(out);
    });
    function errore(msg) { const p = d.querySelector('.errore-form'); p.textContent = msg; p.hidden = false; }
    d.showModal();
    d.querySelector('input:not([type=checkbox]), select')?.focus();
  });
}

function campoHtml(c) {
  const id = 'f-' + c.nome;
  const aiuto = c.aiuto ? `<span class="hint" id="${id}-h">${esc(c.aiuto)}</span>` : '';
  const desc = c.aiuto ? ` aria-describedby="${id}-h"` : '';
  if (c.tipo === 'checkbox') return `<label class="check" for="${id}"><input type="checkbox" id="${id}" name="${c.nome}" ${c.valore ? 'checked' : ''}${desc}><span>${esc(c.etichetta)}</span></label>${aiuto}`;
  let input;
  if (c.tipo === 'select') input = `<select class="input" id="${id}" name="${c.nome}"${desc}>${c.vuota !== false ? `<option value="">${esc(c.vuota || '—')}</option>` : ''}${c.opzioni.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(c.valore ?? '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
  else if (c.tipo === 'textarea') input = `<textarea class="input" id="${id}" name="${c.nome}" rows="3"${desc}>${esc(c.valore ?? '')}</textarea>`;
  else {
    const type = c.tipo === 'data' ? 'date' : 'text';
    const mode = c.tipo === 'euro' || c.tipo === 'numero' ? ' inputmode="decimal"' : '';
    const val = c.tipo === 'euro' ? centsToInput(c.valore) : c.valore ?? '';
    input = `<input class="input${c.tipo === 'euro' ? ' num' : ''}" type="${type}" id="${id}" name="${c.nome}" value="${esc(val)}"${mode}${desc} autocomplete="off">`;
  }
  return `<div class="field${c.largo ? ' wide' : ''}"><label for="${id}">${esc(c.etichetta)}</label>${input}${aiuto}</div>`;
}

export async function conferma(titolo, testo, azione = 'Elimina') {
  const r = await dialogo({ titolo, testo, conferma: azione });
  return !!r;
}

// Icone a tratto, 18px
const I = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICONE = {
  panoramica: I('<path d="M3 10.5 12 4l9 6.5"/><path d="M5.5 9v10.5h13V9"/><path d="M10 19.5v-5h4v5"/>'),
  movimenti: I('<path d="M4 6h16M4 12h16M4 18h10"/>'),
  importa: I('<path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M5 19.5h14"/>'),
  salvadanai: I('<path d="M6 8h12l-1 11.5H7z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/><path d="M10 13h4"/>'),
  impostazioni: I('<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M4.2 7.5l2.1 1.2M17.7 15.3l2.1 1.2M4.2 16.5l2.1-1.2M17.7 8.7l2.1-1.2"/>'),
  piu: I('<path d="M12 5v14M5 12h14"/>'),
  x: I('<path d="M6 6l12 12M18 6 6 18"/>'),
  indietro: I('<path d="m14.5 6-6 6 6 6"/>'),
  avanti: I('<path d="m9.5 6 6 6-6 6"/>'),
  cerca: I('<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>'),
  matita: I('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
};

// Marchio: tre corsie in verticale nei colori delle persone.
export const MARCHIO = `<svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><rect x="3" y="9" width="6" height="16" rx="3" fill="#1d5fd6"/><rect x="11" y="3" width="6" height="22" rx="3" fill="#c0396f"/><rect x="19" y="13" width="6" height="12" rx="3" fill="#c98208"/></svg>`;
