// Impostazioni: ricorrenze, conti, categorie, regole e persone. Una vista per area.
import { api, esc, euro, amountCell, meseNome, dataBreve, ICONE, dialogo, toast, conferma, personaChip } from '../ui.js';
import { aggiorna } from '../app.js';
import { googleCalendar } from './google.js';

const AREE = {
  ricorrenze: { nome: 'Ricorrenze', sub: 'Entrate e uscite che tornano ogni mese, trimestre o anno. Muovono la previsione di cassa.' },
  conti: { nome: 'Conti', sub: 'Il saldo di partenza e la data a cui si riferisce: da lì la previsione somma i movimenti.' },
  categorie: { nome: 'Categorie', sub: 'Le fisse pesano sulle uscite fisse del mese; i giroconti non contano né come entrate né come uscite.' },
  regole: { nome: 'Regole', sub: 'Se la descrizione contiene il testo, il movimento prende la categoria. Si aggiungono da sole quando classifichi.' },
  persone: { nome: 'Persone', sub: 'Ognuno ha la sua tinta: la vedi nelle corsie della panoramica.' },
  google: { nome: 'Google Calendar', sub: 'Le attività con una data finiscono in un calendario «Cruscotto Famiglia» sul tuo Google, e le modifiche fatte lì tornano qui.' },
};

