// Movimenti: l'elenco da controllare e classificare.
import { api, esc, euro, amountCell, meseNome, cap, dataBreve, addMonths, ICONE, personaChip, dialogo, toast, conferma } from '../ui.js';
import { aggiorna } from '../app.js';

const PAGINA = 100;

export function opzioniCategorie(store, scelta) {
  const gruppi = { entrata: 'Entrate', uscita: 'Uscite', giroconto: 'Giroconti' };
  return Object.entries(gruppi).map(([tipo, nome]) => `<optgroup label="${nome}">${store.meta.categorie.filter((c) => c.tipo === tipo)
    .map((c) => `<option value="${c.id}" ${c.id === scelta ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</optgroup>`).join('');
}

// Modulo per un movimento nuovo o esistente. Restituisce true se ha salvato.
export async function nuovoMovimento(store, m = null) {
  const oggi = store.meta.oggi;
  const r = await dialogo({
    titolo: m ? 'Modifica movimento' : 'Nuovo movimento',
    conferma: m ? 'Salva' : 'Aggiungi',
    campi: [
      { nome: 'tipo', etichetta: 'Tipo', tipo: 'select', vuota: false, opzioni: [{ value: 'uscita', label: 'Uscita' }, { value: 'entrata', label: 'Entrata' }], valore: m && m.importo > 0 ? 'entrata' : 'uscita' },
      { nome: 'importo', etichetta: 'Importo (€)', tipo: 'euro', valore: m ? Math.abs(m.importo) : null, richiesto: true },
      { nome: 'descrizione', etichetta: 'Descrizione', valore: m?.descrizione, largo: true, richiesto: true },
      { nome: 'data', etichetta: 'Data', tipo: 'data', valore: m?.data || oggi, richiesto: true },
      { nome: 'categoria_id', etichetta: 'Categoria', tipo: 'select', vuota: 'Da classificare', opzioni: store.meta.categorie.map((c) => ({ value: c.id, label: c.nome })), valore: m?.categoria_id },
      { nome: 'persona_id', etichetta: 'Chi', tipo: 'select', vuota: 'Famiglia', opzioni: store.meta.persone.filter((p) => p.ruolo !== 'famiglia').map((p) => ({ value: p.id, label: p.nome })), valore: m?.persona_id },
      { nome: 'conto_id', etichetta: 'Conto', tipo: 'select', vuota: false, opzioni: store.meta.conti.map((c) => ({ value: c.id, label: c.nome })), valore: m?.conto_id },
      { nome: 'note', etichetta: 'Nota', valore: m?.note, largo: true },
    ],
    pericolo: m ? 'Elimina' : null,
    onPericolo: async () => {
      if (!(await conferma('Eliminare il movimento?', `${m.descrizione}, ${euro(m.importo)} del ${dataBreve(m.data)}. Non si può annullare.`))) return false;
      await api(`/api/movimenti/${m.id}`, { method: 'DELETE' });
      toast('Movimento eliminato');
      return true;
    },
  });
  if (!r) return false;
  if (r.eliminato) return true;
  if (!r.importo || r.importo <= 0) { toast('L\'importo deve essere maggiore di zero', { errore: true }); return false; }
  const famiglia = store.meta.persone.find((p) => p.ruolo === 'famiglia');
  const body = { ...r, importo: r.tipo === 'entrata' ? r.importo : -r.importo, persona_id: r.persona_id ?? famiglia?.id ?? null };
  delete body.tipo;
  if (m) await api(`/api/movimenti/${m.id}`, { method: 'PATCH', body });
  else await api('/api/movimenti', { method: 'POST', body });
  toast(m ? 'Movimento aggiornato' : 'Movimento aggiunto');
  return true;
}

export default {
  async monta(el, { params, store }) {
    const meseOggi = store.meta.oggi.slice(0, 7);
    const f = {
      mese: params.get('mese') ?? meseOggi,
      persona: params.get('persona') || '', categoria: params.get('categoria') || '', conto: params.get('conto') || '',
      q: params.get('q') || '', da_classificare: params.get('da_classificare') || '',
    };
    let impara = localStorage.getItem('impara') !== '0';
    let righe = [], totale = 0, dati = null;

    const qs = (extra = {}) => new URLSearchParams(Object.entries({ ...f, ...extra }).filter(([, v]) => v !== '' && v != null)).toString();
    const vai = (cambi) => { location.hash = '#/movimenti?' + qs(cambi); };

    el.innerHTML = `<div class="wrap">
      <div class="title-row">
        <div><h1>Movimenti</h1><p class="sub" id="sub">&nbsp;</p></div>
        <div class="actions">
          ${f.mese ? `<div class="scope" role="group" aria-label="Mese">
            <a class="btn ghost icon" href="#/movimenti?${qs({ mese: addMonths(f.mese, -1) })}" aria-label="Mese precedente">${ICONE.indietro}</a>
            <span class="label">${cap(meseNome(f.mese))}</span>
            <a class="btn ghost icon" href="#/movimenti?${qs({ mese: addMonths(f.mese, 1) })}" aria-label="Mese successivo">${ICONE.avanti}</a>
          </div>` : `<a class="btn" href="#/movimenti?${qs({ mese: meseOggi })}">Solo ${meseNome(meseOggi, { anno: false })}</a>`}
          <button class="btn primary" type="button" id="nuovo">${ICONE.piu}Nuovo movimento</button>
        </div>
      </div>
      <section class="panel" aria-label="Elenco dei movimenti">
        <div class="filters">
          <label class="search"><span class="sr">Cerca nella descrizione</span>${ICONE.cerca}<input class="input" type="search" id="q" placeholder="Cerca nella descrizione" value="${esc(f.q)}"></label>
          <label class="sr" for="f-persona">Persona</label>
          <select class="input" id="f-persona"><option value="">Tutte le persone</option>${store.meta.persone.map((p) => `<option value="${p.id}" ${String(p.id) === f.persona ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select>
          <label class="sr" for="f-categoria">Categoria</label>
          <select class="input" id="f-categoria"><option value="">Tutte le categorie</option>${opzioniCategorie(store, Number(f.categoria))}</select>
          <label class="sr" for="f-conto">Conto</label>
          <select class="input" id="f-conto"><option value="">Tutti i conti</option>${store.meta.conti.map((c) => `<option value="${c.id}" ${String(c.id) === f.conto ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select>
          <label class="check"><input type="checkbox" id="f-dc" ${f.da_classificare ? 'checked' : ''}><span>Solo da classificare</span></label>
          ${f.mese ? `<button class="card-link" type="button" id="tutti-mesi">Tutti i mesi</button>` : ''}
        </div>
        <div class="table-wrap"><table class="lista">
          <thead><tr><th>Data</th><th>Descrizione</th><th>Chi</th><th>Categoria</th><th class="n">Importo</th></tr></thead>
          <tbody id="righe"><tr><td colspan="5"><div class="skeleton" style="height:24px"></div></td></tr></tbody>
        </table></div>
        <div class="foot">
          <label class="check"><input type="checkbox" id="impara" ${impara ? 'checked' : ''}><span>Ricorda la categoria per le descrizioni simili</span></label>
          <span class="meta" id="pagina"></span>
        </div>
      </section>
    </div>`;

    const $ = (s) => el.querySelector(s);
    $('#nuovo').onclick = async () => { if (await nuovoMovimento(store)) aggiorna(); };
    $('#f-persona').onchange = (e) => vai({ persona: e.target.value });
    $('#f-categoria').onchange = (e) => vai({ categoria: e.target.value });
    $('#f-conto').onchange = (e) => vai({ conto: e.target.value });
    $('#f-dc').onchange = (e) => vai({ da_classificare: e.target.checked ? '1' : '' });
    $('#tutti-mesi')?.addEventListener('click', () => vai({ mese: '' }));
    let t; $('#q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { f.q = e.target.value.trim(); history.replaceState(null, '', '#/movimenti?' + qs()); carica(true); }, 250); };
    $('#impara').onchange = (e) => { impara = e.target.checked; localStorage.setItem('impara', impara ? '1' : '0'); };

    async function carica(daCapo) {
      dati = await api(`/api/movimenti?${qs({ limit: PAGINA, offset: daCapo ? 0 : righe.length })}`);
      righe = daCapo ? dati.righe : righe.concat(dati.righe);
      totale = dati.totale;
      disegna();
    }

    function disegna() {
      const periodo = f.mese ? cap(meseNome(f.mese)) : 'Tutti i mesi';
      $('#sub').innerHTML = `${periodo}: ${totale} movimenti, entrate <span class="num in">${euro(dati.entrate, { sign: true })}</span>, uscite <span class="num">${euro(dati.uscite)}</span>.`;
      const tb = $('#righe');
      if (!righe.length) {
        tb.innerHTML = `<tr><td colspan="5"><div class="empty">${f.q || f.categoria || f.persona || f.da_classificare ? 'Nessun movimento con questi filtri.' : `Nessun movimento in ${periodo.toLowerCase()}. <a class="card-link" href="#/importa">Importa l'estratto conto</a>`}</div></td></tr>`;
      } else {
        tb.innerHTML = righe.map((m) => {
          const conto = store.conto(m.conto_id);
          return `<tr data-id="${m.id}">
            <td class="data num">${dataBreve(m.data)}${f.mese ? '' : ` ${m.data.slice(2, 4)}`}</td>
            <td class="desc"><button class="link-btn" type="button" data-modifica="${m.id}"><span class="t">${esc(m.descrizione || '(senza descrizione)')}</span></button><span class="sub">${esc(conto?.nome || '')}${m.fonte === 'csv' ? ' · da estratto conto' : ''}${m.note && m.note !== 'esempio' ? ' · ' + esc(m.note) : ''}</span></td>
            <td class="chi">${personaChip(store.persona(m.persona_id))}</td>
            <td class="cat"><label class="sr" for="c-${m.id}">Categoria</label><select class="cat-select${m.categoria_id ? '' : ' vuota'}" id="c-${m.id}" data-cat="${m.id}"><option value="">Da classificare</option>${opzioniCategorie(store, m.categoria_id)}</select></td>
            <td class="n">${amountCell(m.importo)}</td>
          </tr>`;
        }).join('');
      }
      $('#pagina').innerHTML = righe.length < totale ? `${righe.length} di ${totale} · <button class="card-link" type="button" id="altri">Mostra altri</button>` : totale ? `${totale} di ${totale}` : '';
      $('#altri')?.addEventListener('click', () => carica(false));
    }

    $('#righe').addEventListener('change', async (e) => {
      const s = e.target.closest('[data-cat]');
      if (!s) return;
      const id = Number(s.dataset.cat), categoria_id = s.value ? Number(s.value) : null;
      await api(`/api/movimenti/${id}`, { method: 'PATCH', body: { categoria_id, impara: impara && !!categoria_id } });
      s.classList.toggle('vuota', !categoria_id);
      const m = righe.find((x) => x.id === id); if (m) m.categoria_id = categoria_id;
      toast(categoria_id ? `Classificato come ${store.categoria(categoria_id)?.nome}${impara ? ': lo ricorderò' : ''}` : 'Categoria tolta');
    });
    $('#righe').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-modifica]');
      if (!b) return;
      const m = righe.find((x) => x.id === Number(b.dataset.modifica));
      if (await nuovoMovimento(store, m)) carica(true);
    });

    await carica(true);
  },
};
