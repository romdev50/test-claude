// Repas de la semaine → panier Intermarché, version favori (bookmarklet) pour smartphone.
// À lancer sur www.intermarche.com. On colle la liste copiée depuis l'appli, puis pour chaque
// article, la recherche est chargée dans un cadre invisible du même site et le bouton
// « Ajouter » du premier produit est cliqué. La page reste affichée pendant tout l'ajout.
(() => {
  'use strict';
  if (window.__repasPanier) { window.__repasPanier.show(); return; }

  const SEARCH_URL = q => `https://www.intermarche.com/recherche/${encodeURIComponent(q)}`;
  const WAIT_BUTTON_MS = 15000;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- panneau ---------- */
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  document.body.appendChild(host);
  let stopped = false;

  const STYLE = `<style>
    :host { all: initial; }
    .box { font: 15px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f2a2e; background: #fff;
      border: 1px solid #e3ddd3; border-radius: 16px; box-shadow: 0 8px 30px rgba(0,0,0,.25);
      max-width: 480px; margin: 0 auto; max-height: 70vh; overflow: auto; padding: 14px 16px; box-sizing: border-box; }
    h3 { margin: 0 0 8px; font-size: 16px; color: #d9572b; display: flex; justify-content: space-between; align-items: center; }
    p { margin: 0 0 8px; }
    .hint { color: #5b6b70; font-size: 13px; }
    .warn { color: #8a4b00; background: #fff3e0; border-radius: 8px; padding: 6px 8px; font-size: 13px; }
    textarea { width: 100%; box-sizing: border-box; min-height: 110px; font: 14px system-ui, sans-serif; border: 1px solid #e3ddd3;
      border-radius: 10px; padding: 8px; color: #1f2a2e; background: #faf8f5; }
    ul { margin: 0 0 8px; padding: 0; list-style: none; font-size: 14px; }
    li { padding: 3px 0; }
    .q { color: #5b6b70; }
    a { color: #d9572b; }
    .row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    button { font: inherit; font-size: 15px; border: 1px solid #e3ddd3; background: #fff; color: #1f2a2e;
      border-radius: 10px; padding: 9px 14px; min-height: 42px; cursor: pointer; }
    button.primary { background: #d9572b; border-color: #d9572b; color: #fff; font-weight: 600; flex: 1; }
    button.x { min-height: 32px; padding: 2px 10px; }
    .bar { height: 8px; background: #f1ece4; border-radius: 4px; overflow: hidden; margin: 8px 0; }
    .bar span { display: block; height: 100%; background: #d9572b; transition: width .3s; }
  </style>`;

  function view(html) {
    root.innerHTML = `${STYLE}<div class="box" role="region" aria-label="Repas de la semaine">
      <h3>🛒 Repas de la semaine <button class="x" data-a="close" aria-label="Fermer">✕</button></h3>${html}</div>`;
    root.querySelector('[data-a="close"]').onclick = () => { stopped = true; host.remove(); frame?.remove(); delete window.__repasPanier; };
  }

  /* ---------- lecture de la liste collée ---------- */
  // Format de l'appli : « - spaghettis : 400 g » ; on accepte aussi un produit par ligne.
  function parse(text) {
    const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const dashed = lines.filter(l => /^[-•*]\s+/.test(l));
    const source = dashed.length ? dashed : lines.filter(l => !/^liste de courses$/i.test(l));
    return source.map(l => {
      const m = l.replace(/^[-•*]\s+/, '').match(/^(.+?)(?:\s+:\s+(.+))?$/);
      return { name: m[1].trim().slice(0, 80), qty: (m[2] || '').trim(), status: 'todo' };
    });
  }

  /* ---------- bouton « Ajouter au panier » dans le cadre ---------- */
  const EXCLUDE = /liste|favori|recette|magasin|adresse|carte|avis|coupon|comparer|créneau|creneau/i;
  function findAddButton(doc) {
    const win = doc.defaultView;
    const scored = [];
    for (const el of doc.querySelectorAll('button, [role="button"]')) {
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      if (el.closest('header, nav, footer, [role="dialog"]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      const cs = win.getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const label = [el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('data-testid'), el.textContent]
        .filter(Boolean).join(' ').replace(/\s+/g, ' ');
      if (EXCLUDE.test(label)) continue;
      const score = /ajouter au panier/i.test(label) ? 3 : /ajouter/i.test(label) ? 2 : /panier|add[-_ ]?to[-_ ]?cart/i.test(label) ? 1 : 0;
      if (score) scored.push({ el, score, top: r.top, left: r.left });
    }
    if (!scored.length) return null;
    const best = Math.max(...scored.map(s => s.score));
    return scored.filter(s => s.score === best).sort((a, b) => a.top - b.top || a.left - b.left)[0].el;
  }
  function blockingDialog(doc) {
    return [...doc.querySelectorAll('[role="dialog"], [aria-modal="true"]')]
      .find(d => d.getBoundingClientRect().width > 0 && /magasin|connect|identifi|code postal|retrait/i.test(d.textContent || ''));
  }

  /* ---------- déroulé ---------- */
  let frame;
  function loadInFrame(url) {
    return new Promise(resolve => {
      if (!frame) {
        frame = document.createElement('iframe');
        frame.setAttribute('aria-hidden', 'true');
        frame.tabIndex = -1;
        // largeur « ordinateur » pour obtenir la mise en page habituelle, placé hors de l'écran
        frame.style.cssText = 'position:fixed;left:-12000px;top:0;width:1200px;height:900px;border:0;';
        document.body.appendChild(frame);
      }
      const t = setTimeout(() => resolve(false), 30000);
      frame.onload = () => { clearTimeout(t); resolve(true); };
      frame.src = url;
    });
  }

  async function run(items) {
    stopped = false;
    for (let i = 0; i < items.length; i++) {
      if (stopped) return;
      const it = items[i];
      progress(items, i);
      await loadInFrame(SEARCH_URL(it.name));
      let doc;
      try { doc = frame.contentDocument; } catch (e) { doc = null; }
      if (!doc) return failure(items, 'Le site d\'Intermarché refuse l\'ajout automatique dans ce mode. Utilise les liens « chercher » ci-dessous.');
      let btn = null;
      const start = Date.now();
      while (!stopped && Date.now() - start < WAIT_BUTTON_MS && !(btn = findAddButton(doc))) await sleep(400);
      if (stopped) return;
      if (!btn) { it.status = 'skipped'; continue; }
      btn.click();
      await sleep(1500);
      if (blockingDialog(doc)) {
        return failure(items, 'Le site demande de choisir ton magasin ou de te connecter. Fais-le sur cette page, puis relance le favori.');
      }
      it.status = 'added';
      await sleep(800 + Math.random() * 1200);
    }
    done(items);
  }

  function progress(items, i) {
    view(`<p>Ajout en cours : <b>${esc(items[i].name)}</b>${items[i].qty ? ` <span class="q">(${esc(items[i].qty)})</span>` : ''}</p>
      <div class="bar"><span style="width:${Math.round(i / items.length * 100)}%"></span></div>
      <p class="hint">${i} / ${items.length} · garde l'écran allumé et reste sur cette page</p>
      <div class="row"><button data-a="stop">Arrêter</button></div>`);
    root.querySelector('[data-a="stop"]').onclick = () => { stopped = true; done(items); };
  }

  function summary(items) {
    return `<ul>${items.map(i => `<li>${i.status === 'added' ? '✅' : i.status === 'skipped' ? '⚠️' : '•'} ${esc(i.name)}${
      i.qty ? ` <span class="q">(${esc(i.qty)})</span>` : ''}${i.status !== 'added' ? ` <a href="${esc(SEARCH_URL(i.name))}">chercher</a>` : ''}</li>`).join('')}</ul>`;
  }

  function done(items) {
    const n = items.filter(i => i.status === 'added').length;
    view(`<p><b>Terminé :</b> ${n} article${n > 1 ? 's' : ''} sur ${items.length} ajouté${n > 1 ? 's' : ''} au panier.</p>
      <p class="hint">Ajuste les quantités dans ton panier. ⚠️ = pas trouvé automatiquement.</p>${summary(items)}
      <div class="row"><button class="primary" data-a="reload">Actualiser la page pour voir le panier</button></div>`);
    root.querySelector('[data-a="reload"]').onclick = () => location.reload();
    frame?.remove(); frame = null;
  }

  function failure(items, msg) {
    view(`<p class="warn">${esc(msg)}</p>${summary(items)}`);
    frame?.remove(); frame = null;
  }

  function start() {
    if (!/(^|\.)intermarche\.com$/.test(location.hostname)) {
      view('<p class="warn">Ouvre d\'abord www.intermarche.com, puis relance ce favori.</p>');
      return;
    }
    view(`<p>Colle ici la liste copiée depuis l'appli <b>Repas de la semaine</b> :</p>
      <textarea id="l" placeholder="- spaghettis : 400 g&#10;- œufs : 3"></textarea>
      <p class="hint">Avant de démarrer, sois connecté et ton magasin doit être choisi sur le site.</p>
      <div class="row"><button data-a="paste">Coller</button><button class="primary" data-a="go">Ajouter au panier</button></div>`);
    const ta = root.getElementById('l');
    root.querySelector('[data-a="paste"]').onclick = async () => {
      try { ta.value = await navigator.clipboard.readText(); } catch (e) { ta.focus(); }
    };
    root.querySelector('[data-a="go"]').onclick = () => {
      const items = parse(ta.value);
      if (!items.length) { ta.focus(); ta.placeholder = 'Colle d\'abord ta liste ici'; return; }
      run(items);
    };
  }

  window.__repasPanier = { show: () => { if (!host.isConnected) document.body.appendChild(host); } };
  start();
})();
