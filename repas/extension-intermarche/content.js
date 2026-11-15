// Repas de la semaine → panier Intermarché
// Reçoit la liste depuis l'appli (dans l'adresse : #repas=...), puis, article par article,
// ouvre la recherche Intermarché et clique sur le bouton « Ajouter » du premier produit.
// Si aucun bouton n'est trouvé, l'extension se met en pause et laisse la main.
'use strict';

(() => {
  const KEY = 'repasPanier';
  const SEARCH_URL = q => `https://www.intermarche.com/recherche/${encodeURIComponent(q)}`;
  const WAIT_BUTTON_MS = 12000;   // temps max pour que les résultats s'affichent
  const PAUSE_MIN_MS = 1500;      // pause entre deux articles (rythme humain)
  const PAUSE_MAX_MS = 3000;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function load() {
    try { return (await chrome.storage.local.get(KEY))[KEY] || null; } catch (e) { return null; }
  }
  async function store(state) {
    try { await chrome.storage.local.set({ [KEY]: state }); } catch (e) { /* ignore */ }
  }
  async function clear() {
    try { await chrome.storage.local.remove(KEY); } catch (e) { /* ignore */ }
  }

  /* ---------- 1. récupérer la liste envoyée par l'appli ---------- */
  function readHash() {
    const m = location.hash.match(/repas=([A-Za-z0-9_-]+)/);
    if (!m) return null;
    try {
      const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
      const json = new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
      const data = JSON.parse(json);
      if (!Array.isArray(data.items)) return null;
      return data.items
        .filter(i => i && typeof i.n === 'string' && i.n.trim())
        .map(i => ({ name: i.n.trim().slice(0, 80), qty: String(i.q || '').slice(0, 30), status: 'todo' }));
    } catch (e) { return null; }
  }

  /* ---------- 2. trouver le bouton « Ajouter au panier » ---------- */
  function isVisible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  }
  function labelOf(el) {
    return [el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('data-testid'), el.textContent]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }
  const EXCLUDE = /liste|favori|recette|magasin|adresse|carte|avis|coupon|comparer|créneau|creneau/i;

  function findAddButton() {
    const all = [...document.querySelectorAll('button, [role="button"]')]
      .filter(el => !el.disabled && el.getAttribute('aria-disabled') !== 'true' && isVisible(el));
    const scored = [];
    for (const el of all) {
      if (el.closest('header, nav, footer, [role="dialog"]')) continue;
      const label = labelOf(el);
      if (EXCLUDE.test(label)) continue;
      let score = 0;
      if (/ajouter au panier/i.test(label)) score = 3;
      else if (/ajouter/i.test(label)) score = 2;
      else if (/panier|add[-_ ]?to[-_ ]?cart/i.test(label)) score = 1;
      if (score) scored.push({ el, score });
    }
    if (!scored.length) return null;
    // meilleur libellé d'abord, puis le premier produit dans la page
    const best = Math.max(...scored.map(s => s.score));
    const top = scored.filter(s => s.score === best).map(s => s.el);
    top.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top
      || a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    return top[0];
  }

  async function waitForAddButton() {
    const start = Date.now();
    while (Date.now() - start < WAIT_BUTTON_MS) {
      const b = findAddButton();
      if (b) return b;
      await sleep(400);
    }
    return null;
  }

  // Le site demande-t-il de choisir un magasin ou de se connecter ?
  function blockingDialog() {
    const dlg = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')].find(isVisible);
    if (!dlg) return null;
    const t = dlg.textContent || '';
    if (/magasin|connect|identifi|code postal|retrait|livraison/i.test(t)) return dlg;
    return null;
  }

  /* ---------- 3. panneau d'information ---------- */
  let host, root;
  function ensurePanel() {
    if (root) return;
    host = document.createElement('div');
    host.id = 'repas-panier-ext';
    host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;';
    root = host.attachShadow({ mode: 'open' });
    (document.body || document.documentElement).appendChild(host);
  }

  const ICON = { todo: '•', added: '✅', manual: '✋', skipped: '⏭️' };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function render(state) {
    ensurePanel();
    const total = state.items.length;
    const done = state.items.filter(i => i.status !== 'todo').length;
    const cur = state.items[state.idx];
    const finished = state.idx >= total;
    let body = '';

    if (finished) {
      const added = state.items.filter(i => i.status === 'added' || i.status === 'manual').length;
      body = `
        <p><b>Terminé :</b> ${added} article${added > 1 ? 's' : ''} sur ${total} dans ton panier.</p>
        <p class="hint">Ajuste les quantités dans ton panier selon ce qu'il te faut :</p>
        <ul>${state.items.map(i => `<li>${ICON[i.status] || ''} ${esc(i.name)}${i.qty ? ` <span class="q">(${esc(i.qty)})</span>` : ''}${
          i.status === 'skipped' ? ` <a href="${esc(SEARCH_URL(i.name))}">chercher</a>` : ''}</li>`).join('')}</ul>
        <div class="row"><button data-a="close" class="primary">Fermer et effacer la liste</button></div>`;
    } else if (state.mode === 'ready') {
      body = `
        <p><b>${total} article${total > 1 ? 's' : ''}</b> à ajouter au panier.</p>
        <p class="hint">Avant de démarrer : connecte-toi et choisis ton magasin sur le site. Ensuite, laisse cet onglet ouvert pendant l'ajout (environ ${Math.ceil(total * 5 / 60)} min).</p>
        <div class="row"><button data-a="start" class="primary">Démarrer</button><button data-a="close">Annuler</button></div>`;
    } else if (state.mode === 'running') {
      body = `
        <p>Ajout en cours : <b>${esc(cur.name)}</b>${cur.qty ? ` <span class="q">(${esc(cur.qty)})</span>` : ''}</p>
        <div class="bar"><span style="width:${Math.round(done / total * 100)}%"></span></div>
        <p class="hint">${done} / ${total}</p>
        <div class="row"><button data-a="pause">Pause</button></div>`;
    } else { // paused / waiting
      body = `
        <p><b>${esc(cur.name)}</b>${cur.qty ? ` <span class="q">(${esc(cur.qty)})</span>` : ''}</p>
        <p class="warn">${esc(state.message || 'En pause.')}</p>
        <div class="bar"><span style="width:${Math.round(done / total * 100)}%"></span></div>
        <div class="row">
          ${state.mode === 'waiting' ? '<button data-a="manual" class="primary">C\'est ajouté, suivant</button>' : ''}
          <button data-a="resume" ${state.mode === 'waiting' ? '' : 'class="primary"'}>${state.mode === 'waiting' ? 'Réessayer' : 'Reprendre'}</button>
          <button data-a="skip">Passer</button>
          <button data-a="close">Arrêter</button>
        </div>`;
    }

    root.innerHTML = `
      <style>
        :host { all: initial; }
        .box { font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f2a2e; background: #fff;
          border: 1px solid #e3ddd3; border-radius: 14px; box-shadow: 0 8px 30px rgba(0,0,0,.18);
          width: 320px; max-height: 70vh; overflow: auto; padding: 14px 16px; }
        h3 { margin: 0 0 8px; font-size: 15px; color: #d9572b; }
        p { margin: 0 0 8px; }
        .hint { color: #5b6b70; font-size: 13px; }
        .warn { color: #8a4b00; background: #fff3e0; border-radius: 8px; padding: 6px 8px; font-size: 13px; }
        .q { color: #5b6b70; }
        ul { margin: 0 0 8px; padding-left: 4px; list-style: none; font-size: 13px; }
        li { padding: 2px 0; }
        a { color: #d9572b; }
        .row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
        button { font: inherit; font-size: 13px; border: 1px solid #e3ddd3; background: #fff; color: #1f2a2e;
          border-radius: 8px; padding: 6px 10px; cursor: pointer; }
        button.primary { background: #d9572b; border-color: #d9572b; color: #fff; font-weight: 600; }
        button:focus-visible { outline: 2px solid #d9572b; outline-offset: 2px; }
        .bar { height: 6px; background: #f1ece4; border-radius: 3px; overflow: hidden; margin: 6px 0; }
        .bar span { display: block; height: 100%; background: #d9572b; }
      </style>
      <div class="box" role="region" aria-label="Repas de la semaine">
        <h3>🛒 Repas de la semaine</h3>
        ${body}
      </div>`;

    root.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => onAction(b.dataset.a)));
  }

  /* ---------- 4. déroulé ---------- */
  async function onAction(a) {
    const state = await load();
    if (!state) return;
    if (a === 'close') { await clear(); host?.remove(); root = null; return; }
    if (a === 'pause') { state.mode = 'paused'; state.message = 'En pause.'; await store(state); render(state); return; }
    if (a === 'start' || a === 'resume') { state.mode = 'running'; state.message = ''; await store(state); return goToCurrent(state); }
    if (a === 'manual' || a === 'skip') {
      state.items[state.idx].status = a === 'manual' ? 'manual' : 'skipped';
      state.idx++; state.mode = 'running'; state.message = '';
      await store(state);
      return goToCurrent(state);
    }
  }

  async function goToCurrent(state) {
    if (state.idx >= state.items.length) { state.mode = 'done'; await store(state); render(state); return; }
    // on note l'article visé : à la page suivante (même redirigée), on sait quoi faire
    state.navIdx = state.idx;
    await store(state);
    render(state);
    location.href = SEARCH_URL(state.items[state.idx].name);
  }

  async function processCurrent(state) {
    render(state);
    const item = state.items[state.idx];
    const btn = await waitForAddButton();

    // l'utilisateur a pu mettre en pause pendant l'attente
    const fresh = await load();
    if (!fresh || fresh.mode !== 'running' || fresh.idx !== state.idx) return;

    if (!btn) {
      fresh.mode = 'waiting';
      fresh.message = 'Je n\'ai pas trouvé de bouton « Ajouter » pour ce produit. Ajoute-le toi-même, puis clique « C\'est ajouté ». Ou passe à l\'article suivant.';
      await store(fresh); render(fresh);
      return;
    }

    btn.scrollIntoView({ block: 'center' });
    await sleep(300);
    btn.click();
    await sleep(1500);

    if (blockingDialog()) {
      fresh.mode = 'paused';
      fresh.message = 'Le site demande de choisir un magasin ou de te connecter. Fais-le, puis clique « Reprendre ».';
      await store(fresh); render(fresh);
      return;
    }

    fresh.items[fresh.idx].status = 'added';
    fresh.idx++;
    await store(fresh);
    render(fresh);
    await sleep(PAUSE_MIN_MS + Math.random() * (PAUSE_MAX_MS - PAUSE_MIN_MS));

    const again = await load();
    if (!again || again.mode !== 'running') return;
    goToCurrent(again);
  }

  // lu tout de suite, avant que le site ne modifie l'adresse
  const incoming = readHash();
  const saved = incoming && incoming.length
    ? (history.replaceState(null, '', location.pathname + location.search),
       store({ items: incoming, idx: 0, mode: 'ready', message: '' }))
    : Promise.resolve();

  async function main() {
    await saved;
    const state = await load();
    if (!state) return;
    if (state.mode === 'running') {
      if (state.navIdx === state.idx) processCurrent(state); // page de recherche de l'article en cours
      else goToCurrent(state);
      return;
    }
    render(state);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main, { once: true });
  else main();
})();
