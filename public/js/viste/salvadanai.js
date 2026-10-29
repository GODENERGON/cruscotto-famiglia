// Salvadanai: soldi già destinati, obiettivi e spese pianificate.
import { api, esc, euro, euroBig, meseNome, meseBreve, dataBreve, dataLunga, ICONE, dialogo, toast, conferma } from '../ui.js';
import { aggiorna } from '../app.js';
import { statoPill } from './panoramica.js';

export default {
  async monta(el, { store, params }) {
    const [pots, pian, proiez] = await Promise.all([api('/api/salvadanai/stato'), api('/api/uscite_pianificate'), api('/api/proiezione?mesi=36')]);
    const tutti = await api('/api/salvadanai');
    const mese = store.meta.oggi.slice(0, 7);
    const tot = pots.reduce((s, p) => s + p.saldo, 0);
    const liquidita = store.meta.conti.reduce((s, c) => s + c.saldo, 0);
    const daVersare = pots.filter((s) => s.versamento_mensile > 0 && !s.mensile_fatto && !(s.obiettivo > 0 && s.saldo >= s.obiettivo));
    let scelto = pots.some((p) => p.id === Number(params.get('id'))) ? Number(params.get('id')) : pots[0]?.id;
    const evento = (u) => proiez.eventi.find((e) => e.data === u.data && e.descrizione === u.descrizione);

    el.innerHTML = `<div class="wrap">
      <div class="title-row">
        <div><h1>Salvadanai</h1><p class="sub">Nei salvadanai <strong class="num">${euro(tot)}</strong>${liquidita > 0 ? `, il ${Math.round((tot / liquidita) * 100)}% della liquidità sui conti` : ''}. Sono soldi già destinati: la panoramica li toglie dal libero.</p></div>
        <div class="actions">
          ${daVersare.length ? `<button class="btn" type="button" id="versa">Registra i versamenti di ${meseNome(mese, { anno: false })}</button>` : ''}
          <button class="btn primary" type="button" id="nuovo">${ICONE.piu}Nuovo salvadanaio</button>
        </div>
      </div>
      <div class="grid top">
        <div class="stack span-7">
        <section class="panel" aria-labelledby="t-elenco">
          <header><h2 id="t-elenco">${pots.length} salvadanai</h2><span class="meta">ordinati per priorità</span></header>
          <div class="rows" role="listbox" aria-label="Salvadanai" id="elenco">${pots.map((s) => riga(s)).join('') || '<p class="empty">Nessun salvadanaio.</p>'}</div>
        </section>
      <section class="panel" aria-labelledby="t-pian">
        <header><h2 id="t-pian">Spese pianificate</h2><button class="btn sm" type="button" id="nuova-spesa">${ICONE.piu}Aggiungi spesa</button></header>
        ${pian.filter((u) => !u.fatta).length ? `<div class="table-wrap"><table class="lista">
          <thead><tr><th>Data</th><th>Descrizione</th><th>Pagata da</th><th class="n">Importo</th><th class="n">Copertura prevista</th></tr></thead>
          <tbody>${pian.filter((u) => !u.fatta).map((u) => { const e = evento(u); return `<tr>
            <td class="data num">${dataBreve(u.data)} ${u.data.slice(0, 4)}</td>
            <td class="desc"><button class="link-btn" type="button" data-spesa="${u.id}"><span class="t">${esc(u.descrizione)}</span></button></td>
            <td class="chi">${esc(tutti.find((p) => p.id === u.salvadanaio_id)?.nome || 'Liquidità')}</td>
            <td class="n">${euro(u.importo)}</td>
            <td class="n">${e ? (e.mancante > 0 ? `<span class="pill warn">mancano ${euro(e.mancante, { dec: 0 })}</span>` : '<span class="pill pos">coperta</span>') : '<span class="dash">—</span>'}</td></tr>`; }).join('')}</tbody></table></div>`
          : '<p class="empty">Nessuna spesa pianificata. Aggiungi le tasse, una vacanza o un acquisto: la previsione di cassa ne terrà conto.</p>'}
      </section>
        </div>
        <section class="panel span-5 dettaglio" id="dettaglio" aria-live="polite"></section>
      </div>
    </div>`;

    function riga(s) {
      const ratio = s.obiettivo > 0 ? Math.min(1, s.saldo / s.obiettivo) : 0;
      return `<button type="button" class="pot-item" role="option" data-pot="${s.id}" aria-selected="${s.id === scelto}">
        <span class="pot-nome"><span class="title">${esc(s.nome)}</span>
          ${s.obiettivo > 0 ? `<span class="bar${ratio >= 1 ? ' done' : ''}" aria-hidden="true"><span style="width:${(ratio * 100).toFixed(1)}%"></span></span>` : '<span class="sub">senza obiettivo</span>'}</span>
        <span class="pot-saldo num">${euro(s.saldo, { dec: 0 })}${s.obiettivo > 0 ? `<span class="sub">di ${euro(s.obiettivo, { dec: 0 })}</span>` : ''}</span>
        <span class="pot-stato">${statoPill(s)}</span>
      </button>`;
    }

    function dettaglio() {
      const s = pots.find((x) => x.id === scelto);
      const box = el.querySelector('#dettaglio');
      if (!s) { box.innerHTML = '<p class="empty">Crea il primo salvadanaio: tasse, emergenza, vacanza.</p>'; return; }
      const ratio = s.obiettivo > 0 ? Math.min(1, s.saldo / s.obiettivo) : 0;
      const quotaCat = store.categoria(s.quota_categoria_id);
      const causale = { manuale: 'Versamento', mensile: 'Versamento mensile', quota: 'Quota automatica', spesa: 'Prelievo' };
      box.innerHTML = `
        <header style="margin-bottom:0"><h2>${esc(s.nome)}</h2>${statoPill(s)}</header>
        <p class="figure" style="margin-top:8px">${euroBig(s.saldo)}</p>
        ${s.obiettivo > 0 ? `<div style="margin-top:14px"><div class="bar${ratio >= 1 ? ' done' : ''}" role="img" aria-label="${Math.round(ratio * 100)}% di ${euro(s.obiettivo)}"><span style="width:${(ratio * 100).toFixed(1)}%"></span></div><div class="bar-ends"><span>0</span><span>${euro(s.obiettivo, { dec: 0 })}</span></div></div>` : ''}
        <dl class="meta-list">
          <dt>Versamento mensile</dt><dd>${s.versamento_mensile ? euro(s.versamento_mensile) : '<span class="dash">—</span>'}${s.versamento_mensile ? `<span class="sub">${s.mensile_fatto ? 'fatto questo mese' : 'da fare questo mese'}</span>` : ''}</dd>
          ${s.quota_percento ? `<dt>Quota automatica</dt><dd>${String(s.quota_percento).replace('.', ',')}% di ${esc(quotaCat?.nome || '')}</dd>` : ''}
          ${s.scadenza ? `<dt>Serve entro</dt><dd>${meseNome(s.scadenza.slice(0, 7))}</dd>` : ''}
          ${s.prossime[0]?.mancante > 0
            ? `<dt>Alla spesa di ${meseBreve(s.prossime[0].mese, { anno: true })}</dt><dd>${euro(s.prossime[0].coperto, { dec: 0 })} su ${euro(-s.prossime[0].importo, { dec: 0 })}</dd>`
            : s.obiettivo > 0 ? `<dt>Arrivo previsto</dt><dd>${s.arrivo ? meseNome(s.arrivo) : '<span class="dash">—</span>'}</dd>` : ''}
        </dl>
        ${s.prossime.length ? `<h3 class="sotto">Spese che paga</h3><div class="spese">${s.prossime.map((e) => `<div class="spesa"><span>${esc(e.descrizione)}, ${dataBreve(e.data)} ${e.data.slice(0, 4)}</span><span class="num">${euro(e.importo, { dec: 0 })}</span></div>`).join('')}</div>` : ''}
        <h3 class="sotto">Ultimi movimenti</h3>
        ${s.ultimi.length ? `<div class="rows">${s.ultimi.slice(0, 4).map((u) => `<div class="row"><div class="grow"><span class="title">${causale[u.causale] || 'Movimento'}</span><span class="sub">${dataBreve(u.data)} ${u.data.slice(0, 4)}${u.nota ? ' · ' + esc(u.nota) : ''}</span></div><span class="amount num${u.importo > 0 ? ' in' : ''}">${euro(u.importo, { sign: true })}</span></div>`).join('')}</div>` : '<p class="meta">Ancora nessun versamento.</p>'}
        ${s.note ? `<p class="meta" style="margin-top:12px">${esc(s.note)}</p>` : ''}
        <div class="foot"><button class="btn sm" type="button" data-versa1="${s.id}">Versa</button><button class="btn sm" type="button" data-preleva="${s.id}">Preleva</button><button class="btn sm ghost" type="button" data-mod="${s.id}">${ICONE.matita}Modifica</button></div>`;
      collega(box);
    }

    const $ = (s) => el.querySelector(s);
    $('#versa')?.addEventListener('click', async () => {
      const r = await api('/api/salvadanai/versa-mensili', { method: 'POST', body: { mese } });
      toast(`Registrati ${r.versamenti} versamenti: ${euro(r.totale)}`); aggiorna();
    });
    $('#nuovo').onclick = () => modifica(null);
    $('#nuova-spesa').onclick = () => spesa(null);

    el.querySelectorAll('[data-spesa]').forEach((b) => (b.onclick = () => spesa(pian.find((p) => p.id === Number(b.dataset.spesa)))));
    function collega(root) {
    root.querySelectorAll('[data-mod]').forEach((b) => (b.onclick = () => modifica(tutti.find((p) => p.id === Number(b.dataset.mod)))));
    root.querySelectorAll('[data-versa1], [data-preleva]').forEach((b) => (b.onclick = async () => {
      const preleva = 'preleva' in b.dataset, id = Number(b.dataset.versa1 || b.dataset.preleva);
      const p = pots.find((x) => x.id === id);
      const r = await dialogo({
        titolo: `${preleva ? 'Preleva da' : 'Versa in'} ${p.nome}`,
        testo: preleva ? 'Il prelievo libera soldi: tornano nella liquidità disponibile.' : 'Il versamento sposta soldi dalla liquidità libera a questo salvadanaio. Il conto in banca non cambia.',
        campi: [{ nome: 'importo', etichetta: 'Importo (€)', tipo: 'euro', richiesto: true }, { nome: 'data', etichetta: 'Data', tipo: 'data', valore: store.meta.oggi }, { nome: 'nota', etichetta: 'Nota', largo: true }],
        conferma: preleva ? 'Preleva' : 'Versa',
      });
      if (!r) return;
      if (!r.importo || r.importo <= 0) return toast('Importo non valido', { errore: true });
      if (preleva && r.importo > p.saldo) return toast(`Nel salvadanaio ci sono solo ${euro(p.saldo)}`, { errore: true });
      await api(`/api/salvadanai/${id}/movimento`, { method: 'POST', body: { importo: preleva ? -r.importo : r.importo, data: r.data, nota: r.nota } });
      toast(`${preleva ? 'Prelevati' : 'Versati'} ${euro(r.importo)}`); aggiorna();
    }));
    }
    el.querySelector('#elenco').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pot]');
      if (!b) return;
      scelto = Number(b.dataset.pot);
      history.replaceState(null, '', '#/salvadanai?id=' + scelto);
      el.querySelectorAll('[data-pot]').forEach((x) => x.setAttribute('aria-selected', x === b));
      dettaglio();
      if (matchMedia('(max-width: 1180px)').matches) el.querySelector('#dettaglio').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    dettaglio();

    async function modifica(p) {
      const entrate = store.meta.categorie.filter((c) => c.tipo === 'entrata');
      const r = await dialogo({
        titolo: p ? `Modifica ${p.nome}` : 'Nuovo salvadanaio',
        campi: [
          { nome: 'nome', etichetta: 'Nome', valore: p?.nome, largo: true, richiesto: true },
          { nome: 'obiettivo', etichetta: 'Obiettivo (€)', tipo: 'euro', valore: p?.obiettivo || null, aiuto: 'Vuoto se non ha un tetto, come le tasse' },
          { nome: 'scadenza', etichetta: 'Serve entro', tipo: 'data', valore: p?.scadenza },
          { nome: 'versamento_mensile', etichetta: 'Versamento mensile (€)', tipo: 'euro', valore: p?.versamento_mensile || null },
          { nome: 'priorita', etichetta: 'Priorità', tipo: 'numero', valore: p?.priorita ?? 5, aiuto: 'Più alta, più in alto in elenco' },
          { nome: 'quota_percento', etichetta: 'Quota automatica (%)', tipo: 'numero', valore: p?.quota_percento || null, aiuto: 'Parte di ogni entrata della categoria qui sotto' },
          { nome: 'quota_categoria_id', etichetta: 'Su entrate di', tipo: 'select', opzioni: entrate.map((c) => ({ value: c.id, label: c.nome })), valore: p?.quota_categoria_id },
          { nome: 'note', etichetta: 'Note', tipo: 'textarea', valore: p?.note, largo: true },
        ],
        pericolo: p ? 'Archivia' : null,
        onPericolo: async () => {
          if (!(await conferma(`Archiviare ${p.nome}?`, 'Sparisce dalle viste e dalla previsione. I versamenti fatti restano nello storico.', 'Archivia'))) return false;
          await api(`/api/salvadanai/${p.id}`, { method: 'PATCH', body: { archiviato: 1 } });
          return true;
        },
      });
      if (!r) return;
      if (!r.eliminato) {
        const body = { ...r, obiettivo: r.obiettivo || 0, versamento_mensile: r.versamento_mensile || 0, quota_percento: r.quota_percento || 0, priorita: r.priorita ?? 0 };
        if (p) await api(`/api/salvadanai/${p.id}`, { method: 'PATCH', body }); else await api('/api/salvadanai', { method: 'POST', body });
        toast('Salvadanaio salvato');
      }
      aggiorna();
    }

    async function spesa(u) {
      const r = await dialogo({
        titolo: u ? 'Modifica spesa pianificata' : 'Nuova spesa pianificata',
        testo: 'Una spesa futura e sicura: tasse, assicurazione, un acquisto deciso. Se la paga un salvadanaio, la previsione controlla che basti.',
        campi: [
          { nome: 'descrizione', etichetta: 'Descrizione', valore: u?.descrizione, largo: true, richiesto: true },
          { nome: 'importo', etichetta: 'Importo (€)', tipo: 'euro', valore: u ? -u.importo : null, richiesto: true },
          { nome: 'data', etichetta: 'Data', tipo: 'data', valore: u?.data, richiesto: true },
          { nome: 'salvadanaio_id', etichetta: 'Pagata da', tipo: 'select', vuota: 'Liquidità libera', opzioni: tutti.filter((p) => !p.archiviato).map((p) => ({ value: p.id, label: p.nome })), valore: u?.salvadanaio_id },
          ...(u ? [{ nome: 'fatta', etichetta: 'Già pagata (esce dalla previsione)', tipo: 'checkbox', valore: !!u.fatta }] : []),
        ],
        pericolo: u ? 'Elimina' : null,
        onPericolo: async () => {
          if (!(await conferma('Eliminare la spesa?', `${u.descrizione}, ${dataLunga(u.data)}.`))) return false;
          await api(`/api/uscite_pianificate/${u.id}`, { method: 'DELETE' });
          return true;
        },
      });
      if (!r) return;
      if (!r.eliminato) {
        const body = { ...r, importo: -Math.abs(r.importo), fatta: r.fatta ? 1 : 0 };
        if (u) await api(`/api/uscite_pianificate/${u.id}`, { method: 'PATCH', body }); else await api('/api/uscite_pianificate', { method: 'POST', body });
        toast('Spesa salvata');
      }
      aggiorna();
    }
  },
};
