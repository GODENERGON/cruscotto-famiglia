// Panoramica: quanto resta libero questo mese, e i salvadanai arrivano in tempo?
import { api, esc, euro, euroBig, meseNome, meseBreve, cap, dataBreve, addMonths, mesiTra, ICONE, euroAxis, euroTip, toast } from '../ui.js';
import { aggiorna } from '../app.js';
import { nuovoMovimento } from './movimenti.js';

let serieScelta = 'libero';

export default {
  async monta(el, { params, store }) {
    const oggi = store.meta.oggi;
    const meseOggi = oggi.slice(0, 7);
    const mese = params.get('mese') || meseOggi;
    const d = await api(`/api/panoramica?mese=${mese}`);
    const r = d.riepilogo, p = d.proiezione;
    const corrente = mese === meseOggi;
    const potNome = (id) => d.salvadanai.find((s) => s.id === id)?.nome || 'salvadanaio';

    el.innerHTML = `<div class="wrap">
      <div class="title-row">
        <div><h1>Panoramica</h1><p class="sub">${trovaFinding(d, potNome, meseOggi)}</p></div>
        <div class="actions">
          <div class="scope" role="group" aria-label="Mese">
            <a class="btn ghost icon" href="#/panoramica?mese=${addMonths(mese, -1)}" aria-label="Mese precedente">${ICONE.indietro}</a>
            <span class="label">${cap(meseNome(mese))}</span>
            <a class="btn ghost icon" href="#/panoramica?mese=${addMonths(mese, 1)}" aria-label="Mese successivo">${ICONE.avanti}</a>
          </div>
          <button class="btn primary" type="button" id="nuovo">${ICONE.piu}Nuovo movimento</button>
        </div>
      </div>

      <div class="grid">
        <section class="panel span-8" aria-labelledby="t-mese">
          <header><h2 id="t-mese">${cap(meseNome(mese, { anno: false }))}, libero da allocare</h2><span class="meta">${r.movimenti} movimenti${r.da_classificare ? ` · <a class="card-link" href="#/movimenti?mese=${mese}&da_classificare=1">${r.da_classificare} da classificare</a>` : ''}</span></header>
          <div class="mese-head">
            <div>
              <p class="figure${r.libero < 0 ? ' neg' : ''}">${euroBig(r.libero)}</p>
              <p class="finding">${corrente && r.stima_fine_mese != null
                ? `Stima a fine mese <strong class="num">${euro(r.stima_fine_mese)}</strong>, dopo le spese ancora attese e i versamenti nei salvadanai.`
                : `Entrate meno uscite meno quanto è andato nei salvadanai.`}</p>
            </div>
            <dl class="mese-side">
              <div><dt class="label">Entrate</dt><dd class="figure in">${euroBig(r.entrate, { sign: true })}</dd></div>
              <div><dt class="label">Uscite</dt><dd class="figure">${euroBig(r.fisse + r.variabili)}</dd></div>
              <div><dt class="label">Nei salvadanai</dt><dd class="figure">${euroBig(-r.accantonato)}</dd></div>
            </dl>
          </div>
          ${corsie(r, store)}
          ${r.pendenti.length ? `<p class="pendenti"><span>Ancora attesi:</span>${r.pendenti.slice(0, 4).map((x) => `<span><strong class="num">${euro(x.importo, { sign: true })}</strong> ${esc(x.nome)}, ${dataBreve(x.data)}</span>`).join('')}</p>` : ''}
          <div class="sezione">
            <h3>Da sistemare</h3>
            ${daFare(d, r, mese, corrente)}
          </div>
        </section>

        <div class="stack span-4">
          <section class="panel" aria-labelledby="t-spese">
            <header><h2 id="t-spese">Spese grandi in arrivo</h2></header>
            ${eventi(p, potNome)}
          </section>
          <section class="panel" aria-labelledby="t-cat">
            <header><h2 id="t-cat">Dove sono andati</h2><a class="card-link" href="#/movimenti?mese=${mese}">${meseBreve(mese)}, uscite</a></header>
            ${r.categorie.length ? '<div class="chart" id="grafico-cat"></div>' : '<p class="empty">Nessuna uscita registrata in questo mese.</p>'}
          </section>
        </div>

        <section class="panel span-12" aria-labelledby="t-cassa">
          <header><h2 id="t-cassa">Cassa nei prossimi 24 mesi</h2><span class="meta">previsione da ricorrenze, spese pianificate e media delle variabili</span></header>
          <div class="cassa">
            <div class="cassa-chart">
              <div class="kpis" role="tablist" aria-label="Serie">
                ${[['libero', 'Libera', p.libero], ['totale', 'Sui conti', p.totale], ['destinato', 'Nei salvadanai', p.destinato]].map(([k, l, v]) => `
                  <button class="kpi" role="tab" type="button" data-serie="${k}" aria-selected="${k === serieScelta}">
                    <div class="kpi-label">${l}, fine ${meseBreve(p.mesi[0])}</div>
                    <div class="kpi-value num">${euro(v[0], { dec: 0 })}</div>
                  </button>`).join('')}
              </div>
              <div class="chart" id="grafico-cassa"></div>
              <p class="chart-note">${notaProiezione(p)}</p>
            </div>
            <div class="cassa-table">
              <h3>Mese per mese</h3>
              <table>
                <thead><tr><th>Mese</th><th class="n">Sui conti</th><th class="n">Libera</th></tr></thead>
                <tbody>${p.mesi.slice(0, 7).map((m, i) => `<tr><td>${cap(meseBreve(m, { anno: true }))}${p.eventi.some((e) => e.indice === i) ? ' <span class="pill acc" title="Spesa pianificata">spesa</span>' : ''}</td><td class="n">${euro(p.totale[i], { dec: 0 })}</td><td class="n"${p.libero[i] < 0 ? ' style="color:var(--negative)"' : ''}>${euro(p.libero[i], { dec: 0 })}</td></tr>`).join('')}</tbody>
              </table>
            </div>
          </div>
        </section>

        <section class="panel span-12" aria-labelledby="t-pots">
          <header><h2 id="t-pots">Salvadanai</h2><a class="card-link" href="#/salvadanai">Gestisci</a></header>
          ${salvadanai(d.salvadanai, p)}
        </section>
      </div>
    </div>`;

    el.querySelector('#nuovo').onclick = async () => { if (await nuovoMovimento(store)) aggiorna(); };
    el.querySelectorAll('[data-versa]').forEach((b) => b.onclick = async () => {
      const res = await api('/api/salvadanai/versa-mensili', { method: 'POST', body: { mese } });
      toast(res.versamenti ? `Registrati ${res.versamenti} versamenti: ${euro(res.totale)}` : 'Niente da versare questo mese');
      aggiorna();
    });

    const disegnaCassa = () => {
      const box = el.querySelector('#grafico-cassa');
      box.innerHTML = '';
      const valori = p[serieScelta].map((v) => v / 100);
      const ann = p.eventi.filter((e) => e.indice > 0 && e.indice < p.mesi.length).slice(0, 4)
        .map((e) => ({ at: e.indice, label: `${etichettaBreve(e.descrizione)} ${euro(e.importo, { dec: 0 })}`, short: etichettaBreve(e.descrizione) }));
      const neg = valori.some((v) => v < 0);
      Charts.line(box, {
        labels: p.mesi.map((m) => meseBreve(m, { anno: true })),
        series: [{ name: { libero: 'Liquidità libera', totale: 'Sui conti', destinato: 'Nei salvadanai' }[serieScelta], values: valori, colour: serieScelta === 'libero' ? undefined : getComputedStyle(document.documentElement).getPropertyValue('--text').trim() }],
        format: euroTip, tickFormat: euroAxis, height: 230, today: 0, todayLabel: 'Oggi',
        annotations: ann, reference: neg ? { value: 0, label: 'Zero' } : undefined,
      });
    };
    disegnaCassa();
    el.querySelectorAll('[data-serie]').forEach((b) => b.onclick = () => {
      serieScelta = b.dataset.serie;
      el.querySelectorAll('[data-serie]').forEach((x) => x.setAttribute('aria-selected', x === b));
      disegnaCassa();
    });

    if (r.categorie.length) {
      const top = r.categorie.slice(0, 5);
      const altre = r.categorie.slice(5).reduce((s, c) => s + c.importo, 0);
      const righe = top.map((c) => ({ label: c.nome, value: -c.importo / 100 }));
      if (altre) righe.push({ label: 'Altre', value: -altre / 100 });
      Charts.barList(el.querySelector('#grafico-cat'), righe, { format: euroTip, thin: true });
    }
  },
};

