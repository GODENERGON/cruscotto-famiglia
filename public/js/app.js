// Guscio dell'app: navigazione, dati comuni, instradamento tra le viste.
import { api, ICONE, MARCHIO, esc, toast } from './ui.js';
import panoramica from './viste/panoramica.js';
import movimenti from './viste/movimenti.js';
import tempo from './viste/tempo.js';
import importa from './viste/importa.js';
import salvadanai from './viste/salvadanai.js';
import impostazioni from './viste/impostazioni.js';

const VISTE = [
  { id: 'panoramica', nome: 'Panoramica', breve: 'Home', vista: panoramica },
  { id: 'tempo', nome: 'Tempo', vista: tempo },
  { id: 'movimenti', nome: 'Movimenti', vista: movimenti },
  { id: 'importa', nome: 'Importa', vista: importa },
  { id: 'salvadanai', nome: 'Salvadanai', vista: salvadanai },
  { id: 'impostazioni', nome: 'Impostazioni', breve: 'Opzioni', vista: impostazioni, fondo: true },
];

// Dati condivisi da tutte le viste (persone, conti, categorie). Si ricaricano dopo ogni modifica.
export const store = {
  meta: null,
  async ricarica() { this.meta = await api('/api/meta'); return this.meta; },
  persona(id) { return this.meta?.persone.find((p) => p.id === id); },
  categoria(id) { return this.meta?.categorie.find((c) => c.id === id); },
  conto(id) { return this.meta?.conti.find((c) => c.id === id); },
};

const $vista = document.getElementById('vista');
document.getElementById('brand').innerHTML = MARCHIO;
document.getElementById('nav').innerHTML = VISTE.map((v) => `
  <a class="rail-item${v.fondo ? ' fondo' : ''}" href="#/${v.id}" data-id="${v.id}" aria-label="${esc(v.nome)}" title="${esc(v.nome)}">${ICONE[v.id]}<span class="rail-label" aria-hidden="true">${esc(v.breve || v.nome)}</span></a>`).join('');

let corrente = null;
async function vai() {
  const [percorso, query = ''] = location.hash.replace(/^#/, '').split('?');
  const [, id = 'panoramica', ...resto] = percorso.split('/');
  const v = VISTE.find((x) => x.id === id) || VISTE[0];
  document.querySelectorAll('.rail-item').forEach((a) => {
    if (a.dataset.id === v.id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.title = `${v.nome} · Cruscotto Famiglia`;
  const params = new URLSearchParams(query);
  corrente?.smonta?.();
  corrente = v.vista;
  try {
    if (!store.meta) await store.ricarica();
    await v.vista.monta($vista, { params, resto, store });
  } catch (e) {
    console.error(e);
    $vista.innerHTML = `<div class="title-row"><div><h1>${esc(v.nome)}</h1></div></div>
      <section class="panel"><p>Non riesco a leggere i dati: ${esc(e.message)}.</p><p><button class="card-link" type="button" onclick="location.reload()">Riprova</button></p></section>`;
  }
}
window.addEventListener('hashchange', vai);
vai();

// Le viste chiamano aggiorna() dopo una modifica: ricarica i dati comuni e ridisegna la vista corrente.
export async function aggiorna() {
  await store.ricarica();
  await vai();
}
window.addEventListener('unhandledrejection', (e) => toast(e.reason?.message || 'Qualcosa è andato storto', { errore: true }));
