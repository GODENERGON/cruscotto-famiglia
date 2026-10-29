// Impostazioni › Google Calendar: credenziali, collegamento, calendari da leggere, sincronizzazione.
import { api, esc, toast, conferma } from '../ui.js';
import { aggiorna } from '../app.js';

const quando = (iso) => {
  if (!iso) return 'mai';
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return 'adesso';
  if (min < 60) return `${min} minuti fa`;
  const d = new Date(iso);
  return d.toLocaleString('it-IT', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
};

export async function googleCalendar(box, { store, params }) {
  const st = await api('/api/gcal/stato');
  const esito = params.get('esito');
  if (esito) {
    toast(esito === 'ok' ? 'Google Calendar collegato' : `Collegamento non riuscito: ${esito}`, { errore: esito !== 'ok' });
    history.replaceState(null, '', '#/impostazioni/google');
  }
  const locale = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const redirect = `${location.protocol}//${locale ? location.host : 'localhost:' + (location.port || 8790)}/api/gcal/callback`;

  const passo = (titolo, aiuto, contenuto) => `<div class="impostazione">
    <div class="imp-testo"><h2>${titolo}</h2><p class="meta">${aiuto}</p></div>
    <section class="panel">${contenuto}</section>
  </div>`;

  let html = '';
  if (!st.collegato) {
    html += passo('1. Credenziali Google',
      'Una volta sola: crei un «client OAuth» sul tuo account Google, così il cruscotto può scrivere nel tuo calendario. Nessun dato passa da altri server.',
      `<ol class="passi">
        <li>Apri <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener">console.cloud.google.com</a> e crea un progetto, per esempio «Cruscotto Famiglia».</li>
        <li>In <strong>API e servizi › Libreria</strong> cerca <strong>Google Calendar API</strong> e attivala.</li>
        <li>In <strong>Schermata di consenso OAuth</strong> scegli «Esterno», metti la tua email come utente di test e poi premi <strong>Pubblica app</strong>: in modalità test Google fa scadere il collegamento ogni 7 giorni.</li>
        <li>In <strong>Credenziali › Crea credenziali › ID client OAuth</strong> scegli «Applicazione web» e aggiungi questo URI di reindirizzamento:
          <span class="copia"><code id="uri">${esc(redirect)}</code><button class="btn sm" type="button" id="copia-uri">Copia</button></span></li>
        <li>Copia qui sotto l'ID client e il segreto client.</li>
      </ol>
      <form class="cred" id="cred">
        <div class="field"><label for="cid">ID client</label><input class="input" id="cid" autocomplete="off" placeholder="…apps.googleusercontent.com" value=""></div>
        <div class="field"><label for="csec">Segreto client</label><input class="input" id="csec" type="password" autocomplete="off" value=""></div>
        <div class="foot-form"><span class="meta">${st.configurato ? 'Credenziali già salvate: inseriscile di nuovo solo per cambiarle.' : 'Restano solo nel database del NUC.'}</span><button class="btn${st.configurato ? '' : ' primary'}" type="submit">Salva le credenziali</button></div>
      </form>`);
    html += passo('2. Collega il tuo account',
      'Google chiede il permesso di gestire i calendari. Il cruscotto crea un calendario suo e non tocca gli altri: li legge solo se glielo chiedi qui sotto.',
      !st.configurato ? '<p class="meta">Prima salva le credenziali del passo 1.</p>'
        : locale ? `<p>Si apre la pagina di Google: scegli il tuo account e consenti l'accesso. Se Google avvisa che l'app non è verificata, è normale per un'app personale: «Avanzate › Vai a Cruscotto Famiglia».</p><p style="margin-top:16px"><a class="btn primary" href="/api/gcal/collega">Collega Google Calendar</a></p>`
        : `<div class="notice">Google accetta il ritorno solo su <strong>localhost</strong>. Apri il cruscotto dal NUC stesso, all'indirizzo <code>http://localhost:${esc(location.port || '8790')}/#/impostazioni/google</code>, e collega da lì. Dopo, la sincronizzazione funziona da qualsiasi dispositivo.</div>`);
  } else {
    html += passo('Sincronizzazione',
      'Ogni 10 minuti, e 20 secondi dopo ogni modifica alle attività. Le attività con una data vanno nel calendario «Cruscotto Famiglia»; quelle create o cambiate lì tornano qui.',
      `<div class="sync">
        <div><span class="label">Ultima sincronizzazione</span><p class="figure sm">${esc(quando(st.ultimo_sync))}</p></div>
        <button class="btn primary" type="button" id="sync">Sincronizza ora</button>
      </div>
      ${st.errore ? `<div class="notice" style="margin-top:16px">L'ultimo tentativo non è riuscito: ${esc(st.errore)}</div>` : ''}
      ${st.esito ? `<dl class="esito">
        <div><dt>Inviate a Google</dt><dd class="num">${st.esito.inviate}</dd></div>
        <div><dt>Ricevute da Google</dt><dd class="num">${st.esito.ricevute + st.esito.create_da_google}</dd></div>
        <div><dt>Eliminate</dt><dd class="num">${st.esito.eliminate_su_google + st.esito.eliminate_da_google}</dd></div>
        <div><dt>Intervalli occupati letti</dt><dd class="num">${st.esito.occupato}</dd></div>
      </dl>` : ''}`);
    html += passo('Altri calendari',
      'Il lavoro di Denis, il calendario personale di Carmen: il cruscotto legge solo quando sei occupato, non i titoli, e lo conta nelle ore della settimana.',
      `<div id="calendari"><div class="skeleton" style="height:120px"></div></div>`);
    html += passo('Scollega',
      'Le attività restano nel cruscotto. Il calendario «Cruscotto Famiglia» resta sul tuo Google: se non ti serve più lo elimini da lì.',
      `<button class="btn danger" type="button" id="scollega">Scollega Google Calendar</button>`);
  }
  box.innerHTML = `<div class="impostazioni">${html}</div>`;

  box.querySelector('#copia-uri')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(redirect); toast('URI copiato'); } catch { toast('Seleziona e copia l\'URI a mano', { errore: true }); }
  });
  box.querySelector('#cred')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const client_id = box.querySelector('#cid').value.trim(), client_secret = box.querySelector('#csec').value.trim();
    if (!client_id.endsWith('.apps.googleusercontent.com')) return toast('L\'ID client finisce con .apps.googleusercontent.com', { errore: true });
    if (!client_secret) return toast('Manca il segreto client', { errore: true });
    await api('/api/gcal/credenziali', { method: 'POST', body: { client_id, client_secret } });
    toast('Credenziali salvate'); aggiorna();
  });
  box.querySelector('#sync')?.addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = 'Sincronizzo…';
    try {
      const r = await api('/api/gcal/sincronizza', { method: 'POST' });
      const x = r.esito;
      toast(`Fatto: ${x.inviate} inviate, ${x.ricevute + x.create_da_google} ricevute`);
    } catch (err) { toast(err.message, { errore: true }); }
    aggiorna();
  });
  box.querySelector('#scollega')?.addEventListener('click', async () => {
    if (!(await conferma('Scollegare Google Calendar?', 'La sincronizzazione si ferma. Le attività restano qui; il calendario «Cruscotto Famiglia» resta su Google.', 'Scollega'))) return;
    await api('/api/gcal/scollega', { method: 'POST' });
    toast('Scollegato'); aggiorna();
  });

  if (st.collegato) {
    const cbox = box.querySelector('#calendari');
    let lista;
    try { lista = await api('/api/gcal/calendari'); }
    catch (err) { cbox.innerHTML = `<p class="notice">Non riesco a leggere i calendari: ${esc(err.message)}</p>`; return; }
    const persone = store.meta.persone.filter((p) => p.ruolo !== 'famiglia');
    cbox.innerHTML = lista.length ? `<div class="rows">${lista.map((c, i) => `<div class="row">
        <label class="check grow"><input type="checkbox" data-cal="${i}" ${c.leggi ? 'checked' : ''}><span><span class="title">${esc(c.nome)}</span>${c.principale ? '<span class="sub">calendario principale</span>' : ''}</span></label>
        <label class="sr" for="pc-${i}">Di chi è</label>
        <select class="input" id="pc-${i}" data-per="${i}" style="width:auto">${['<option value="">Di chi?</option>', ...persone.map((p) => `<option value="${p.id}" ${c.persona_id === p.id ? 'selected' : ''}>${esc(p.nome)}</option>`)].join('')}</select>
      </div>`).join('')}</div>
      <div class="foot-form"><span class="meta">Per i calendari di Carmen: condividili con il tuo account Google, poi compaiono qui.</span><button class="btn" type="button" id="salva-cal">Salva</button></div>`
      : '<p class="meta">Nessun altro calendario sul tuo account.</p>';
    cbox.querySelector('#salva-cal')?.addEventListener('click', async () => {
      const leggi = lista.map((c, i) => ({ id: c.id, leggi: cbox.querySelector(`[data-cal="${i}"]`).checked, persona_id: Number(cbox.querySelector(`[data-per="${i}"]`).value) || null })).filter((c) => c.leggi);
      await api('/api/gcal/calendari', { method: 'POST', body: { leggi } });
      toast('Salvato: li leggo alla prossima sincronizzazione');
    });
  }
}