function etichettaBreve(s) { return s.replace(/\s*\(esempio\)/, '').replace(/IRPEF/, 'IRPEF').split(' ').slice(0, 3).join(' '); }

function corsie(r, store) {
  if (!r.corsie.length) return `<div class="empty" style="margin-top:24px">Ancora nessun movimento in questo mese. <a class="card-link" href="#/importa">Importa l'estratto conto</a></div>`;
  return `<div class="corsie" style="--n:${r.corsie.length}" aria-label="Il mese per persona">${r.corsie.map((c) => {
    const p = store.persona(c.persona_id);
    return `<div class="corsia" style="--tinta:${esc(p?.tinta)};--inchiostro:${esc(p?.inchiostro)}">
      <div class="chi"><span class="iniziale" aria-hidden="true">${esc(p?.nome[0])}</span>${esc(p?.nome)}</div>
      <dl>
        <dt>Entrate</dt><dd>${euro(c.entrate, { sign: true, dec: 0 })}</dd>
        <dt>Fisse</dt><dd>${euro(c.fisse, { dec: 0 })}</dd>
        <dt>Variabili</dt><dd>${euro(c.variabili, { dec: 0 })}</dd>
        <dt class="netto">Saldo</dt><dd class="netto">${euro(c.netto, { sign: true, dec: 0 })}</dd>
      </dl></div>`;
  }).join('')}</div>`;
}

