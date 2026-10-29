// Tempo: una sola lista di attività vista come calendario, to-do e Gantt.
import { api, esc, euro, dataBreve, meseNome, cap, ICONE, dialogo, toast, conferma, personaChip } from '../ui.js';
import { aggiorna } from '../app.js';

// ---------------------------------------------------------------- date (stesse regole del server)
const addDays = (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
const weekday = (d) => (new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7 + 1;
const monday = (d) => addDays(d, 1 - weekday(d));
const GIORNI = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
const GIORNI_LUNGHI = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'];
const durata = (min) => { if (!min) return '0 h'; const h = Math.floor(min / 60), m = Math.round(min % 60); return h && m ? `${h} h ${m}` : h ? `${h} h` : `${m} min`; };
const giornoLungo = (d) => `${GIORNI_LUNGHI[weekday(d) - 1]} ${Number(d.slice(8))} ${meseNome(d.slice(0, 7), { anno: false })}`;

// ---------------------------------------------------------------- modulo attività

export async function apriAttivita(store, id = null, preset = {}) {
  const [a, luoghi, tutte] = await Promise.all([
    id ? api(`/api/attivita/${id}`) : Promise.resolve(null),
    api('/api/luoghi'),
    api('/api/attivita'),
  ]);
  const v = a || { tipo: 'compito', ...preset };
  const progettoId = v.progetto_id;
  const candidati = tutte.filter((x) => x.id !== id && x.progetto_id && (!progettoId || x.progetto_id === progettoId));
  const nomeProg = (pid) => store.meta.progetti.find((p) => p.id === pid)?.nome || '';
  const r = await dialogo({
    titolo: a ? 'Modifica attività' : 'Nuova attività',
    conferma: a ? 'Salva' : 'Aggiungi',
    campi: [
      { nome: 'titolo', etichetta: 'Cosa', valore: v.titolo, largo: true, richiesto: true },
      { nome: 'tipo', etichetta: 'Tipo', tipo: 'select', vuota: false, opzioni: [{ value: 'compito', label: 'Compito da fare' }, { value: 'evento', label: 'Impegno con orario' }], valore: v.tipo },
      { nome: 'persona_id', etichetta: 'Chi', tipo: 'select', vuota: 'Tutta la famiglia', opzioni: store.meta.persone.filter((p) => p.ruolo !== 'famiglia').map((p) => ({ value: p.id, label: p.nome })), valore: v.persona_id },
      { nome: 'progetto_id', etichetta: 'Progetto', tipo: 'select', vuota: 'Nessuno', opzioni: store.meta.progetti.map((p) => ({ value: p.id, label: p.nome })), valore: v.progetto_id },
      { nome: 'luogo', etichetta: 'Dove', valore: v.luogo, suggerimenti: luoghi.length ? luoghi : ['Faedis', 'Costalunga', 'Monfalcone', 'Cividale', 'Udine'] },
      { nome: 'data', etichetta: 'Giorno (o inizio)', tipo: 'data', valore: v.data },
      { nome: 'fine', etichetta: 'Fine, se dura più giorni', tipo: 'data', valore: v.fine, mostraSe: ['tipo', ['compito']] },
      { nome: 'ora', etichetta: 'Ora', tipo: 'ora', valore: v.ora },
      { nome: 'durata_min', etichetta: 'Durata (minuti)', tipo: 'numero', valore: v.durata_min },
      { nome: 'scadenza', etichetta: 'Scadenza', tipo: 'data', valore: v.scadenza, mostraSe: ['tipo', ['compito']] },
      { nome: 'ripeti_ogni', etichetta: 'Si ripete', tipo: 'select', vuota: 'No', opzioni: [{ value: 'settimana', label: 'Ogni settimana' }, { value: 'mese', label: 'Ogni mese' }, { value: 'anno', label: 'Ogni anno' }], valore: v.ripeti?.ogni },
      { nome: 'ripeti_fino', etichetta: 'Fino al', tipo: 'data', valore: v.ripeti?.fino, mostraSe: ['ripeti_ogni', ['settimana', 'mese', 'anno']] },
      { nome: 'ripeti_giorni', etichetta: 'Nei giorni', tipo: 'giorni', valore: v.ripeti?.giorni || (v.data ? [weekday(v.data)] : []), mostraSe: ['ripeti_ogni', ['settimana']] },
      { nome: 'ripeti_intervallo', etichetta: 'Ogni quante settimane', tipo: 'numero', valore: v.ripeti?.intervallo || 1, mostraSe: ['ripeti_ogni', ['settimana']] },
      { nome: 'costo', etichetta: 'Costo stimato (€)', tipo: 'euro', valore: v.costo },
      ...(a ? [{ nome: 'stato', etichetta: 'Stato', tipo: 'select', vuota: false, opzioni: [{ value: 'da_fare', label: 'Da fare' }, { value: 'in_corso', label: 'In corso' }, { value: 'fatta', label: 'Fatta' }], valore: v.stato }] : []),
      { nome: 'dipende_da', etichetta: 'Può partire solo dopo', tipo: 'multi', valore: v.dipende_da || [], vuoto: progettoId ? 'Nessun\'altra attività in questo progetto' : 'Scegli un progetto e salva: poi potrai collegare le sue attività',
        opzioni: candidati.slice(0, 30).map((x) => ({ value: x.id, label: `${x.titolo}${progettoId ? '' : ' · ' + nomeProg(x.progetto_id)}` })), mostraSe: ['tipo', ['compito']] },
      { nome: 'note', etichetta: 'Note', tipo: 'textarea', valore: v.note === 'esempio' ? '' : v.note, largo: true },
    ],
    pericolo: a ? 'Elimina' : null,
    onPericolo: async () => {
      if (!(await conferma('Eliminare l\'attività?', `${a.titolo}${a.ripeti ? ', con tutte le sue ripetizioni' : ''}.`))) return false;
      await api(`/api/attivita/${id}`, { method: 'DELETE' });
      toast('Attività eliminata');
      return true;
    },
  });
  if (!r) return false;
  if (r.eliminato) return true;
  const body = {
    titolo: r.titolo, tipo: r.tipo, persona_id: r.persona_id, progetto_id: r.progetto_id, luogo: r.luogo || null,
    data: r.data || null, ora: r.ora || null, durata_min: r.durata_min || null, costo: r.costo, note: r.note || null,
    fine: r.tipo === 'compito' ? r.fine || null : null, scadenza: r.tipo === 'compito' ? r.scadenza || null : null,
    ripeti: r.ripeti_ogni ? { ogni: r.ripeti_ogni, ...(r.ripeti_ogni === 'settimana' ? { giorni: r.ripeti_giorni, intervallo: Math.max(1, r.ripeti_intervallo || 1) } : {}), ...(r.ripeti_fino ? { fino: r.ripeti_fino } : {}) } : null,
    dipende_da: r.tipo === 'compito' ? r.dipende_da : [],
  };
  if (body.ripeti && !body.data) { toast('Per ripetere un\'attività serve il giorno da cui parte', { errore: true }); return false; }
  if (body.ora && !body.data) { toast('Con l\'ora serve anche il giorno', { errore: true }); return false; }
  if (a) body.stato = r.stato;
  await api(a ? `/api/attivita/${id}` : '/api/attivita', { method: a ? 'PATCH' : 'POST', body });
  toast(a ? 'Attività aggiornata' : 'Attività aggiunta');
  return true;
}

async function apriProgetto(store, p = null) {
  const [luoghi, salvadanai] = await Promise.all([api('/api/luoghi'), api('/api/salvadanai')]);
  const aree = [...new Set(store.meta.progetti.map((x) => x.area).filter(Boolean))];
  const r = await dialogo({
    titolo: p ? `Modifica ${p.nome}` : 'Nuovo progetto',
    campi: [
      { nome: 'nome', etichetta: 'Nome', valore: p?.nome, largo: true, richiesto: true },
      { nome: 'area', etichetta: 'Area', valore: p?.area, suggerimenti: aree },
      { nome: 'stato', etichetta: 'Stato', tipo: 'select', vuota: false, opzioni: [['idea', 'Idea'], ['attivo', 'Attivo'], ['in_pausa', 'In pausa'], ['chiuso', 'Chiuso']].map(([value, label]) => ({ value, label })), valore: p?.stato || 'attivo' },
      { nome: 'persona_id', etichetta: 'Chi lo segue', tipo: 'select', vuota: 'Tutta la famiglia', opzioni: store.meta.persone.filter((x) => x.ruolo !== 'famiglia').map((x) => ({ value: x.id, label: x.nome })), valore: p?.persona_id },
      { nome: 'luogo', etichetta: 'Dove', valore: p?.luogo, suggerimenti: luoghi },
      { nome: 'inizio', etichetta: 'Inizio previsto', tipo: 'data', valore: p?.inizio, aiuto: 'Vuoto: lo prende dalle attività' },
      { nome: 'fine', etichetta: 'Fine prevista', tipo: 'data', valore: p?.fine },
      { nome: 'budget', etichetta: 'Budget (€)', tipo: 'euro', valore: p?.budget },
      { nome: 'salvadanaio_id', etichetta: 'Pagato dal salvadanaio', tipo: 'select', vuota: 'Nessuno', opzioni: salvadanai.filter((x) => !x.archiviato).map((x) => ({ value: x.id, label: x.nome })), valore: p?.salvadanaio_id },
      { nome: 'note', etichetta: 'Note', tipo: 'textarea', valore: p?.note, largo: true },
    ],
    pericolo: p ? 'Elimina' : null,
    onPericolo: async () => {
      if (!(await conferma(`Eliminare ${p.nome}?`, 'Le sue attività restano, senza progetto. Per toglierlo dalla vista senza perdere niente, mettilo in stato «Chiuso».'))) return false;
      await api(`/api/progetti/${p.id}`, { method: 'DELETE' });
      return true;
    },
  });
  if (!r) return false;
  if (!r.eliminato) {
    const body = { ...r, inizio: r.inizio || null, fine: r.fine || null, area: r.area || null, luogo: r.luogo || null };
    await api(p ? `/api/progetti/${p.id}` : '/api/progetti', { method: p ? 'PATCH' : 'POST', body });
    toast('Progetto salvato');
  }
  return true;
}

// ---------------------------------------------------------------- vista

const SCHEDE = { calendario: 'Calendario', todo: 'Da fare', gantt: 'Gantt' };

export default {
  async monta(el, { params, resto, store }) {
    const scheda = SCHEDE[resto[0]] ? resto[0] : 'calendario';
    const oggi = store.meta.oggi;
    el.innerHTML = `<div class="wrap">
      <div class="title-row">
        <div><h1>Tempo</h1><p class="sub" id="sub">&nbsp;</p></div>
        <div class="actions" id="azioni"></div>
      </div>
      <nav class="tabs" aria-label="Viste">${Object.entries(SCHEDE).map(([k, n]) => `<a href="#/tempo/${k}" aria-selected="${k === scheda}">${n}</a>`).join('')}</nav>
      <div id="corpo"></div>
    </div>`;
    const ctx = { el, params, store, oggi, sub: el.querySelector('#sub'), azioni: el.querySelector('#azioni'), corpo: el.querySelector('#corpo') };
    ctx.nuova = async (preset = {}) => { if (await apriAttivita(store, null, preset)) aggiorna(); };
    ctx.modifica = async (id) => { if (await apriAttivita(store, id)) aggiorna(); };
    if (scheda === 'calendario') await calendario(ctx);
    else if (scheda === 'todo') await todo(ctx);
    else await ganttVista(ctx);
  },
};

// ---------------------------------------------------------------- calendario

async function calendario(ctx) {
  const { params, store, oggi } = ctx;
  const modo = params.get('modo') === 'mese' ? 'mese' : 'settimana';
  const rif = /^\d{4}-\d{2}-\d{2}$/.test(params.get('da') || '') ? params.get('da') : oggi;
  const chi = params.get('chi') ? Number(params.get('chi')) : null;
  const primoMese = rif.slice(0, 8) + '01';
  const dal = modo === 'mese' ? monday(primoMese) : monday(rif);
  const al = modo === 'mese' ? addDays(dal, 41) : addDays(dal, 6);
  const d = await api(`/api/calendario?dal=${dal}&al=${al}`);
  const occ = d.occorrenze.filter((o) => !chi || o.persona_id === chi || o.persona_id == null);
  const link = (cambi) => '#/tempo/calendario?' + new URLSearchParams(Object.entries({ modo, da: rif, chi: chi ?? '', ...cambi }).filter(([, v]) => v !== '' && v != null)).toString();
  const passo = modo === 'mese' ? null : 7;
  const prec = modo === 'mese' ? addDays(primoMese, -1).slice(0, 8) + '01' : addDays(dal, -passo);
  const succ = modo === 'mese' ? addDays(addDays(primoMese, 31).slice(0, 8) + '01', 0) : addDays(dal, passo);
  const titoloPeriodo = modo === 'mese' ? cap(meseNome(primoMese.slice(0, 7))) : `${Number(dal.slice(8))} ${dal.slice(5, 7) === al.slice(5, 7) ? '' : meseNome(dal.slice(0, 7), { anno: false }) + ' '}– ${Number(al.slice(8))} ${meseNome(al.slice(0, 7))}`;

  // ore impegnate per persona (settimana)
  const ore = d.ore.filter((o) => o.persona_id);
  const settimanaOggi = monday(oggi) === dal && modo === 'settimana';
  const conta = occ.filter((o) => !(o.giorni > 1) || o.primo || o.data === dal);
  const restanti = occ.filter((o) => o.data >= oggi && o.stato !== 'fatta' && (!(o.giorni > 1) || o.primo) && (o.data > oggi || !o.ora || o.ora >= new Date().toTimeString().slice(0, 5)));
  ctx.sub.innerHTML = modo === 'settimana'
    ? `${settimanaOggi ? 'Questa settimana' : 'In questa settimana'}: ${conta.length} impegni${ore.length ? ', ' + ore.map((o) => `${esc(store.persona(o.persona_id)?.nome)} ${durata(o.cruscotto + o.altri)}`).join(', ') + ' con orario' : ''}.${settimanaOggi && restanti[0] ? ` Prossimo: <strong>${esc(restanti[0].titolo)}</strong>, ${restanti[0].data === oggi ? 'oggi' : giornoLungo(restanti[0].data)}${restanti[0].ora ? ' alle ' + restanti[0].ora : ''}.` : ''}`
    : `${cap(meseNome(primoMese.slice(0, 7)))}: ${conta.filter((o) => o.data.slice(0, 7) === primoMese.slice(0, 7)).length} impegni.`;
  ctx.azioni.innerHTML = `
    <div class="scope" role="group" aria-label="Periodo">
      <a class="btn ghost icon" href="${link({ da: prec })}" aria-label="Periodo precedente">${ICONE.indietro}</a>
      <span class="label">${titoloPeriodo}</span>
      <a class="btn ghost icon" href="${link({ da: succ })}" aria-label="Periodo successivo">${ICONE.avanti}</a>
    </div>
    <button class="btn primary" type="button" id="nuova">${ICONE.piu}Nuova attività</button>`;
  ctx.azioni.querySelector('#nuova').onclick = () => ctx.nuova({ data: rif >= dal && rif <= al ? rif : dal });

  const persone = store.meta.persone.filter((p) => p.ruolo !== 'famiglia');
  const filtri = `<div class="filters cal-filtri">
    <div class="segmented" role="group" aria-label="Vista">
      <a class="seg" href="${link({ modo: 'settimana' })}" aria-pressed="${modo === 'settimana'}">Settimana</a>
      <a class="seg" href="${link({ modo: 'mese' })}" aria-pressed="${modo === 'mese'}">Mese</a>
    </div>
    <a class="btn sm" href="${link({ da: oggi })}">Oggi</a>
    <span class="spacer"></span>
    <div class="chips" role="group" aria-label="Persona">
      <a class="chip${!chi ? ' on' : ''}" href="${link({ chi: '' })}">Tutti</a>
      ${persone.map((p) => `<a class="chip${chi === p.id ? ' on' : ''}" href="${link({ chi: p.id })}" style="--tinta:${esc(p.tinta)};--inchiostro:${esc(p.inchiostro)}"><span class="iniziale" aria-hidden="true">${esc(p.nome[0])}</span>${esc(p.nome)}</a>`).join('')}
    </div>
  </div>`;

  const voce = (o) => {
    const p = store.persona(o.persona_id);
    // un lavoro di più giorni si legge per intero solo il primo giorno visibile; gli altri giorni è una riga sola
    if (o.giorni > 1 && !o.primo && o.data !== dal) {
      return `<button type="button" class="ev cont" data-att="${o.id}" style="--tinta:${esc(p?.tinta || '#eef1f4')};--inchiostro:${esc(p?.inchiostro || '#3a3d40')}"><span class="ev-t">${esc(o.titolo)}</span><span class="sr">, continua${o.ultimo ? ', ultimo giorno' : ''}</span></button>`;
    }
    const fatta = o.stato === 'fatta';
    const extra = o.giorni > 1 ? (o.ultimo ? 'ultimo giorno' : `fino al ${dataBreve(o.fine)}`) : '';
    return `<button type="button" class="ev${fatta ? ' fatta' : ''}${o.tipo === 'compito' ? ' compito' : ''}" data-att="${o.id}" style="--tinta:${esc(p?.tinta || '#eef1f4')};--inchiostro:${esc(p?.inchiostro || '#3a3d40')}">
      <span class="ev-t">${o.ora ? `<span class="ev-ora num">${o.ora}</span>` : ''}${esc(o.titolo)}${o.ripetuta ? '<span class="sr"> (si ripete)</span>' : ''}</span>
      <span class="ev-s">${[p?.nome, o.luogo, extra].filter(Boolean).map(esc).join(' · ')}</span>
    </button>`;
  };

  let griglia;
  if (modo === 'settimana') {
    griglia = `<div class="settimana">${[...Array(7).keys()].map((i) => {
      const g = addDays(dal, i);
      const mie = occ.filter((o) => o.data === g).sort((a, b) => (a.ora ? 1 : 0) - (b.ora ? 1 : 0) || (a.ora || '').localeCompare(b.ora || ''));
      return `<section class="giorno${g === oggi ? ' oggi' : ''}${i >= 5 ? ' weekend' : ''}" aria-label="${giornoLungo(g)}">
        <header><span class="g-nome">${GIORNI[i]}</span><span class="g-num num">${Number(g.slice(8))}</span>
          <button type="button" class="btn ghost icon g-add" data-nuova="${g}" aria-label="Aggiungi ${giornoLungo(g)}">${ICONE.piu}</button></header>
        <div class="g-voci">${mie.map(voce).join('') || '<span class="g-vuoto">Libero</span>'}</div>
      </section>`;
    }).join('')}</div>`;
  } else {
    const mese = primoMese.slice(0, 7);
    griglia = `<div class="mese-griglia" role="grid" aria-label="${cap(meseNome(mese))}">
      ${GIORNI.map((g) => `<div class="m-intest" role="columnheader">${g}</div>`).join('')}
      ${[...Array(42).keys()].map((i) => {
        const g = addDays(dal, i);
        const mie = occ.filter((o) => o.data === g);
        return `<a role="gridcell" class="m-cella${g.slice(0, 7) !== mese ? ' fuori' : ''}${g === oggi ? ' oggi' : ''}" href="${link({ modo: 'settimana', da: g })}" aria-label="${giornoLungo(g)}: ${mie.length} impegni">
          <span class="m-num num">${Number(g.slice(8))}</span>
          ${mie.slice(0, 3).map((o) => { const p = store.persona(o.persona_id); return `<span class="m-voce" style="--tinta:${esc(p?.tinta || '#eef1f4')};--inchiostro:${esc(p?.inchiostro || '#3a3d40')}">${o.ora ? o.ora + ' ' : ''}${esc(o.titolo)}</span>`; }).join('')}
          ${mie.length > 3 ? `<span class="m-altri">+${mie.length - 3} altri</span>` : ''}
        </a>`;
      }).join('')}
    </div>`;
  }

  const oreHtml = modo === 'settimana' ? `<div class="ore-strip" aria-label="Ore con orario nella settimana">${persone.map((p) => {
    const o = d.ore.find((x) => x.persona_id === p.id);
    const tot = o ? o.cruscotto + o.altri : 0;
    return `<div class="ore-p"><span class="persona"><span class="iniziale" style="background:${esc(p.tinta)};color:${esc(p.inchiostro)}" aria-hidden="true">${esc(p.nome[0])}</span>${esc(p.nome)}</span>
      <span class="num ore-v">${durata(tot)}</span><span class="meta">${o?.altri ? `di cui ${durata(o.altri)} da Google Calendar` : 'impegni con orario'}</span></div>`;
  }).join('')}</div>` : '';

  ctx.corpo.innerHTML = `<section class="panel" aria-label="Calendario">${filtri}${griglia}${oreHtml}</section>`;
  ctx.corpo.addEventListener('click', (e) => {
    const b = e.target.closest('[data-att]'); if (b) return ctx.modifica(Number(b.dataset.att));
    const n = e.target.closest('[data-nuova]'); if (n) return ctx.nuova({ data: n.dataset.nuova });
  });
}

// ---------------------------------------------------------------- da fare

async function todo(ctx) {
  const { params, store, oggi } = ctx;
  const per = ['quando', 'luogo', 'progetto'].includes(params.get('per')) ? params.get('per') : 'quando';
  const righe = await api('/api/todo');
  const aperte = righe.filter((r) => r.stato !== 'fatta');
  const conta = (g) => aperte.filter((r) => r.gruppo === g).length;
  const rit = conta('in_ritardo'), og = conta('oggi'), sett = conta('settimana');
  ctx.sub.innerHTML = aperte.length
    ? `${aperte.length} compiti aperti${rit ? `, <strong>${rit} in ritardo</strong>` : ''}${og ? `, ${og} per oggi` : ''}${sett ? `, ${sett} entro domenica` : ''}.`
    : 'Nessun compito aperto.';
  ctx.azioni.innerHTML = `<button class="btn primary" type="button" id="nuova">${ICONE.piu}Nuovo compito</button>`;
  ctx.azioni.querySelector('#nuova').onclick = () => ctx.nuova();

  const NOMI = { in_ritardo: 'In ritardo', oggi: 'Oggi', settimana: 'Entro domenica', dopo: 'Più avanti', senza_data: 'Senza data', fatte: 'Fatte da ieri' };
  let gruppi;
  if (per === 'quando') gruppi = Object.keys(NOMI).map((k) => [NOMI[k], righe.filter((r) => r.gruppo === k)]);
  else {
    const chiave = (r) => (per === 'luogo' ? r.luogo || 'Ovunque' : r.progetto || 'Senza progetto');
    const nomi = [...new Set(aperte.map(chiave))].sort((a, b) => (a.startsWith('Ovunque') || a.startsWith('Senza') ? 1 : 0) - (b.startsWith('Ovunque') || b.startsWith('Senza') ? 1 : 0) || a.localeCompare(b));
    gruppi = nomi.map((n) => [n, aperte.filter((r) => chiave(r) === n)]);
  }
  gruppi = gruppi.filter(([, l]) => l.length);
  const nomeAtt = new Map(righe.map((r) => [r.id, r.titolo]));

  const riga = (r) => {
    const quando = r.scadenza || r.fine || r.data;
    const tardi = r.gruppo === 'in_ritardo';
    const sub = [r.progetto && per !== 'progetto' ? r.progetto : '', r.luogo && per !== 'luogo' ? r.luogo : '', r.scadenza ? 'scadenza' : r.fine && r.fine !== r.data ? `dal ${dataBreve(r.data)}` : ''].filter(Boolean).map(esc).join(' · ');
    return `<div class="row todo${r.stato === 'fatta' ? ' fatta' : ''}">
      <input type="checkbox" class="spunta" data-spunta="${r.id}" ${r.stato === 'fatta' ? 'checked' : ''} aria-label="Fatto: ${esc(r.titolo)}">
      <div class="grow"><button class="link-btn" type="button" data-att="${r.id}">${esc(r.titolo)}</button>
        <span class="sub">${sub}${r.bloccata ? `${sub ? ' · ' : ''}<span class="pill">dopo «${esc(r.aspetta[0])}»${r.aspetta.length > 1 ? ` e altre ${r.aspetta.length - 1}` : ''}</span>` : ''}</span></div>
      ${r.persona_id ? personaChip(store.persona(r.persona_id), { nome: false }) : ''}
      <span class="quando num${tardi ? ' neg' : ''}">${quando ? (quando === oggi ? 'oggi' : dataBreve(quando)) : '<span class="dash">—</span>'}</span>
    </div>`;
  };

  ctx.corpo.innerHTML = `<div class="grid top">
    <section class="panel span-8" aria-label="Compiti">
      <form class="aggiungi" id="aggiungi"><label class="sr" for="nuovo-titolo">Nuovo compito</label>
        <input class="input" id="nuovo-titolo" placeholder="Aggiungi un compito e premi Invio" autocomplete="off"><button class="btn" type="submit">Aggiungi</button></form>
      <div class="filters" style="margin-top:16px">
        <span class="label">Raggruppa per</span>
        <div class="segmented" role="group" aria-label="Raggruppa per">
          ${[['quando', 'Quando'], ['luogo', 'Luogo'], ['progetto', 'Progetto']].map(([k, n]) => `<a class="seg" href="#/tempo/todo?per=${k}" aria-pressed="${k === per}">${n}</a>`).join('')}
        </div>
      </div>
      ${gruppi.length ? gruppi.map(([n, l]) => `<h2 class="gruppo">${esc(n)} <span class="meta">${l.length}</span></h2><div class="rows">${l.map(riga).join('')}</div>`).join('')
        : '<p class="empty">Niente da fare. Aggiungi un compito qui sopra.</p>'}
    </section>
    <section class="panel span-4 giri" aria-labelledby="t-giri">
      <header><h2 id="t-giri">Giri da fare</h2></header>
      <p class="meta" style="margin-bottom:8px">Compiti aperti per luogo: quando vai lì, fai tutto in una volta.</p>
      ${giri(aperte)}
    </section>
  </div>`;

  ctx.corpo.querySelector('#aggiungi').onsubmit = async (e) => {
    e.preventDefault();
    const t = ctx.corpo.querySelector('#nuovo-titolo').value.trim();
    if (!t) return;
    await api('/api/attivita', { method: 'POST', body: { titolo: t, tipo: 'compito' } });
    toast('Compito aggiunto'); aggiorna();
  };
  ctx.corpo.addEventListener('change', async (e) => {
    const c = e.target.closest('[data-spunta]'); if (!c) return;
    await api(`/api/attivita/${c.dataset.spunta}`, { method: 'PATCH', body: { stato: c.checked ? 'fatta' : 'da_fare' } });
    c.closest('.row').classList.toggle('fatta', c.checked);
    toast(c.checked ? `Fatto: ${nomeAtt.get(Number(c.dataset.spunta))}` : 'Riaperto');
  });
  ctx.corpo.addEventListener('click', (e) => { const b = e.target.closest('[data-att]'); if (b) ctx.modifica(Number(b.dataset.att)); });

  function giri(lista) {
    const per = new Map();
    for (const r of lista) if (r.luogo) per.set(r.luogo, [...(per.get(r.luogo) || []), r]);
    if (!per.size) return '<p class="empty">Aggiungi un luogo ai compiti per vederli raggruppati qui.</p>';
    return `<div class="rows">${[...per].sort((a, b) => b[1].length - a[1].length).map(([l, rr]) => `<div class="row"><div class="grow"><span class="title">${esc(l)}</span><span class="sub">${rr.slice(0, 3).map((r) => esc(r.titolo)).join(' · ')}${rr.length > 3 ? ` e altri ${rr.length - 3}` : ''}</span></div><span class="num figure sm">${rr.length}</span></div>`).join('')}</div>`;
  }
}

// ---------------------------------------------------------------- Gantt

async function ganttVista(ctx) {
  const { store, oggi } = ctx;
  const prog = await api('/api/gantt');
  const datati = prog.filter((p) => p.inizio && p.attivita.some((a) => a.inizio));
  const altri = prog.filter((p) => !datati.includes(p));
  const prossima = datati.flatMap((p) => p.attivita.map((a) => ({ ...a, progetto: p.nome }))).filter((a) => a.stato !== 'fatta' && a.inizio).sort((a, b) => a.inizio.localeCompare(b.inizio))[0];
  const ritardi = datati.reduce((s, p) => s + p.in_ritardo, 0);
  ctx.sub.innerHTML = datati.length
    ? `${datati.length} progetti in calendario${ritardi ? `, <strong>${ritardi} attività in ritardo</strong>` : ''}.${prossima ? ` Prossima: <strong>${esc(prossima.titolo)}</strong> (${esc(prossima.progetto)}), ${prossima.inizio <= oggi ? 'in corso' : 'dal ' + dataBreve(prossima.inizio)}.` : ''}`
    : 'Nessun progetto ha ancora attività con date: aggiungine una per vederlo nel Gantt.';
  ctx.azioni.innerHTML = `<button class="btn" type="button" id="nuovo-prog">Nuovo progetto</button><button class="btn primary" type="button" id="nuova">${ICONE.piu}Nuova attività</button>`;
  ctx.azioni.querySelector('#nuova').onclick = () => ctx.nuova();
  ctx.azioni.querySelector('#nuovo-prog').onclick = async () => { if (await apriProgetto(store)) aggiorna(); };

  const STATI = { idea: 'Idea', attivo: 'Attivo', in_pausa: 'In pausa' };
  ctx.corpo.innerHTML = `
    ${datati.length ? `<section class="panel" aria-labelledby="t-gantt">
      <header><h2 id="t-gantt">Progetti nel tempo</h2>
        <ul class="chart-legend gantt-legenda" aria-label="Legenda">
          <li><span class="sw" style="background:var(--accent)"></span>Da fare</li>
          <li><span class="sw" style="background:var(--negative)"></span>In ritardo</li>
          <li><span class="sw" style="background:#a9d7b8"></span>Fatta</li>
          <li><span class="sw tratt"></span>Aspetta un'altra</li>
        </ul></header>
      <div class="gantt" id="gantt"></div>
    </section>` : ''}
    <section class="panel" style="margin-top:${datati.length ? 'var(--gap)' : '0'}" aria-labelledby="t-pian">
      <header><h2 id="t-pian">Da pianificare</h2><span class="meta">progetti senza attività con date</span></header>
      ${altri.length ? `<div class="table-wrap"><table class="lista">
        <thead><tr><th>Progetto</th><th>Area</th><th>Stato</th><th class="n">Budget</th><th class="n"><span class="sr">Azioni</span></th></tr></thead>
        <tbody>${altri.map((p) => `<tr>
          <td class="desc"><button class="link-btn" type="button" data-prog="${p.id}">${esc(p.nome)}</button><span class="sub">${p.totale ? `${p.totale} attività senza date` : 'nessuna attività'}${p.luogo ? ' · ' + esc(p.luogo) : ''}</span></td>
          <td class="chi">${esc(p.area || '—')}</td>
          <td class="cat"><span class="pill${p.stato === 'attivo' ? ' acc' : ''}">${STATI[p.stato] || p.stato}</span></td>
          <td class="n">${p.budget ? euro(p.budget, { dec: 0 }) : '<span class="dash">—</span>'}</td>
          <td class="n azioni"><button class="btn sm" type="button" data-agg="${p.id}">Aggiungi attività</button></td></tr>`).join('')}</tbody></table></div>`
        : '<p class="meta">Tutti i progetti aperti hanno attività in calendario.</p>'}
    </section>`;

  ctx.corpo.addEventListener('click', async (e) => {
    const pr = e.target.closest('[data-prog]');
    if (pr) { const p = prog.find((x) => x.id === Number(pr.dataset.prog)); if (await apriProgetto(store, p)) aggiorna(); return; }
    const ag = e.target.closest('[data-agg]'); if (ag) return ctx.nuova({ progetto_id: Number(ag.dataset.agg) });
    const at = e.target.closest('[data-att]'); if (at) return ctx.modifica(Number(at.dataset.att));
  });

  if (datati.length) disegnaGantt(ctx.corpo.querySelector('#gantt'), datati, oggi, store);
}

function disegnaGantt(box, progetti, oggi, store) {
  const righe = [];
  for (const p of progetti) {
    righe.push({ tipo: 'progetto', p });
    for (const a of p.attivita) if (a.inizio) righe.push({ tipo: 'att', a, p });
  }
  const date = progetti.flatMap((p) => [p.inizio, p.fine]).concat([oggi]).filter(Boolean).sort();
  const dal = monday(addDays(date[0], -3));
  const alMin = addDays(oggi, 56);
  const al = date.at(-1) > alMin ? addDays(date.at(-1), 7) : alMin;
  const giorni = daysBetween(dal, al) + 1;
  const RIGA = 40, TESTA = 58;
  const larghezzaVista = Math.max(320, box.clientWidth - (innerWidth < 700 ? 150 : 280));
  const dayW = Math.max(innerWidth < 700 ? 4 : 6, Math.min(28, larghezzaVista / giorni));
  const W = Math.ceil(giorni * dayW), H = TESTA + righe.length * RIGA;
  const x = (d) => daysBetween(dal, d) * dayW;
  const css = (n, f) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || f;
  const C = { acc: css('--accent', '#1d5fd6'), neg: css('--negative', '#c41c29'), ink: css('--text', '#1b1d1f'), muted: css('--muted', '#5c6064'), grid: css('--grid', '#ebedef'), rule: css('--rule', '#f0f1f2'), done: '#a9d7b8', track: css('--chart-track', '#e9ecef') };

  // colonna dei nomi (HTML, cliccabile)
  const etichette = righe.map((r) => r.tipo === 'progetto'
    ? `<div class="gl prog" style="height:${RIGA}px"><button class="link-btn" type="button" data-prog="${r.p.id}">${esc(r.p.nome)}</button><span class="meta num">${r.p.fatte}/${r.p.totale}${r.p.costo_attivita ? ' · ' + euro(r.p.costo_attivita, { dec: 0 }) : ''}</span></div>`
    : `<div class="gl att${r.a.stato === 'fatta' ? ' fatta' : ''}" style="height:${RIGA}px"><button class="link-btn" type="button" data-att="${r.a.id}">${esc(r.a.titolo)}</button></div>`).join('');

  // asse: mesi e settimane
  let assi = '';
  for (let d = dal; d <= al; d = addDays(d, 7)) assi += `<line x1="${x(d)}" y1="${TESTA - 8}" x2="${x(d)}" y2="${H}" stroke="${C.rule}" />`;
  for (let d = dal.slice(0, 8) + '01'; d <= al; d = addDays(d.slice(0, 8) + '28', 7).slice(0, 8) + '01') {
    if (d < dal) continue;
    assi += `<line x1="${x(d)}" y1="0" x2="${x(d)}" y2="${H}" stroke="${C.grid}" /><text x="${x(d) + 6}" y="16" font-size="12" fill="${C.muted}">${cap(meseNome(d.slice(0, 7), { anno: d.slice(5, 7) === '01' || d === dal.slice(0, 8) + '01' }))}</text>`;
  }
  for (let d = dal; d <= al; d = addDays(d, 7)) if (dayW * 7 >= 34) assi += `<text x="${x(d) + 4}" y="${TESTA - 8}" font-size="11" fill="${C.muted}">${Number(d.slice(8))}</text>`;

  // barre
  const pos = new Map();
  let barre = '';
  righe.forEach((r, i) => {
    const y = TESTA + i * RIGA;
    if (i) barre += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${C.rule}" />`;
    if (r.tipo === 'progetto') {
      const x0 = x(r.p.inizio), x1 = x(r.p.fine) + dayW;
      const frac = r.p.totale ? r.p.fatte / r.p.totale : 0;
      barre += `<rect x="${x0}" y="${y + 17}" width="${Math.max(4, x1 - x0)}" height="6" rx="3" fill="${C.track}"><title>${esc(r.p.nome)}: ${dataBreve(r.p.inizio)} – ${dataBreve(r.p.fine)}</title></rect>`;
      if (frac) barre += `<rect x="${x0}" y="${y + 17}" width="${Math.max(4, (x1 - x0) * frac)}" height="6" rx="3" fill="${C.ink}" />`;
      return;
    }
    const a = r.a, x0 = x(a.inizio), x1 = x(a.fine || a.inizio) + dayW;
    const tardi = a.stato !== 'fatta' && (a.fine || a.inizio) < oggi;
    const aspetta = a.dipende_da.some((id) => r.p.attivita.find((b) => b.id === id)?.stato !== 'fatta');
    const fill = a.stato === 'fatta' ? C.done : tardi ? C.neg : C.acc;
    pos.set(a.id, { x0, x1, y: y + RIGA / 2 });
    barre += `<g class="g-bar" data-att="${a.id}" tabindex="0" role="button" aria-label="${esc(a.titolo)}, ${dataBreve(a.inizio)} – ${dataBreve(a.fine || a.inizio)}">
      <rect x="${x0}" y="${y + 9}" width="${Math.max(6, x1 - x0)}" height="22" rx="4" fill="${aspetta && a.stato !== 'fatta' ? 'none' : fill}" stroke="${aspetta && a.stato !== 'fatta' ? fill : 'none'}" stroke-width="${aspetta ? 1.5 : 0}" stroke-dasharray="${aspetta ? '4 3' : ''}"/>
      <title>${esc(a.titolo)}: ${dataBreve(a.inizio)} – ${dataBreve(a.fine || a.inizio)}${a.costo ? ', ' + euro(a.costo, { dec: 0 }) : ''}</title></g>`;
  });
  // frecce delle dipendenze: dalla fine della precedente all'inizio della successiva
  let frecce = '';
  for (const p of progetti) for (const a of p.attivita) for (const dId of a.dipende_da) {
    const s = pos.get(dId), t = pos.get(a.id);
    if (!s || !t) continue;
    // se la successiva parte prima che la precedente finisca, la freccia passa nello spazio tra le righe
    const d = t.x0 - s.x1 >= 14
      ? `M${s.x1} ${s.y} H${s.x1 + 8} V${t.y} H${t.x0 - 2}`
      : `M${s.x1} ${s.y} H${s.x1 + 6} V${t.y - RIGA / 2} H${t.x0 - 8} V${t.y} H${t.x0 - 2}`;
    frecce += `<path d="${d}" fill="none" stroke="${C.muted}" stroke-width="1" marker-end="url(#freccia)" />`;
  }
  const oggiX = x(oggi) + dayW / 2;
  const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gantt dei progetti da ${dataBreve(dal)} a ${dataBreve(al)}" style="display:block;font-family:inherit">
    <defs><marker id="freccia" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 8 4 0 8z" fill="${C.muted}"/></marker></defs>
    ${assi}${barre}${frecce}
    <line x1="${oggiX}" y1="22" x2="${oggiX}" y2="${H}" stroke="${C.acc}" stroke-width="1.5" />
    <text x="${oggiX + 5}" y="34" font-size="11" fill="${C.ink}" font-weight="600">Oggi</text>
  </svg>`;
  box.innerHTML = `<div class="gantt-nomi" style="padding-top:${TESTA}px">${etichette}</div><div class="gantt-scroll" tabindex="0" aria-label="Linea del tempo, scorre in orizzontale">${svg}</div>`;
  const sc = box.querySelector('.gantt-scroll');
  sc.scrollLeft = Math.max(0, oggiX - 120);
  box.querySelectorAll('.g-bar').forEach((g) => g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); g.dispatchEvent(new MouseEvent('click', { bubbles: true })); } }));
}