export default {
  async monta(el, { resto, store, params }) {
    const area = AREE[resto[0]] ? resto[0] : 'ricorrenze';
    if (area === 'google') {
      el.innerHTML = `<div class="wrap">
        <div class="title-row"><div><h1>Impostazioni</h1><p class="sub">${AREE.google.sub}</p></div></div>
        <nav class="tabs" aria-label="Aree">${Object.entries(AREE).map(([k, a]) => `<a href="#/impostazioni/${k}" aria-selected="${k === area}">${a.nome}</a>`).join('')}</nav>
        <div id="google"></div></div>`;
      return googleCalendar(el.querySelector('#google'), { store, params });
    }
    const righe = await api(`/api/${area}`);
    const m = store.meta;
    const catOpt = (filtro) => m.categorie.filter(filtro || (() => true)).map((c) => ({ value: c.id, label: c.nome }));
    const perOpt = m.persone.map((p) => ({ value: p.id, label: p.nome }));

    const DEF = {
      ricorrenze: {
        colonne: ['Nome', 'Chi', 'Frequenza', 'Dal – al', 'Importo'],
        riga: (r) => [`<button class="link-btn" data-mod="${r.id}" type="button">${esc(r.nome)}</button><span class="sub">${esc(m.categorie.find((c) => c.id === r.categoria_id)?.nome || 'Senza categoria')}${r.attiva ? '' : ' · sospesa'}</span>`,
          personaChip(store.persona(r.persona_id)), `${{ 1: 'Ogni mese', 2: 'Ogni 2 mesi', 3: 'Ogni trimestre', 6: 'Ogni semestre', 12: 'Ogni anno' }[r.ogni_mesi] || `Ogni ${r.ogni_mesi} mesi`}, il ${r.giorno}`,
          `${meseNome(r.dal.slice(0, 7))}${r.al ? ` – ${meseNome(r.al.slice(0, 7))}` : ''}`, amountCell(r.importo)],
        campi: (r) => [
          { nome: 'nome', etichetta: 'Nome', valore: r?.nome, largo: true, richiesto: true },
          { nome: 'tipo', etichetta: 'Tipo', tipo: 'select', vuota: false, opzioni: [{ value: 'uscita', label: 'Uscita' }, { value: 'entrata', label: 'Entrata' }], valore: r && r.importo > 0 ? 'entrata' : 'uscita' },
          { nome: 'importo', etichetta: 'Importo (€)', tipo: 'euro', valore: r ? Math.abs(r.importo) : null, richiesto: true },
          { nome: 'ogni_mesi', etichetta: 'Frequenza', tipo: 'select', vuota: false, opzioni: [[1, 'Ogni mese'], [2, 'Ogni 2 mesi'], [3, 'Ogni trimestre'], [6, 'Ogni semestre'], [12, 'Ogni anno']].map(([value, label]) => ({ value, label })), valore: r?.ogni_mesi ?? 1 },
          { nome: 'giorno', etichetta: 'Giorno del mese', tipo: 'numero', valore: r?.giorno ?? 1 },
          { nome: 'dal', etichetta: 'Dal', tipo: 'data', valore: r?.dal || m.oggi.slice(0, 8) + '01', richiesto: true, aiuto: 'Per le annuali: il mese in cui cade' },
          { nome: 'al', etichetta: 'Fino a', tipo: 'data', valore: r?.al, aiuto: 'Vuoto = senza fine. Per un mutuo: l\'ultima rata' },
          { nome: 'categoria_id', etichetta: 'Categoria', tipo: 'select', opzioni: catOpt(), valore: r?.categoria_id, aiuto: 'Serve a riconoscere quando la ricorrenza è già arrivata' },
          { nome: 'persona_id', etichetta: 'Chi', tipo: 'select', opzioni: perOpt, valore: r?.persona_id },
          { nome: 'note', etichetta: 'Note', valore: r?.note === 'esempio' ? '' : r?.note, largo: true },
          { nome: 'attiva', etichetta: 'Attiva', tipo: 'checkbox', valore: r ? !!r.attiva : true },
        ],
        corpo: (v) => { const imp = v.tipo === 'entrata' ? Math.abs(v.importo) : -Math.abs(v.importo); delete v.tipo; return { ...v, importo: imp, giorno: Math.min(31, Math.max(1, v.giorno || 1)), attiva: v.attiva ? 1 : 0 }; },
      },
      conti: {
        colonne: ['Conto', 'Di chi', 'Saldo di partenza', 'Saldo oggi'],
        riga: (r) => { const c = store.conto(r.id); return [`<button class="link-btn" data-mod="${r.id}" type="button">${esc(r.nome)}</button><span class="sub">${esc(r.tipo)}${r.attivo ? '' : ' · chiuso'}</span>`, personaChip(store.persona(r.persona_id)), `${euro(r.saldo_iniziale)}<span class="sub">al ${dataBreve(r.data_saldo)} ${r.data_saldo.slice(0, 4)}</span>`, c ? euro(c.saldo) : '<span class="dash">—</span>']; },
        numeriche: [2, 3],
        campi: (r) => [
          { nome: 'nome', etichetta: 'Nome', valore: r?.nome, largo: true, richiesto: true },
          { nome: 'persona_id', etichetta: 'Di chi', tipo: 'select', opzioni: perOpt, valore: r?.persona_id },
          { nome: 'tipo', etichetta: 'Tipo', tipo: 'select', vuota: false, opzioni: ['corrente', 'carta', 'risparmio', 'contanti'].map((x) => ({ value: x, label: x })), valore: r?.tipo || 'corrente' },
          { nome: 'saldo_iniziale', etichetta: 'Saldo (€)', tipo: 'euro', valore: r?.saldo_iniziale ?? 0, aiuto: 'Il saldo letto in banca alla data qui accanto' },
          { nome: 'data_saldo', etichetta: 'Alla data', tipo: 'data', valore: r?.data_saldo || m.oggi, richiesto: true, aiuto: 'I movimenti dopo questa data si sommano al saldo' },
          { nome: 'attivo', etichetta: 'Conto attivo', tipo: 'checkbox', valore: r ? !!r.attivo : true },
        ],
        corpo: (v) => ({ ...v, saldo_iniziale: v.saldo_iniziale ?? 0, attivo: v.attivo ? 1 : 0 }),
      },
      categorie: {
        colonne: ['Categoria', 'Tipo', 'Natura', 'Area'],
        riga: (r) => [`<button class="link-btn" data-mod="${r.id}" type="button">${esc(r.nome)}</button>`, { entrata: 'Entrata', uscita: 'Uscita', giroconto: 'Giroconto' }[r.tipo], r.natura === 'fissa' ? 'Fissa' : 'Variabile', esc(r.area || '—')],
        campi: (r) => [
          { nome: 'nome', etichetta: 'Nome', valore: r?.nome, largo: true, richiesto: true },
          { nome: 'tipo', etichetta: 'Tipo', tipo: 'select', vuota: false, opzioni: [['uscita', 'Uscita'], ['entrata', 'Entrata'], ['giroconto', 'Giroconto']].map(([value, label]) => ({ value, label })), valore: r?.tipo || 'uscita' },
          { nome: 'natura', etichetta: 'Natura', tipo: 'select', vuota: false, opzioni: [['variabile', 'Variabile'], ['fissa', 'Fissa']].map(([value, label]) => ({ value, label })), valore: r?.natura || 'variabile' },
          { nome: 'area', etichetta: 'Area', valore: r?.area, aiuto: 'Casa, Maddalena, Immobili, DIY…' },
        ],
      },
      regole: {
        colonne: ['Se la descrizione contiene', 'Categoria', 'Chi'],
        riga: (r) => [`<button class="link-btn" data-mod="${r.id}" type="button">«${esc(r.testo)}»</button>`, esc(m.categorie.find((c) => c.id === r.categoria_id)?.nome || '—'), r.persona_id ? personaChip(store.persona(r.persona_id)) : '<span class="dash">—</span>'],
        campi: (r) => [
          { nome: 'testo', etichetta: 'Testo da cercare', valore: r?.testo, largo: true, richiesto: true, aiuto: 'Maiuscole e minuscole non contano' },
          { nome: 'categoria_id', etichetta: 'Categoria', tipo: 'select', opzioni: catOpt(), valore: r?.categoria_id, richiesto: true },
          { nome: 'persona_id', etichetta: 'Chi (facoltativo)', tipo: 'select', opzioni: perOpt, valore: r?.persona_id },
        ],
        corpo: (v) => ({ ...v, testo: v.testo.toLowerCase() }),
      },
      persone: {
        colonne: ['Persona', 'Ruolo'],
        riga: (r) => [`<button class="link-btn" data-mod="${r.id}" type="button">${personaChip(r)}</button>`, esc(r.ruolo || '—')],
        campi: (r) => [
          { nome: 'nome', etichetta: 'Nome', valore: r?.nome, largo: true, richiesto: true },
          { nome: 'ruolo', etichetta: 'Ruolo', tipo: 'select', vuota: false, opzioni: ['adulto', 'figlia', 'figlio', 'famiglia'].map((x) => ({ value: x, label: x })), valore: r?.ruolo || 'adulto' },
          { nome: 'tinta', etichetta: 'Tinta (sfondo)', valore: r?.tinta || '#eef1f4', aiuto: 'Un colore pallido, es. #dcebff' },
          { nome: 'inchiostro', etichetta: 'Inchiostro', valore: r?.inchiostro || '#3a3d40', aiuto: 'Lo stesso tono, scuro, es. #0a3a80' },
        ],
      },
    }[area];

    el.innerHTML = `<div class="wrap">
      <div class="title-row">
        <div><h1>Impostazioni</h1><p class="sub">${AREE[area].sub}</p></div>
        <div class="actions"><button class="btn primary" type="button" id="nuovo">${ICONE.piu}Aggiungi</button></div>
      </div>
      <nav class="tabs" aria-label="Aree">${Object.entries(AREE).map(([k, a]) => `<a href="#/impostazioni/${k}" aria-selected="${k === area}">${a.nome}</a>`).join('')}</nav>
      <section class="panel" aria-label="${AREE[area].nome}">
        ${righe.length ? `<div class="table-wrap"><table>
          <thead><tr>${DEF.colonne.map((c, i) => `<th class="${i === DEF.colonne.length - 1 && area === 'ricorrenze' || (DEF.numeriche || []).includes(i) ? 'n' : ''}">${c}</th>`).join('')}</tr></thead>
          <tbody>${righe.map((r) => `<tr>${DEF.riga(r).map((c, i) => `<td class="${i === DEF.colonne.length - 1 && area === 'ricorrenze' || (DEF.numeriche || []).includes(i) ? 'n' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>` : `<p class="empty">Ancora niente qui.</p>`}
      </section>
    </div>`;

    const apri = async (r) => {
      const v = await dialogo({
        titolo: r ? `Modifica` : `Aggiungi a ${AREE[area].nome.toLowerCase()}`,
        campi: DEF.campi(r),
        pericolo: r ? 'Elimina' : null,
        onPericolo: async () => {
          if (!(await conferma('Eliminare?', 'L\'elemento sparisce. I movimenti già registrati restano.'))) return false;
          await api(`/api/${area}/${r.id}`, { method: 'DELETE' });
          return true;
        },
      });
      if (!v) return;
      if (!v.eliminato) {
        const body = DEF.corpo ? DEF.corpo(v) : v;
        await api(r ? `/api/${area}/${r.id}` : `/api/${area}`, { method: r ? 'PATCH' : 'POST', body });
        toast('Salvato');
      }
      aggiorna();
    };
    el.querySelector('#nuovo').onclick = () => apri(null);
    el.querySelectorAll('[data-mod]').forEach((b) => (b.onclick = () => apri(righe.find((x) => x.id === Number(b.dataset.mod)))));
  },
};