function eventi(p, potNome) {
  const prossimi = p.eventi.slice(0, 4);
  if (!prossimi.length) return `<p class="empty">Nessuna spesa pianificata nei prossimi 24 mesi. <a class="card-link" href="#/salvadanai">Aggiungine una</a></p>`;
  return `<div class="rows">${prossimi.map((e) => `
    <div class="row">
      <div class="grow"><span class="title">${esc(e.descrizione)}</span>
        <span class="sub">${dataBreve(e.data)} ${e.data.slice(0, 4)} · ${e.salvadanaio_id ? esc(potNome(e.salvadanaio_id)) : 'dalla liquidità'}</span></div>
      <div class="amount"><span class="num">${euro(e.importo)}</span>
        <span class="sub">${e.mancante > 0 ? `<span class="pill warn">mancano ${euro(e.mancante, { dec: 0 })}</span>` : '<span class="pill pos">coperta</span>'}</span></div>
    </div>`).join('')}</div>`;
}

function daFare(d, r, mese, corrente) {
  const items = [];
  if (r.da_classificare) items.push(`<div class="row"><div class="grow"><span class="title">${r.da_classificare} movimenti senza categoria</span><span class="sub">restano fuori dalle statistiche per categoria</span></div><a class="btn sm" href="#/movimenti?mese=${mese}&da_classificare=1">Classifica</a></div>`);
  const daVersare = d.salvadanai.filter((s) => s.versamento_mensile > 0 && !s.mensile_fatto && !(s.obiettivo > 0 && s.saldo >= s.obiettivo));
  if (corrente && daVersare.length) {
    const tot = daVersare.reduce((s, x) => s + Math.min(x.versamento_mensile, x.obiettivo > 0 ? x.obiettivo - x.saldo : Infinity), 0);
    items.push(`<div class="row"><div class="grow"><span class="title">Versamenti di ${meseNome(mese, { anno: false })}</span><span class="sub">${daVersare.length} salvadanai, ${euro(tot)} in tutto</span></div><button class="btn sm" type="button" data-versa>Registra</button></div>`);
  }
  if (!d.stipendi) items.push(`<div class="row"><div class="grow"><span class="title">Stipendi come ricorrenze</span><span class="sub">senza le entrate fisse la previsione vede solo mutui e affitto</span></div><a class="btn sm" href="#/impostazioni/ricorrenze">Aggiungi</a></div>`);
  const conti0 = d.conti.filter((c) => c.saldo_iniziale === 0 && c.saldo === 0);
  if (conti0.length) items.push(`<div class="row"><div class="grow"><span class="title">Saldo di partenza dei conti</span><span class="sub">${conti0.map((c) => esc(c.nome)).join(', ')}: senza saldo la previsione parte da zero</span></div><a class="btn sm" href="#/impostazioni/conti">Inserisci</a></div>`);
  const u = d.ultimo_import;
  items.push(u
    ? `<div class="row"><div class="grow"><span class="title">Ultimo estratto conto il ${dataBreve(u.creato_il.slice(0, 10))}</span><span class="sub">${esc(u.conto || '')} · ${u.importate} movimenti</span></div><a class="btn sm" href="#/importa">Importa</a></div>`
    : `<div class="row"><div class="grow"><span class="title">Nessun estratto conto importato</span><span class="sub">il CSV della banca riempie mese, categorie e previsione</span></div><a class="btn sm" href="#/importa">Importa</a></div>`);
  return `<div class="rows">${items.slice(0, 4).join('')}</div>`;
}

function notaProiezione(p) {
  const base = p.mesi_storico ? `Spese variabili stimate in ${euro(p.media_variabili, { dec: 0 })} al mese, media degli ultimi ${p.mesi_storico} mesi.` : 'Ancora nessuno storico di spese variabili: la previsione conta solo ricorrenze e spese pianificate.';
  const min = p.minimo;
  if (min.indice === 0) return `${base} La liquidità libera non scende mai sotto il livello di oggi.`;
  return `${base} Il punto più basso della liquidità libera è a ${meseNome(min.mese)}: ${euro(min.libero, { dec: 0 })}.`;
}

