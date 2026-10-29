// Importa: dall'estratto conto CSV della banca ai movimenti, senza doppioni.
import { api, esc, euro, amountCell, dataBreve, toast, conferma } from '../ui.js';
import { opzioniCategorie } from './movimenti.js';

export default {
  async monta(el, { store }) {
    const profili = await api('/api/import/profili');
    const daClass = await api('/api/movimenti?da_classificare=1&limit=5');
    let lotti = await api('/api/import/lotti');
    const stato = { testo: null, file: null, conto_id: store.meta.conti[0]?.id ?? null, mappa: null, anteprima: null };

    el.innerHTML = `<div class="wrap">
      <div class="title-row">
        <div><h1>Importa estratto conto</h1><p class="sub">Scarica il CSV dalla banca, trascinalo qui e controlla le categorie prima di confermare. Le righe già importate vengono riconosciute e saltate.</p></div>
      </div>
      <div class="grid">
        <section class="panel span-8" aria-labelledby="t-file">
          <header><h2 id="t-file">File e conto</h2></header>
          <div class="map-grid" style="margin-bottom:16px">
            <div class="field"><label for="conto">Conto</label><select class="input" id="conto">${store.meta.conti.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}</select></div>
            <div class="field"><label for="profilo">Formato della banca</label><select class="input" id="profilo"><option value="">Riconosci da solo</option>${profili.map((p) => `<option value="${p.id}">${esc(p.nome)}</option>`).join('')}</select></div>
          </div>
          <label class="drop" id="drop" for="file" style="flex:1">
            <strong id="drop-t">Trascina qui il file CSV</strong>
            <span class="meta" id="drop-s">oppure scegli il file · CSV o TXT esportato dall'home banking</span>
            <input type="file" id="file" accept=".csv,.txt,text/csv" class="sr">
          </label>
        </section>
        <div class="stack span-4">
          <section class="panel" aria-labelledby="t-lotti">
            <header><h2 id="t-lotti">Import recenti</h2></header>
            <div id="lotti"></div>
          </section>
          <section class="panel" aria-labelledby="t-cosa">
            <header><h2 id="t-cosa">Cosa riconosce</h2></header>
            <ul class="facts">
              <li>Separatore punto e virgola, virgola o tabulazione</li>
              <li>Importo con segno, oppure colonne Dare e Avere</li>
              <li>Importi come 1.234,56 e date come 05/11/2026</li>
              <li>Le righe d'intestazione e i totali della banca vengono saltati</li>
              <li>Un movimento già importato non entra due volte</li>
            </ul>
          </section>
        </div>
      </div>
      <div id="passo2"></div>
      <section class="panel" style="margin-top:var(--gap)" aria-labelledby="t-dc" id="dc">
        <header><h2 id="t-dc">Ancora da classificare</h2>${daClass.totale ? `<a class="card-link" href="#/movimenti?da_classificare=1">Tutti i ${daClass.totale}</a>` : ''}</header>
        ${daClass.righe.length ? `<div class="rows">${daClass.righe.map((m) => `<div class="row"><div class="grow"><span class="title">${esc(m.descrizione)}</span><span class="sub">${dataBreve(m.data)} ${m.data.slice(0, 4)} · ${esc(store.conto(m.conto_id)?.nome || '')}</span></div><span class="amount num">${euro(m.importo, { sign: true })}</span></div>`).join('')}</div>`
          : '<p class="meta">Tutti i movimenti hanno una categoria.</p>'}
      </section>
    </div>`;

    const $ = (s) => el.querySelector(s);
    $('#conto').value = String(stato.conto_id);
    $('#conto').onchange = (e) => { stato.conto_id = Number(e.target.value); if (stato.testo) anteprima(); };
    $('#profilo').onchange = (e) => {
      const p = profili.find((x) => String(x.id) === e.target.value);
      stato.mappa = p ? p.mappa : null;
      if (p?.conto_id) { stato.conto_id = p.conto_id; $('#conto').value = String(p.conto_id); }
      if (stato.testo) anteprima();
    };
    const drop = $('#drop');
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) leggi(f); });
    $('#file').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) leggi(f); };

    disegnaLotti();

    async function leggi(file) {
      const buf = await file.arrayBuffer();
      let testo = new TextDecoder('utf-8').decode(buf);
      // molte banche esportano in Windows-1252: se l'UTF-8 non torna, rileggiamo
      if (testo.includes('�')) testo = new TextDecoder('windows-1252').decode(buf);
      stato.testo = testo; stato.file = file.name;
      $('#drop-t').textContent = file.name;
      $('#drop-s').textContent = `${(file.size / 1024).toLocaleString('it-IT', { maximumFractionDigits: 1 })} KB · scegli un altro file per sostituirlo`;
      anteprima();
    }

    async function anteprima() {
      try {
        stato.anteprima = await api('/api/import/anteprima', { method: 'POST', body: { testo: stato.testo, conto_id: stato.conto_id, mappa: stato.mappa } });
      } catch (e) { toast(e.message, { errore: true }); return; }
      stato.mappa = stato.anteprima.mappa;
      const conto = store.conto(stato.conto_id);
      stato.anteprima.righe.forEach((r) => { r.includi = !r.duplicato; r.persona_id = r.persona_id ?? conto?.persona_id ?? null; r.impara = false; });
      disegnaPasso2();
    }

    function colSelect(id, label, val, vuota) {
      const h = stato.mappa.intestazioni || [];
      return `<div class="field"><label for="${id}">${label}</label><select class="input" id="${id}">${vuota ? `<option value="-1">${vuota}</option>` : ''}${h.map((t, i) => `<option value="${i}" ${i === val ? 'selected' : ''}>${esc(t || `Colonna ${i + 1}`)}</option>`).join('')}</select></div>`;
    }

    function disegnaPasso2() {
      const a = stato.anteprima, m = stato.mappa;
      const nuove = a.righe.filter((r) => !r.duplicato), dup = a.righe.length - nuove.length;
      const scelte = a.righe.filter((r) => r.includi);
      const entrate = scelte.filter((r) => r.importo > 0).reduce((s, r) => s + r.importo, 0);
      const uscite = scelte.filter((r) => r.importo < 0).reduce((s, r) => s + r.importo, 0);
      const senza = scelte.filter((r) => !r.categoria_id).length;
      const dal = a.righe.map((r) => r.data).sort()[0], al = a.righe.map((r) => r.data).sort().at(-1);
      $('#passo2').innerHTML = `
      <div class="grid top" style="margin-top:var(--gap)">
        <section class="panel span-12" aria-labelledby="t-col">
          <header><h2 id="t-col">Colonne</h2><span class="meta">Riga di intestazione ${m.header_riga + 1} del file${a.da_mappare ? ' · scegli almeno data e importo' : ''}</span></header>
          <div class="map-grid">
            ${colSelect('m-data', 'Data', m.col_data)}
            ${colSelect('m-desc', 'Descrizione', m.col_descrizione, 'Nessuna')}
            ${colSelect('m-imp', 'Importo con segno', m.col_importo, 'Uso Dare e Avere')}
            ${m.col_importo < 0 ? colSelect('m-dare', 'Dare (uscite)', m.col_dare, 'Nessuna') + colSelect('m-avere', 'Avere (entrate)', m.col_avere, 'Nessuna') : ''}
            <div class="field"><label for="m-fd">Formato data</label><select class="input" id="m-fd">${['gg/mm/aaaa', 'mm/gg/aaaa', 'aaaa-mm-gg'].map((x) => `<option ${x === m.formato_data ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
          </div>
        </section>
        ${a.da_mappare ? '' : `
        <section class="panel span-12" aria-labelledby="t-righe">
          <header><h2 id="t-righe">Movimenti nel file</h2>
            <div class="summary">
              <span><span class="label">Periodo</span> <span class="num">${dal ? `${dataBreve(dal)} ${dal.slice(0, 4)} – ${dataBreve(al)} ${al.slice(0, 4)}` : '—'}</span></span>
              <span><span class="label">Nuovi</span> <span class="num">${nuove.length}</span></span>
              <span><span class="label">Già importati</span> <span class="num">${dup}</span></span>
              ${a.scartate.length ? `<span><span class="label">Righe ignorate</span> <span class="num">${a.scartate.length}</span></span>` : ''}
            </div>
          </header>
          ${a.righe.length ? `<div class="table-wrap"><table class="lista">
            <thead><tr><th class="chk"><span class="sr">Includi</span></th><th>Data</th><th>Descrizione</th><th>Categoria</th><th class="n">Importo</th></tr></thead>
            <tbody>${a.righe.map((r, i) => `<tr class="${r.duplicato ? 'dup' : ''}">
              <td class="chk"><input type="checkbox" data-incl="${i}" ${r.includi ? 'checked' : ''} aria-label="Includi riga ${r.riga}" style="width:18px;height:18px;accent-color:var(--text)"></td>
              <td class="data num">${dataBreve(r.data)}</td>
              <td class="desc"><span class="t">${esc(r.descrizione || '(senza descrizione)')}</span><span class="sub">${r.duplicato ? 'già importato' : r.regola ? `categoria da «${esc(r.regola)}»` : `riga ${r.riga}`}</span></td>
              <td class="cat"><label class="sr" for="ic-${i}">Categoria</label><select class="cat-select${r.categoria_id ? '' : ' vuota'}" id="ic-${i}" data-cat="${i}"><option value="">Da classificare</option>${opzioniCategorie(store, r.categoria_id)}</select></td>
              <td class="n">${amountCell(r.importo)}</td></tr>`).join('')}</tbody></table></div>`
            : '<p class="empty">Nessun movimento leggibile con queste colonne.</p>'}
          ${a.scartate.length ? `<details style="margin-top:12px"><summary class="meta" style="cursor:pointer">Righe ignorate (${a.scartate.length})</summary><ul class="meta" style="margin-top:8px">${a.scartate.slice(0, 20).map((s) => `<li>Riga ${s.riga}: ${esc(s.motivo)} · ${esc(s.testo)}</li>`).join('')}</ul></details>` : ''}
          <div class="foot" style="border-top:1px solid var(--rule);margin-top:16px;padding-top:16px">
            <div class="summary">
              <span><span class="label">Entrate</span> <span class="num in">${euro(entrate, { sign: true })}</span></span>
              <span><span class="label">Uscite</span> <span class="num">${euro(uscite)}</span></span>
              ${senza ? `<span class="pill warn">${senza} senza categoria</span>` : ''}
            </div>
            <div class="actions">
              <label class="sr" for="nome-profilo">Ricorda il formato come</label>
              <input class="input" id="nome-profilo" placeholder="Ricorda il formato come… (facoltativo)" style="width:260px">
              <button class="btn primary" type="button" id="importa" ${scelte.length ? '' : 'disabled'}>Importa ${scelte.length} movimenti</button>
            </div>
          </div>
        </section>`}
      </div>`;

      const rimappa = () => {
        const v = (id) => (el.querySelector(id) ? Number(el.querySelector(id).value) : -1);
        stato.mappa = { ...stato.mappa, col_data: v('#m-data'), col_descrizione: v('#m-desc'), col_importo: v('#m-imp'), col_dare: v('#m-dare'), col_avere: v('#m-avere'), formato_data: $('#m-fd').value };
        if (stato.mappa.col_importo < 0 && stato.mappa.col_dare < 0 && stato.mappa.col_avere < 0) { stato.mappa.col_dare = m.col_dare >= 0 ? m.col_dare : -1; }
        anteprima();
      };
      el.querySelectorAll('#passo2 [id^="m-"]').forEach((s) => (s.onchange = rimappa));
      el.querySelectorAll('[data-incl]').forEach((c) => (c.onchange = () => { a.righe[Number(c.dataset.incl)].includi = c.checked; disegnaPasso2(); }));
      el.querySelectorAll('[data-cat]').forEach((s) => (s.onchange = () => {
        const r = a.righe[Number(s.dataset.cat)];
        r.categoria_id = s.value ? Number(s.value) : null;
        r.impara = !!r.categoria_id;
        // la stessa descrizione più sotto prende la stessa categoria
        a.righe.forEach((x) => { if (x !== r && !x.categoria_id && x.descrizione === r.descrizione) x.categoria_id = r.categoria_id; });
        disegnaPasso2();
      }));
      $('#importa')?.addEventListener('click', async () => {
        const nome = $('#nome-profilo').value.trim();
        const res = await api('/api/import/conferma', { method: 'POST', body: { conto_id: stato.conto_id, file_nome: stato.file, righe: a.righe, profilo: nome || null, mappa: stato.mappa } });
        toast(`Importati ${res.importate} movimenti${res.duplicate ? `, ${res.duplicate} già presenti` : ''}${res.regole ? `, ${res.regole} nuove regole` : ''}`);
        stato.testo = null; stato.anteprima = null;
        $('#passo2').innerHTML = '';
        $('#drop-t').textContent = 'Trascina qui il file CSV';
        $('#drop-s').textContent = 'oppure scegli il file · CSV o TXT esportato dall\'home banking';
        lotti = await api('/api/import/lotti');
        disegnaLotti();
      });
    }

    function disegnaLotti() {
      const box = $('#lotti');
      if (!lotti.length) { box.innerHTML = '<p class="meta">Ancora nessun import. Il primo estratto conto riempie la panoramica e la media delle spese variabili.</p>'; return; }
      box.innerHTML = `<div class="rows">${lotti.slice(0, 5).map((l) => `<div class="row">
        <div class="grow"><span class="title">${esc(l.file_nome || 'Import')}</span><span class="sub">${esc(l.conto || '')} · ${dataBreve(l.creato_il.slice(0, 10))} · ${l.importate} movimenti</span></div>
        <button class="btn sm ghost" type="button" data-annulla="${l.id}">Annulla</button></div>`).join('')}</div>`;
      box.querySelectorAll('[data-annulla]').forEach((b) => (b.onclick = async () => {
        const l = lotti.find((x) => x.id === Number(b.dataset.annulla));
        if (!(await conferma('Annullare l\'import?', `Elimina i ${l.importate} movimenti importati da ${l.file_nome || 'questo file'}.`, 'Annulla import'))) return;
        const r = await api(`/api/import/lotti/${l.id}`, { method: 'DELETE' });
        toast(`Eliminati ${r.annullati} movimenti`);
        lotti = await api('/api/import/lotti');
        disegnaLotti();
      }));
    }
  },
};