function trovaFinding(d, potNome, meseOggi) {
  const p = d.proiezione;
  const vuoto = d.conti.every((c) => c.saldo_iniziale === 0) && !d.andamento.some((a) => a.entrate || a.fisse || a.variabili);
  if (vuoto || !d.stipendi) return `Per una previsione affidabile mancano ${[vuoto ? 'i saldi dei conti' : '', !d.stipendi ? 'gli stipendi' : ''].filter(Boolean).join(' e ')}: aggiungili in <a class="card-link" href="#/impostazioni/${vuoto ? 'conti' : 'ricorrenze'}">Impostazioni</a>.`;
  const entro = (e, n) => mesiTra(meseOggi, e.mese) <= n;
  const scoperta = p.eventi.find((e) => e.mancante > 0 && entro(e, 12));
  if (scoperta) return `Per <strong>${esc(scoperta.descrizione)}</strong> (${dataBreve(scoperta.data)}) mancano <strong class="num">${euro(scoperta.mancante)}</strong>${scoperta.salvadanaio_id ? ` nel salvadanaio ${esc(potNome(scoperta.salvadanaio_id))}` : ''}.`;
  if (p.minimo.libero < 0) return `A ${meseNome(p.minimo.mese)} la liquidità libera scende a <strong class="num">${euro(p.minimo.libero)}</strong>.`;
  const prossima = p.eventi[0];
  if (prossima) return `Prossima spesa grande: <strong>${esc(prossima.descrizione)}</strong>, ${dataBreve(prossima.data)}, <span class="num">${euro(prossima.importo)}</span>, già coperta.`;
  const ritardo = d.salvadanai.find((s) => s.ritardo_mesi > 0);
  if (ritardo) return `Il salvadanaio <strong>${esc(ritardo.nome)}</strong> arriva all'obiettivo con ${ritardo.ritardo_mesi} mesi di ritardo.`;
  return 'Nessuna spesa grande in vista: la cassa resta positiva per tutti i prossimi 24 mesi.';
}

function salvadanai(list, p) {
  if (!list.length) return '<p class="empty">Nessun salvadanaio. <a class="card-link" href="#/salvadanai">Creane uno</a></p>';
  return `<div class="rows">${list.map((s) => {
    const ratio = s.obiettivo > 0 ? Math.min(1, s.saldo / s.obiettivo) : 0;
    const regola = [s.versamento_mensile ? `${euro(s.versamento_mensile, { dec: 0 })} al mese` : '', s.quota_percento ? `${String(s.quota_percento).replace('.', ',')}% del canone` : ''].filter(Boolean).join(' · ') || 'nessun versamento automatico';
    return `<div class="pot-row">
      <div><span class="title" style="font-weight:600">${esc(s.nome)}</span><span class="sub meta" style="display:block">${regola}</span></div>
      <div class="bar-col">${s.obiettivo > 0
        ? `<div class="bar${ratio >= 1 ? ' done' : ''}" role="img" aria-label="${Math.round(ratio * 100)}% dell'obiettivo"><span style="width:${(ratio * 100).toFixed(1)}%"></span></div><div class="bar-ends"><span>0</span><span>${euro(s.obiettivo, { dec: 0 })}</span></div>`
        : `<span class="meta">Senza obiettivo</span>`}</div>
      <div class="r"><span class="figure sm">${euroBig(s.saldo)}</span></div>
      <div class="r stato">${statoPill(s)}</div>
    </div>`;
  }).join('')}</div>`;
}

export function statoPill(s) {
  const spesa = s.prossime?.[0];
  if (spesa && spesa.mancante > 0) return `<span class="pill warn">mancano ${euro(spesa.mancante, { dec: 0 })} a ${meseBreve(spesa.mese)}</span>`;
  if (s.obiettivo > 0 && s.saldo >= s.obiettivo) return '<span class="pill pos">obiettivo raggiunto</span>';
  if (spesa) return `<span class="pill pos">copre la spesa di ${meseBreve(spesa.mese)}</span>`;
  if (s.ritardo_mesi > 0) return `<span class="pill warn">${s.ritardo_mesi} mesi di ritardo</span>`;
  if (s.arrivo && s.scadenza) return `<span class="pill pos">in tempo, ${meseBreve(s.arrivo, { anno: true })}</span>`;
  if (s.arrivo) return `<span class="pill">arriva a ${meseBreve(s.arrivo, { anno: true })}</span>`;
  if (s.obiettivo > 0 && !s.versamento_mensile) return '<span class="pill">nessun versamento</span>';
  return '<span class="dash">—</span>';
}
