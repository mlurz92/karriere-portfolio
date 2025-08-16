/* ==========================================================================
   File: js/app.js (REVISION)
   Rolle: Senior UX/Frontend-Architekt · Karriere-/Vergütungs-Strategieberater
   Ziel:
   - Single-Page-App-Logik (Router, Views, Command-Palette, Export)
   - Daten-Layer (careers.json), TV-Ärzte/St. Georg Kalkulations-Engine (11/2024, 04/2025, 09/2025, 04/2026)
   - Tracks-Explorer (Filter, Suche, Modals), Vergleich (Radar-Chart)
   - Robuste Fallbacks (ohne Vendor-Libs lauffähig), Barrierefreiheit, Tastaturbedienung

   Abhängigkeiten (optional; via vendor.js geladen, Guards vorhanden):
   - window.VENDOR: { gsap, ScrollTrigger, lottie, tippy, Vivus, Splide, Notyf, Fuse, Chart }
   - window.vendorReady: Promise<boolean>
   - window.mountCarousels(): Splide re-mount für dynamische Inhalte

   Kompatibilität:
   - IDs/Selektoren abgestimmt auf index.html & style.css Revision
   ========================================================================== */

(() => {
  "use strict";

  /* --------------------------------------------------------------
   * 0) Mini-Utilities
   * -------------------------------------------------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const on = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);
  const off = (el, ev, fn) => el && el.removeEventListener(ev, fn);
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const isNum = (n) => typeof n === "number" && Number.isFinite(n);

  const fmtCurr = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
  const fmtInt = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
  const fmtDate = (d) => new Date(d).toLocaleDateString("de-DE");

  const parseDeNumber = (txt) => {
    if (typeof txt === "number") return txt;
    if (txt == null) return 0;
    const normalized = String(txt).replace(/\./g, "").replace(/\s/g, "").replace(",", ".");
    const n = Number(normalized);
    return Number.isFinite(n) ? n : 0;
  };

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const supportsDialog = "HTMLDialogElement" in window;

  /* --------------------------------------------------------------
   * 1) Globals & State
   * -------------------------------------------------------------- */
  const VENDOR = window.VENDOR || {};
  const Outlet = $("#viewOutlet");

  const State = {
    data: null,           // Loaded careers.json
    idx: null,            // Tariff index
    route: "overview",    // Current route
    selectedCompare: new Set(JSON.parse(localStorage.getItem("cmp") || "[]")),
    searchIndex: null,    // Fuse index
  };

  // Notifications (Notyf-fallback auf eigene Toasts)
  const notifier = (() => {
    if (VENDOR.Notyf) {
      return new VENDOR.Notyf({
        duration: 3500,
        position: { x: "right", y: "bottom" },
        dismissible: true
      });
    }
    // simple in-app toast
    const host = $("#toasts");
    const toast = (msg, cls = "") => {
      if (!host) return console.log(`[toast] ${msg}`);
      const el = document.createElement("div");
      el.className = `toast ${cls}`;
      el.innerHTML = `
        <div aria-hidden="true">🔔</div>
        <div>${msg}</div>
        <button aria-label="Schließen">✕</button>
      `;
      host.appendChild(el);
      const close = () => el.remove();
      on(el.querySelector("button"), "click", close, { once: true });
      setTimeout(close, 3500);
    };
    return {
      success: (m) => toast(m, "toast--success"),
      error:   (m) => toast(m, "toast--danger"),
      open:    (o) => toast(o?.message || String(o))
    };
  })();

  // Persist compare selection
  const saveCompare = () => localStorage.setItem("cmp", JSON.stringify([...State.selectedCompare]));

  /* --------------------------------------------------------------
   * 2) Router
   * -------------------------------------------------------------- */
  const Router = (() => {
    const routes = new Map();

    const register = (name, fn) => routes.set(name, fn);

    const parseHash = () => {
      const h = location.hash.replace(/^#\/?/, "");
      return h || "overview";
    };

    const render = async () => {
      const name = parseHash();
      State.route = name;
      Outlet.setAttribute("aria-busy", "true");
      Outlet.innerHTML = skeletonFor(name);
      await sleep(10); // micro-yield for paint

      if (!routes.has(name)) {
        await routes.get("overview")?.();
      } else {
        try {
          await routes.get(name)();
        } catch (e) {
          Outlet.innerHTML = errorBlock(e);
        }
      }

      Outlet.setAttribute("aria-busy", "false");
      animateIn(Outlet);
      // Tooltips re-bind (optional)
      if (VENDOR.tippy) {
        try { VENDOR.tippy("[title]", { delay: [250, 0], allowHTML: false, arrow: true }); } catch {}
      }
      // Carousels re-mount (optional)
      if (window.mountCarousels) window.mountCarousels();
    };

    const goto = (name) => {
      if (!name) name = "overview";
      const current = location.hash.replace(/^#\/?/, "");
      if (current !== name) location.hash = `#/${name}`;
      else render();
    };

    const init = () => {
      // Intercept all data-nav links (delegation on document)
      on(document, "click", (e) => {
        const a = e.target.closest("a[data-nav]");
        if (!a) return;
        e.preventDefault();
        goto(a.getAttribute("data-nav"));
      });

      on(window, "hashchange", render);
      on(window, "load", render);
    };

    return { register, render, goto, init };
  })();

  // Skeleton blocks per route for perceived performance
  const skeletonFor = (name) => {
    if (name === "tracks") {
      return `
        <section class="section-space">
          <div class="tracks-controls">
            <div class="search"><div class="skeleton-line" style="height:46px;"></div></div>
            <div class="segmented"><div class="skeleton-line" style="width:220px;"></div></div>
          </div>
          <div class="skeleton-grid">
            <div class="skeleton-card"></div>
            <div class="skeleton-card"></div>
            <div class="skeleton-card"></div>
          </div>
        </section>
      `;
    }
    if (name === "calculator") {
      return `
        <section class="calc section-space">
          <div class="calc__grid">
            <div class="panel"><div class="skeleton-grid"><div class="skeleton-card"></div><div class="skeleton-card"></div></div></div>
            <div class="panel"><div class="skeleton-grid"><div class="skeleton-card"></div><div class="skeleton-card"></div></div></div>
          </div>
        </section>
      `;
    }
    return `<div class="skeleton-grid"><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div></div>`;
  };

  const errorBlock = (e) => `
    <section class="section-space">
      <div class="card">
        <h3 class="section-title">Unerwarteter Fehler</h3>
        <p class="muted">Die Ansicht konnte nicht geladen werden.</p>
        <pre class="mt" style="white-space:pre-wrap">${String(e && e.message || e)}</pre>
      </div>
    </section>
  `;

  /* --------------------------------------------------------------
   * 3) Animations (optional via GSAP)
   * -------------------------------------------------------------- */
  const animateIn = (root = document) => {
    try {
      const nodes = $$(".card, .panel, .fade-in", root);
      if (VENDOR.gsap && nodes.length) {
        VENDOR.gsap.set(nodes, { autoAlpha: 0, y: 10 });
        VENDOR.gsap.to(nodes, { autoAlpha: 1, y: 0, duration: .45, ease: "power2.out", stagger: 0.04 });
      }
    } catch {/* no-op */}
  };

  /* --------------------------------------------------------------
   * 4) Daten-Layer: careers.json laden & indizieren
   *    Erwartetes Schema (harmonisiert zur Kalkulationsengine):
   *    tariff: {
   *      weekly_hours: Number,
   *      entgelttabellen: [{ valid_from: "YYYY-MM-DD", table: { EG_I:[...], EG_II:[...], EG_III:[...], EG_IV:[...] } }],
   *      bd_hourly: [{ valid_from, by_eg: { EG_I:Number, EG_II:Number, EG_III:Number, EG_IV:Number } }],
   *      rb_factors: { slotKey: { I:Number, II:Number, III:Number }, ... },
   *      rb_taxfree: { slotKey: Number(%), ... },
   *      schichtzulage: [{ valid_from, eur_per_month }],
   *      wechselschicht_nacht_eur_per_h: [{ valid_from, eur_per_hour }]
   *    }
   * -------------------------------------------------------------- */
  const loadData = async () => {
    try {
      const res = await fetch("data/careers.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      State.data = normalizeData(data);
      State.idx = buildTariffIndex(State.data.tariff);
      buildSearchIndex(State.data);
      return true;
    } catch (e) {
      notifier.error("Daten konnten nicht geladen werden. Minimaldaten werden verwendet.");
      console.warn("[data] load fallback:", e);
      // Minimal-Fallback (nur damit App bedienbar bleibt)
      State.data = minimalDataset();
      State.idx = buildTariffIndex(State.data.tariff);
      buildSearchIndex(State.data);
      return false;
    }
  };

  const normalizeData = (data) => {
    // Defensive normalisierung (Felder sicherstellen)
    data = data || {};
    data.profile = data.profile || {};
    data.tracks = Array.isArray(data.tracks) ? data.tracks : [];
    data.sources = Array.isArray(data.sources) ? data.sources : [];
    data.tariff = data.tariff || {};
    // Entgelttabellen-Feldnamen harmonisieren (EG-II -> EG_II)
    if (Array.isArray(data.tariff.entgelttabellen)) {
      data.tariff.entgelttabellen.forEach(t => {
        if (t && t.table) {
          const fixed = {};
          Object.keys(t.table).forEach(k => {
            const std = k.replace("-", "_").replace(" ", "_");
            fixed[std] = t.table[k];
          });
          t.table = fixed;
        }
      });
    }
    return data;
  };

  const minimalDataset = () => ({
    profile: {
      name: "Dr. med. Markus Lurz",
      title: "Facharzt für Radiologie · MRT · IT/KI",
      location: "Leipzig, Deutschland",
      summary: "Radiologie (MRT/CT/Röntgen), Protokollbau, Teleradiologie, syngo.via, KI-Integration, leitungsnahe Aufgaben."
    },
    tariff: {
      weekly_hours: 40,
      entgelttabellen: [
        {
          valid_from: "2025-04-01",
          table: {
            EG_I:   [5223, 5516, 5728, 6104, 6542, 6722],
            EG_II:  [6910, 7489, 7992, 8300, 8587, 8887, 9174],
            EG_III: [8643, 9155, 9865, 10341],
            EG_IV:  [10165, 10904, 11122]
          }
        },
        {
          valid_from: "2025-09-01",
          table: {
            EG_I:   [5359, 5660, 5889, 6274, 6722, 6904],
            EG_II:  [7089.66, 7684, 8192, 8510, 8809, 9116, 9412],
            EG_III: [8868, 9397, 10112, 10610],
            EG_IV:  [10390, 11136, 11359]
          }
        }
      ],
      bd_hourly: [
        { valid_from: "2025-04-01", by_eg: { EG_I: 32.78, EG_II: 38.03, EG_III: 41.29, EG_IV: 43.92 } },
        { valid_from: "2025-09-01", by_eg: { EG_I: 33.60, EG_II: 39.10, EG_III: 42.40, EG_IV: 45.10 } }
      ],
      rb_factors: {
        // % Arbeitszeitäquivalent je Slot und Stufe (I/II/III)
        wd_6_20:   { I: 12.50, II: 12.90, III: 16.67 },
        wd_4_6:    { I: 10.00, II: 10.32, III: 13.34 },
        wd_20_24:  { I: 10.00, II: 10.32, III: 13.34 },
        wd_0_4:    { I:  8.93, II:  9.21, III: 11.91 },
        sat:       { I: 12.50, II: 12.90, III: 16.67 },
        sun:       { I: 16.67, II: 16.67, III: 20.00 }, // konservativ (hauspraxisabhängig), überschreibbar durch Daten
        hol:       { I: 20.00, II: 20.00, III: 25.00 },
      },
      rb_taxfree: {
        wd_6_20: 0,
        wd_4_6: 25,
        wd_20_24: 25,
        wd_0_4: 40,
        sat: 0,
        sun: 50,
        hol: 125
      },
      schichtzulage: [
        { valid_from: "2024-11-01", eur_per_month: 200 },
        { valid_from: "2025-04-01", eur_per_month: 220 },
        { valid_from: "2025-09-01", eur_per_month: 240 }
      ],
      wechselschicht_nacht_eur_per_h: [
        { valid_from: "2024-11-01", eur_per_hour: 7.50 },
        { valid_from: "2025-04-01", eur_per_hour: 8.25 },
        { valid_from: "2025-09-01", eur_per_hour: 9.00 }
      ]
    },
    tracks: [],
    sources: []
  });

  // Build tariff index for fast lookups
  const buildTariffIndex = (tariff) => {
    const idx = {
      weeklyHours: tariff?.weekly_hours || 40,
      versions: [],
      entgelttabellen: {},         // version -> { EG_*: [stufen] }
      bdHourly: {},                // version -> { EG_*: €/h }
      rbFactors: tariff?.rb_factors || {},
      rbTaxfree: tariff?.rb_taxfree || {},
      schichtzulage: tariff?.schichtzulage || [],
      wsNacht: tariff?.wechselschicht_nacht_eur_per_h || []
    };

    (tariff?.entgelttabellen || []).forEach(t => {
      idx.entgelttabellen[t.valid_from] = t.table;
      idx.versions.push(t.valid_from);
    });
    (tariff?.bd_hourly || []).forEach(b => {
      idx.bdHourly[b.valid_from] = b.by_eg;
      if (!idx.versions.includes(b.valid_from)) idx.versions.push(b.valid_from);
    });

    // sort versions ascending
    idx.versions.sort((a,b) => new Date(a) - new Date(b));
    return idx;
  };

  // Pick effective version <= given month/year
  const pickVersion = (idx, y, m) => {
    const d = new Date(Date.UTC(Number(y), Number(m) - 1, 15));
    let pick = idx.versions[0] || null;
    for (const v of idx.versions) {
      if (new Date(v) <= d) pick = v;
      else break;
    }
    return pick;
  };

  const getBaseMonthly = (idx, versionKey, eg, stufe) => {
    const table = idx.entgelttabellen[versionKey] || {};
    const arr = table[eg] || [];
    const i = clamp(Number(stufe) - 1, 0, arr.length - 1);
    return parseDeNumber(arr[i] || 0);
  };

  const getBDHourly = (idx, versionKey, eg) => {
    if (idx.bdHourly[versionKey] && eg in idx.bdHourly[versionKey]) {
      return parseDeNumber(idx.bdHourly[versionKey][eg]);
    }
    // fallback to last known version <= current
    let last = 0;
    for (const v of idx.versions) {
      if (new Date(v) <= new Date(versionKey) && idx.bdHourly[v] && eg in idx.bdHourly[v]) {
        last = parseDeNumber(idx.bdHourly[v][eg]);
      }
    }
    return last || 0;
  };

  const monthlyHours = (weeklyHours) => (weeklyHours * 52) / 12; // 4.333...
  const hourlyFromMonthly = (monthly, weeklyHours) => {
    const h = monthlyHours(weeklyHours);
    return h > 0 ? (monthly / h) : 0;
  };

  const getSchichtzulage = (idx, y, m) => {
    const d = new Date(Number(y), Number(m)-1, 1);
    let val = 0;
    for (const it of idx.schichtzulage) if (new Date(it.valid_from) <= d) val = parseDeNumber(it.eur_per_month);
    return val;
  };

  const getWsNachtEuro = (idx, y, m) => {
    const d = new Date(Number(y), Number(m)-1, 1);
    let val = 0;
    for (const it of idx.wsNacht) if (new Date(it.valid_from) <= d) val = parseDeNumber(it.eur_per_hour);
    return val;
  };

  /* --------------------------------------------------------------
   * 5) Views
   * -------------------------------------------------------------- */

  // Overview
  const ViewOverview = async () => {
    const p = State.data?.profile || {};
    const tracks = State.data?.tracks || [];
    Outlet.innerHTML = `
      <section class="section-space fade-in">
        <div class="overview-grid">
          <article class="card kpi">
            <h3>Kernprofil</h3>
            <p><strong>${p.name || ""}</strong></p>
            <p>${p.title || ""}</p>
            <p class="muted">${p.location || ""}</p>
          </article>

          <article class="card kpi">
            <h3>Karrierepfade</h3>
            <p>Aktiv gepflegte Optionen: <strong>${tracks.length}</strong></p>
            <div class="hl">
              <div>Letzte Aktualisierung</div>
              <div>${fmtDate(State.data?.meta?.generated_at || Date.now())}</div>
            </div>
          </article>

          <article class="card kpi">
            <h3>Tarifversionen</h3>
            <p>Bekannte Stände: <strong>${State.idx?.versions?.length || 0}</strong></p>
            <p class="muted">${(State.idx?.versions || []).map(v => fmtDate(v)).join(" · ")}</p>
          </article>

          <article class="card kpi">
            <h3>Werkzeuge</h3>
            <p>Tarif-Rechner (BD/RB/§11), Pfad-Explorer, Vergleich, Quellen</p>
            <p class="muted">⌘/Ctrl + K: Schnellsuche</p>
          </article>
        </div>
      </section>
    `;
  };

  // Profile
  const ViewProfile = async () => {
    const p = State.data?.profile || {};
    Outlet.innerHTML = `
      <section class="section-space fade-in">
        <div class="card">
          <h2 class="section-title">Profil</h2>
          <p class="section-subtitle">${p.summary || ""}</p>
          <div class="mt"></div>
          <div class="cards-grid">
            <article class="card">
              <h3>Schwerpunkte</h3>
              <ul class="bullets">
                ${(p.skills?.clinical || []).map(s => `<li>${s}</li>`).join("")}
              </ul>
            </article>
            <article class="card">
              <h3>Technik/IT</h3>
              <ul class="bullets">
                ${(p.skills?.technical || []).map(s => `<li>${s}</li>`).join("")}
              </ul>
            </article>
            <article class="card">
              <h3>Leitung & Forschung</h3>
              <ul class="bullets">
                ${(p.skills?.leadership || []).map(s => `<li>${s}</li>`).join("")}
                ${(p.skills?.research || []).map(s => `<li>${s}</li>`).join("")}
              </ul>
            </article>
          </div>
        </div>
      </section>
    `;
  };

  // Tracks (Explorer)
  const ViewTracks = async () => {
    const tracks = State.data?.tracks || [];
    const allTags = new Set();
    tracks.forEach(t => (t.tags || []).forEach(tag => allTags.add(tag)));
    const tags = Array.from(allTags);

    Outlet.innerHTML = `
      <section class="section-space fade-in">
        <div class="tracks-controls">
          <div class="search">
            <input id="trackSearch" type="search" placeholder="Suchen (z. B. 'Teleradiologie', 'Siemens', 'Remote')" aria-label="Karrierepfade durchsuchen" />
          </div>
          <div class="filters segmented" role="tablist" aria-label="Filter">
            <button class="btn--sm" data-filter="*" aria-selected="true">Alle</button>
            ${tags.map(t => `<button class="btn--sm" data-filter="${t}" aria-selected="false">${t}</button>`).join("")}
          </div>
        </div>
        <div id="tracksGrid" class="cards-grid"></div>
      </section>
    `;

    const grid = $("#tracksGrid");
    const render = (list) => {
      grid.innerHTML = list.map(cardForTrack).join("");
      bindCardEvents();
    };
    render(tracks);

    // Filters
    $$(".filters button").forEach(btn => {
      on(btn, "click", () => {
        $$(".filters button").forEach(b => b.setAttribute("aria-selected", "false"));
        btn.setAttribute("aria-selected", "true");
        const f = btn.dataset.filter;
        if (f === "*") render(tracks);
        else render(tracks.filter(t => (t.tags || []).includes(f)));
      });
    });

    // Search
    const input = $("#trackSearch");
    const fuse = State.searchIndex?.tracksFuse || null;
    on(input, "input", () => {
      const q = input.value.trim();
      if (!q) return render(tracks);
      if (fuse) {
        const res = fuse.search(q).map(r => r.item);
        render(res);
      } else {
        const lower = q.toLowerCase();
        render(tracks.filter(t => JSON.stringify(t).toLowerCase().includes(lower)));
      }
    });
  };

  const cardForTrack = (t) => {
    const slug = t.slug || t.id || Math.random().toString(36).slice(2);
    const tagsHtml = (t.tags || []).map(x => `<span class="tag">${x}</span>`).join("");
    const badges = (t.badges || []).map(x => `<span class="badge">${x}</span>`).join("");
    const selected = State.selectedCompare.has(slug);
    const positions = Array.isArray(t.positions) ? t.positions : (t.employers?.flatMap(e => e.roles?.map(r => ({ ...r, company: e.name }))) || []);
    return `
      <article class="card track" data-slug="${slug}">
        <header class="card__header">
          <div>
            <h3>${t.title}</h3>
            <div class="card__meta">${tagsHtml}</div>
          </div>
          <div class="actions">
            <button class="btn--ghost add-compare ${selected ? "with-stroke" : ""}" aria-pressed="${selected}" title="${selected ? "Aus Vergleich entfernen" : "Zum Vergleich hinzufügen"}">
              <span class="btn__icon" aria-hidden="true">+</span><span class="sr-only">Vergleich</span>
            </button>
          </div>
        </header>
        <div class="card__body">
          ${t.summary ? `<p>${t.summary}</p>` : ""}
          ${badges ? `<div class="badges">${badges}</div>` : ""}
          ${t.key_points ? `<ul class="bullets">${t.key_points.map(li => `<li>${li}</li>`).join("")}</ul>` : ""}
        </div>
        <footer class="card__footer">
          <button class="btn--primary more">Mehr Details</button>
        </footer>
      </article>

      <dialog class="modal" id="dlg_${slug}" aria-label="${t.title}">
        <article class="modal-card">
          <header class="modal-header">
            <h3 class="modal-title">${t.title}</h3>
            <button class="btn-ghost close" aria-label="Schließen">✕</button>
          </header>
          <div class="modal-body">
            ${t.details_html || (t.details ? `<p>${t.details}</p>` : "")}
            ${positions?.length ? `
              <h4 class="mt">Konkrete Positionen</h4>
              <div class="positions">
                ${positions.map(renderPosition).join("")}
              </div>
            ` : ""}
            ${renderSources(t.sources || [])}
          </div>
          <footer class="modal-footer">
            <button class="btn--outline close">Schließen</button>
            <button class="btn--primary add-compare" data-slug="${slug}">${State.selectedCompare.has(slug) ? "Aus Vergleich entfernen" : "Zum Vergleich"}</button>
          </footer>
        </article>
      </dialog>
    `;
  };

  const renderPosition = (p) => {
    const sal = [
      p.salary_min ? fmtCurr.format(p.salary_min) : null,
      p.salary_max ? fmtCurr.format(p.salary_max) : null
    ].filter(Boolean).join(" – ");
    const comp = p.compensation_note ? p.compensation_note : sal ? sal : "n. a.";
    return `
      <section class="position">
        <header class="position__head">
          <h5>${p.title} <span class="muted">– ${p.company || p.employer || ""}${p.location ? ", " + p.location : ""}</span></h5>
        </header>
        <div class="position__grid">
          <div><strong>Vergütung:</strong> ${comp}</div>
          <div><strong>Arbeitszeit:</strong> ${p.working_time || p.weekly_hours || "n. a."}</div>
          <div><strong>Modell:</strong> ${p.model || "n. a."}</div>
          <div><strong>Vertrag:</strong> ${p.contract || "n. a."}</div>
        </div>
        ${p.requirements?.length ? `<h6 class="mt">Anforderungen</h6><ul class="bullets">${p.requirements.map(r => `<li>${r}</li>`).join("")}</ul>` : ""}
        ${p.benefits?.length ? `<h6 class="mt">Benefits</h6><ul class="bullets">${p.benefits.map(r => `<li>${r}</li>`).join("")}</ul>` : ""}
        ${p.notes?.length ? `<h6 class="mt">Besonderheiten</h6><ul class="bullets">${p.notes.map(r => `<li>${r}</li>`).join("")}</ul>` : ""}
      </section>
    `;
  };

  const renderSources = (sources) => {
    if (!sources?.length) return "";
    return `
      <h4 class="mt">Quellen</h4>
      <ul class="links">
        ${sources.map(s => `<li><a href="${s.url}" target="_blank" rel="noopener">${s.label || s.url}</a>${s.note ? ` – <span class="muted">${s.note}</span>` : ""}</li>`).join("")}
      </ul>
    `;
  };

  const bindCardEvents = () => {
    // Details (open dialog)
    $$(".card.track .more").forEach(btn => {
      on(btn, "click", () => {
        const card = btn.closest(".card.track");
        const slug = card?.dataset?.slug;
        const dlg = $(`#dlg_${slug}`);
        dlg?.showModal?.();
      });
    });
    // Close dialog
    $$(".modal .close").forEach(btn => {
      on(btn, "click", (e) => {
        const dlg = e.target.closest(".modal");
        dlg?.close?.();
      });
    });
    // Compare (card header)
    $$(".card.track .add-compare").forEach(btn => {
      on(btn, "click", (e) => {
        const card = e.target.closest(".card.track");
        const slug = card?.dataset?.slug;
        toggleCompare(slug, btn);
      });
    });
    // Compare (modal footer)
    $$(".modal .add-compare").forEach(btn => {
      on(btn, "click", () => {
        const slug = btn.dataset.slug;
        toggleCompare(slug, btn);
      });
    });
  };

  const toggleCompare = (slug, btn) => {
    if (!slug) return;
    if (State.selectedCompare.has(slug)) {
      State.selectedCompare.delete(slug);
      notifier.open({ message: "Aus Vergleich entfernt." });
      btn?.setAttribute("aria-pressed", "false");
      btn?.classList.remove("with-stroke");
      btn?.textContent && (btn.textContent = "Zum Vergleich");
    } else {
      State.selectedCompare.add(slug);
      notifier.success("Zum Vergleich hinzugefügt.");
      btn?.setAttribute("aria-pressed", "true");
      btn?.classList.add("with-stroke");
      btn?.textContent && (btn.textContent = "Aus Vergleich entfernen");
    }
    saveCompare();
  };

  // Calculator
  const ViewCalculator = async () => {
    const idx = State.idx;

    Outlet.innerHTML = `
      <section class="calc section-space fade-in">
        <div class="calc__grid">
          <div class="panel">
            <h3>Eingaben</h3>
            <div class="calc__form">
              <div class="form-row">
                <label for="calcMonth">Monat</label>
                <select id="calcMonth">
                  ${Array.from({length:12}, (_,i) => `<option value="${i+1}">${new Date(2000,i,1).toLocaleString("de-DE",{month:"long"})}</option>`).join("")}
                </select>
              </div>
              <div class="form-row">
                <label for="calcYear">Jahr</label>
                <input id="calcYear" type="number" min="2022" max="2027" value="${new Date().getFullYear()}" />
              </div>
              <div class="form-row">
                <label for="calcEG">Entgeltgruppe</label>
                <select id="calcEG">
                  <option>EG I</option>
                  <option selected>EG II</option>
                  <option>EG III</option>
                  <option>EG IV</option>
                </select>
              </div>
              <div class="form-row">
                <label for="calcStufe">Stufe</label>
                <select id="calcStufe"></select>
              </div>

              <details class="mt" open>
                <summary>Bereitschaftsdienst (BD)</summary>
                <div class="form-grid">
                  <label>BD-Stufe (Info)</label>
                  <select id="bdLevel">
                    <option value="I">I</option>
                    <option value="II">II</option>
                    <option value="III" selected>III</option>
                  </select>

                  <label>BD-Stunden gesamt</label>
                  <input id="bdHours" type="number" min="0" step="0.5" value="0" />

                  <label>davon Nachtstunden (21–6)</label>
                  <input id="bdNightHours" type="number" min="0" step="0.5" value="0" />

                  <label>davon Feiertagsstunden</label>
                  <input id="bdHolidayHours" type="number" min="0" step="0.5" value="0" />
                </div>
                <p class="muted">BD-Vergütung je Stunde gemäß aktuellem Stand; Zuschläge: Nacht +15 %, Feiertag +25 %, ab 97. BD-Stunde +5 %/h.</p>
              </details>

              <details class="mt" open>
                <summary>Rufbereitschaft (RB)</summary>
                <div class="form-grid">
                  <label>RB-Stufe</label>
                  <select id="rbLevel">
                    <option value="I">I</option>
                    <option value="II">II</option>
                    <option value="III" selected>III</option>
                  </select>

                  <label>Werktag 6–20 (h)</label>
                  <input id="rb_wd_6_20" type="number" min="0" step="0.5" value="0" />
                  <label>Werktag 4–6 (h)</label>
                  <input id="rb_wd_4_6" type="number" min="0" step="0.5" value="0" />
                  <label>Werktag 20–24 (h)</label>
                  <input id="rb_wd_20_24" type="number" min="0" step="0.5" value="0" />
                  <label>Werktag 0–4 (h)</label>
                  <input id="rb_wd_0_4" type="number" min="0" step="0.5" value="0" />
                  <label>Samstag (h)</label>
                  <input id="rb_sat" type="number" min="0" step="0.5" value="0" />
                  <label>Sonntag (h)</label>
                  <input id="rb_sun" type="number" min="0" step="0.5" value="0" />
                  <label>Feiertag (h)</label>
                  <input id="rb_hol" type="number" min="0" step="0.5" value="0" />
                </div>
                <p class="muted">RB wird als Arbeitszeit-Äquivalent vergütet (Faktor je Slot & Stufe) × individuelles Stundenentgelt. Zusätzlich steuerfreie Zuschläge pro Slot.</p>
              </details>

              <details class="mt">
                <summary>§ 11 Zuschläge (außerhalb BD/RB)</summary>
                <div class="form-grid">
                  <label>Ständige Schichtarbeit</label>
                  <select id="schichtDauerhaft">
                    <option value="nein" selected>nein</option>
                    <option value="ja">ja</option>
                  </select>

                  <label>Nachtarbeit in Wechselschicht (h)</label>
                  <input id="wsNachtHours" type="number" min="0" step="0.5" value="0" />

                  <label>Sonntagsarbeit (h)</label>
                  <input id="sunHours" type="number" min="0" step="0.5" value="0" />

                  <label>Feiertag ohne Freizeitausgleich (h)</label>
                  <input id="holNoCompHours" type="number" min="0" step="0.5" value="0" />

                  <label>Feiertag mit Freizeitausgleich (h)</label>
                  <input id="holWithCompHours" type="number" min="0" step="0.5" value="0" />
                </div>
                <p class="muted">Prozentsätze auf Stundenentgelt der Stufe 3: Sonntag <strong>40 %</strong>, Feiertag <strong>135 %</strong> (ohne FA) / <strong>35 %</strong> (mit FA), Nacht <strong>15 %</strong>. Wechselschicht-Nacht zusätzlich fixer €/h.</p>
              </details>

              <div class="form-row mt">
                <button id="btnCalc" class="btn--primary">Berechnen</button>
              </div>
            </div>
          </div>

          <div class="panel">
            <h3>Ergebnis</h3>
            <div class="result-grid">
              <div class="result-card">
                <div class="result-card__header">
                  <div>
                    <h4>Tabellenentgelt</h4>
                    <p class="muted">EG/Stufe zum wirksamen Tarifstand</p>
                  </div>
                  <div class="result-amount" id="resBase">–</div>
                </div>
                <div class="result-details">
                  <div class="result-item"><span>Tarifstand</span><span id="resVersion">–</span></div>
                  <div class="result-item"><span>EG/Stufe</span><span id="resEGStufe">–</span></div>
                  <div class="result-item"><span>Indiv. Stundenentgelt</span><span id="resBaseHourly">–</span></div>
                </div>
              </div>

              <div class="result-card">
                <div class="result-card__header">
                  <div>
                    <h4>Bereitschaftsdienst</h4>
                    <p class="muted">§ 12</p>
                  </div>
                  <div class="result-amount" id="resBD">–</div>
                </div>
                <div class="result-details">
                  <div class="result-item"><span>BD-Basis (€/h)</span><span id="resBDHourly">–</span></div>
                  <div class="result-item"><span>Zuschläge Nacht/Feiertag/≥97h</span><span id="resBDZuschl">–</span></div>
                </div>
              </div>

              <div class="result-card">
                <div class="result-card__header">
                  <div>
                    <h4>Rufbereitschaft</h4>
                    <p class="muted">§ 12a</p>
                  </div>
                  <div class="result-amount" id="resRB">–</div>
                </div>
                <div class="result-details">
                  <div class="result-item"><span>Arbeitszeit-Äquivalent</span><span id="resRBHoursEq">–</span></div>
                  <div class="result-item"><span>Steuerfreie Zuschläge</span><span id="resRBTaxfree">–</span></div>
                </div>
              </div>

              <div class="result-card">
                <div class="result-card__header">
                  <div>
                    <h4>§ 11 (Schicht/Nacht/So/Feiertag)</h4>
                  </div>
                  <div class="result-amount" id="resShift">–</div>
                </div>
                <div class="result-details">
                  <div class="result-item"><span>Schichtzulage</span><span id="resSchichtZul">–</span></div>
                  <div class="result-item"><span>WS-Nacht (€/h)</span><span id="resWsNacht">–</span></div>
                  <div class="result-item"><span>Zusatz § 11</span><span id="resPara11Sum">–</span></div>
                </div>
              </div>

              <div class="result-card total">
                <div class="result-card__header">
                  <div>
                    <h4>Gesamt (brutto, Monat)</h4>
                    <p class="muted">Summiert</p>
                  </div>
                  <div class="result-amount" id="resTotal">–</div>
                </div>
              </div>
            </div>

            <div class="result-legend">
              <details>
                <summary>Rechenlogik (vollständig)</summary>
                <ul class="bullets small">
                  <li><strong>Tabellenentgelt</strong> aus EG/Stufe je Tarifstand.</li>
                  <li><strong>Individuelles Stundenentgelt</strong> = Monatsentgelt / (52×Wochenstunden/12).</li>
                  <li><strong>BD</strong>: Stunden × BD-Basis €/h; Zuschläge: Nacht +15 %, Feiertag +25 %, ab 97. Stunde +5 %/h.</li>
                  <li><strong>RB</strong>: Σ (Slotstunden × Faktor%) = Arbeitszeit-Äquivalent; Vergütung = Äquivalent × indiv. Stundenentgelt; zzgl. steuerfreie Zuschläge pro Slot (% von RB-Euro).</li>
                  <li><strong>§ 11</strong>: Sonntag 40 %, Feiertag 135 % (ohne FA) / 35 % (mit FA), Nacht 15 % – auf Stundenentgelt Stufe 3; WS-Nacht zusätzlich fixer €/h; Schichtzulage monatlich.</li>
                </ul>
              </details>
            </div>
          </div>
        </div>
      </section>
    `;

    // defaults
    const now = new Date();
    $("#calcMonth").value = String(now.getMonth()+1);
    $("#calcYear").value = String(now.getFullYear());

    // populate stufen from table
    const egSel = $("#calcEG");
    const stufeSel = $("#calcStufe");
    const updateStufen = () => {
      const y = Number($("#calcYear").value);
      const m = Number($("#calcMonth").value);
      const eg = egSel.value.replace(" ", "_");
      const version = pickVersion(idx, y, m);
      const arr = (idx.entgelttabellen[version] || {})[eg] || [];
      stufeSel.innerHTML = arr.map((_,i) => `<option value="${i+1}">${i+1}</option>`).join("");
      stufeSel.value = String(Math.min(arr.length || 1, 3)); // default 3 falls vorhanden
    };
    on(egSel, "change", updateStufen);
    on($("#calcMonth"), "change", updateStufen);
    on($("#calcYear"), "input", updateStufen);
    updateStufen();

    // calc handler
    const calc = () => {
      const y = Number($("#calcYear").value);
      const m = Number($("#calcMonth").value);
      const egHuman = $("#calcEG").value.trim();       // "EG II"
      const eg = egHuman.replace(" ", "_");            // "EG_II"
      const stufe = Number($("#calcStufe").value || 1);
      const version = pickVersion(idx, y, m);

      const weekly = idx.weeklyHours;
      const baseMonthly = getBaseMonthly(idx, version, eg, stufe);
      const baseHourlyIndiv = hourlyFromMonthly(baseMonthly, weekly);

      const baseStufe3 = getBaseMonthly(idx, version, eg, 3) || baseMonthly;
      const hourlyOnStufe3 = hourlyFromMonthly(baseStufe3, weekly);

      // BD
      const bdHours = parseDeNumber($("#bdHours").value);
      const bdNightHours = clamp(parseDeNumber($("#bdNightHours").value), 0, bdHours);
      const bdHolidayHours = clamp(parseDeNumber($("#bdHolidayHours").value), 0, Math.max(0, bdHours - bdNightHours));
      const bdHourly = getBDHourly(idx, version, eg);
      const bdBase = bdHours * bdHourly;
      const bdNightPlus = bdNightHours * (bdHourly * 0.15);
      const bdHolPlus = bdHolidayHours * (bdHourly * 0.25);
      const extraHoursOver97 = Math.max(0, bdHours - 97);
      const bdPlus97 = extraHoursOver97 * (bdHourly * 0.05);
      const bdTotal = bdBase + bdNightPlus + bdHolPlus + bdPlus97;

      // RB
      const rbLevel = $("#rbLevel").value; // I/II/III
      const rbSlots = [
        ["wd_6_20", parseDeNumber($("#rb_wd_6_20").value)],
        ["wd_4_6", parseDeNumber($("#rb_wd_4_6").value)],
        ["wd_20_24", parseDeNumber($("#rb_wd_20_24").value)],
        ["wd_0_4", parseDeNumber($("#rb_wd_0_4").value)],
        ["sat", parseDeNumber($("#rb_sat").value)],
        ["sun", parseDeNumber($("#rb_sun").value)],
        ["hol", parseDeNumber($("#rb_hol").value)],
      ];

      let rbHoursEq = 0;
      let rbEuro = 0;
      let rbTaxfree = 0;
      for (const [slot, hrs] of rbSlots) {
        if (!hrs) continue;
        const f = idx.rbFactors?.[slot]?.[rbLevel] || 0; // %
        const eq = hrs * (f / 100);
        const euro = eq * baseHourlyIndiv;
        const taxPct = (idx.rbTaxfree?.[slot] || 0) / 100;
        const tax = euro * taxPct;
        rbHoursEq += eq;
        rbEuro += euro;
        rbTaxfree += tax;
      }

      // § 11 (außerhalb BD/RB)
      const schichtDauerhaft = $("#schichtDauerhaft").value === "ja";
      const wsNacht = parseDeNumber($("#wsNachtHours").value);
      const sunH = parseDeNumber($("#sunHours").value);
      const holNoCompH = parseDeNumber($("#holNoCompHours").value);
      const holWithCompH = parseDeNumber($("#holWithCompHours").value);

      const schichtZulMonat = schichtDauerhaft ? getSchichtzulage(idx, y, m) : 0;
      const wsNachtEur = getWsNachtEuro(idx, y, m);
      const wsNachtSum = wsNacht * wsNachtEur;

      // Prozentsätze
      const pSun = 0.40;    // 40 %
      const pHolNo = 1.35;  // 135 %
      const pHolYes = 0.35; // 35 %
      // Nacht 15 % nicht separat abgefragt (außerhalb WS), optional erweiterbar

      const sunSum = sunH * (hourlyOnStufe3 * pSun);
      const holNoCompSum = holNoCompH * (hourlyOnStufe3 * pHolNo);
      const holWithCompSum = holWithCompH * (hourlyOnStufe3 * pHolYes);
      const para11Sum = sunSum + holNoCompSum + holWithCompSum + wsNachtSum;

      // Total
      const total = baseMonthly + bdTotal + rbEuro + schichtZulMonat + para11Sum;

      // Render
      $("#resVersion").textContent = version || "–";
      $("#resEGStufe").textContent = `${egHuman} / Stufe ${stufe}`;
      $("#resBase").textContent = fmtCurr.format(baseMonthly);
      $("#resBaseHourly").textContent = fmtCurr.format(baseHourlyIndiv);

      $("#resBD").textContent = fmtCurr.format(bdTotal);
      $("#resBDHourly").textContent = bdHourly ? fmtCurr.format(bdHourly) : "–";
      $("#resBDZuschl").textContent = [
        bdNightPlus ? `Nacht: ${fmtCurr.format(bdNightPlus)}` : null,
        bdHolPlus ? `Feiertag: ${fmtCurr.format(bdHolPlus)}` : null,
        bdPlus97 ? `≥97 h: ${fmtCurr.format(bdPlus97)}` : null
      ].filter(Boolean).join(" · ") || "–";

      $("#resRB").textContent = fmtCurr.format(rbEuro);
      $("#resRBHoursEq").textContent = `${rbHoursEq.toFixed(2).replace(".", ",")} h`;
      $("#resRBTaxfree").textContent = rbTaxfree ? fmtCurr.format(rbTaxfree) : "–";

      $("#resSchichtZul").textContent = schichtZulMonat ? fmtCurr.format(schichtZulMonat) : "–";
      $("#resWsNacht").textContent = wsNachtSum ? `${fmtCurr.format(wsNachtEur)} / h → ${fmtCurr.format(wsNachtSum)}` : "–";
      $("#resPara11Sum").textContent = para11Sum ? fmtCurr.format(para11Sum) : "–";
      $("#resShift").textContent = fmtCurr.format(schichtZulMonat + para11Sum);

      $("#resTotal").textContent = fmtCurr.format(total);

      if (VENDOR.gsap && total > 15000) {
        VENDOR.gsap.to("#resTotal", { scale: 1.06, yoyo: true, repeat: 1, duration: .12, ease: "power1.inOut" });
      }
    };

    on($("#btnCalc"), "click", () => {
      calc();
      notifier.success("Berechnung aktualisiert.");
    });

    // initial
    calc();
  };

  // Compare
  const ViewCompare = async () => {
    const tracks = State.data?.tracks || [];
    const selected = tracks.filter(t => State.selectedCompare.has(t.slug || t.id));
    if (!selected.length) {
      Outlet.innerHTML = `
        <section class="section-space fade-in">
          <div class="card">
            <h3 class="section-title">Vergleich</h3>
            <p class="muted">Noch keine Elemente im Vergleich. Füge Pfade im Explorer hinzu.</p>
          </div>
        </section>
      `;
      return;
    }

    Outlet.innerHTML = `
      <section class="section-space fade-in">
        <div class="table-wrapper">
          <table class="table">
            <thead>
              <tr>
                <th>Pfad</th>
                <th>Vergütung (Spanne)</th>
                <th>Arbeitsmodell</th>
                <th>Wochenstunden</th>
                <th>Ort/Remote</th>
                <th>Besonderheiten</th>
              </tr>
            </thead>
            <tbody id="cmpBody"></tbody>
          </table>
        </div>
        <div class="card mt">
          <h4>Radar (Stärkenvergleich)</h4>
          <canvas id="cmpChart" aria-label="Vergleichschart" role="img" height="360"></canvas>
        </div>
      </section>
    `;

    const body = $("#cmpBody");
    body.innerHTML = selected.map((t) => {
      const pos = t.positions || (t.employers?.flatMap(e => e.roles?.map(r => ({ ...r, company: e.name }))) || []);
      const min = Math.min(...pos.map(p => p.salary_min ?? Infinity));
      const max = Math.max(...pos.map(p => p.salary_max ?? 0));
      const model = ((new Set(pos.map(p => p.model || ""))).values().next().value) || (t.model || "n. a.");
      const hours = ((new Set(pos.map(p => p.weekly_hours || ""))).values().next().value) || (t.weekly_hours || "n. a.");
      const remote = ((new Set(pos.map(p => p.remote || p.location || ""))).values().next().value) || (t.location || "n. a.");
      const highlights = (t.badges || []).slice(0,3).join(", ");

      const span = (isFinite(min) && max > 0) ? `${fmtCurr.format(min)} – ${fmtCurr.format(max)}` : (t.compensation_note || "n. a.");

      return `
        <tr>
          <td><strong>${t.title}</strong></td>
          <td>${span}</td>
          <td>${model}</td>
          <td>${hours}</td>
          <td>${remote}</td>
          <td>${highlights || "–"}</td>
        </tr>
      `;
    }).join("");

    // Radar chart
    if (VENDOR.Chart) {
      try {
        const labels = ["Vergütung", "Planbarkeit", "Forschung/Lehre", "Technik/Innovation", "Führung", "Work-Life"];
        const datasets = selected.map((t) => {
          const m = t.metrics || { pay: 4, schedule: 3, research: 3, tech: 5, lead: 4, wl: 3 };
          return { label: t.title, data: [m.pay, m.schedule, m.research, m.tech, m.lead, m.wl], fill: true };
        });
        const ctx = $("#cmpChart");
        new VENDOR.Chart(ctx, {
          type: "radar",
          data: { labels, datasets },
          options: { responsive: true, scales: { r: { min: 0, max: 5, ticks: { stepSize: 1 } } } }
        });
      } catch (e) { console.warn("Chart error", e); }
    }
  };

  // Sources
  const ViewSources = async () => {
    const src = State.data?.sources || [];
    Outlet.innerHTML = `
      <section class="section-space fade-in">
        <div class="card">
          <h2 class="section-title">Quellen</h2>
          <div class="table-wrapper mt">
            <table class="table">
              <thead><tr><th>Quelle</th><th>Beschreibung</th><th>Stand</th></tr></thead>
              <tbody>
                ${src.map(s => `
                  <tr>
                    <td>${(s.hrefs?.length ? s.hrefs.map(h => `<a href="${h}" target="_blank" rel="noopener">${s.label || h}</a>`).join("<br/>") : s.label || "")}</td>
                    <td>${s.notes || s.note || ""}</td>
                    <td>${s.date || ""}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    `;
  };

  /* --------------------------------------------------------------
   * 6) Command Palette (⌘/Ctrl + K)
   * -------------------------------------------------------------- */
  const buildSearchIndex = (data) => {
    const tracks = data.tracks || [];
    const sources = data.sources || [];
    if (VENDOR.Fuse) {
      State.searchIndex = {
        tracksFuse: new VENDOR.Fuse(tracks, {
          keys: ["title", "summary", "details", "tags", "positions.title", "positions.company", "positions.location", "employers.name", "employers.roles.title"],
          threshold: 0.35, ignoreLocation: true, minMatchCharLength: 2
        }),
        sourcesFuse: new VENDOR.Fuse(sources, {
          keys: ["label", "notes", "hrefs"], threshold: 0.35, ignoreLocation: true, minMatchCharLength: 2
        })
      };
    } else {
      State.searchIndex = { tracksFuse: null, sourcesFuse: null };
    }
  };

  const initCommandPalette = () => {
    const dlg = $("#cmdk-dialog");
    const input = $("#cmdk-input");
    const results = $("#cmdk-results");
    if (!dlg || !input || !results) return;

    const close = () => dlg.setAttribute("hidden", "");
    const renderResults = (items) => {
      if (!items.length) {
        results.innerHTML = `<div class="muted">Keine Treffer.</div>`;
        return;
      }
      results.innerHTML = items.map(it => `
        <div class="card" data-action="${it.action}" data-payload='${JSON.stringify(it.payload || {})}'>
          <div><strong>${it.title}</strong></div>
          <div class="muted">${it.subtitle || ""}</div>
        </div>
      `).join("");
      $$("#cmdk-results .card").forEach(card => {
        on(card, "click", () => {
          const action = card.dataset.action;
          const payload = JSON.parse(card.dataset.payload || "{}");
          performAction(action, payload);
          close();
        });
      });
    };

    const performAction = (action, payload) => {
      switch (action) {
        case "nav":
          Router.goto(payload.route || "overview");
          break;
        case "open-track":
          Router.goto("tracks");
          setTimeout(() => {
            const el = $(`.card.track[data-slug="${payload.slug}"]`);
            if (el) el.querySelector(".more")?.click();
          }, 50);
          break;
        case "open-source":
          Router.goto("sources");
          break;
        default:
          break;
      }
    };

    const baseItems = [
      { title: "Übersicht öffnen", subtitle: "Navigation", action: "nav", payload: { route: "overview" } },
      { title: "Profil anzeigen", subtitle: "Navigation", action: "nav", payload: { route: "profile" } },
      { title: "Karrierepfade öffnen", subtitle: "Navigation", action: "nav", payload: { route: "tracks" } },
      { title: "Tarif-Rechner starten", subtitle: "Navigation", action: "nav", payload: { route: "calculator" } },
      { title: "Vergleich aufrufen", subtitle: "Navigation", action: "nav", payload: { route: "compare" } },
      { title: "Quellen lesen", subtitle: "Navigation", action: "nav", payload: { route: "sources" } },
    ];

    const search = (q) => {
      if (!q) return renderResults(baseItems);
      const items = [];
      // Tracks
      if (State.searchIndex?.tracksFuse) {
        State.searchIndex.tracksFuse.search(q).slice(0, 6).forEach(r => {
          const t = r.item;
          items.push({
            title: `Pfad: ${t.title}`,
            subtitle: (t.tags || []).join(", "),
            action: "open-track",
            payload: { slug: t.slug || t.id }
          });
        });
      }
      // Sources
      if (State.searchIndex?.sourcesFuse) {
        State.searchIndex.sourcesFuse.search(q).slice(0, 4).forEach(r => {
          const s = r.item;
          items.push({
            title: `Quelle: ${s.label || (s.hrefs?.[0] || "Link")}`,
            subtitle: `${(s.hrefs || []).join(", ")}`,
            action: "open-source",
            payload: {}
          });
        });
      }
      renderResults(items.length ? items : baseItems);
    };

    on(input, "input", () => search(input.value.trim()));
    search("");

    // Close on backdrop click handled in vendor.js (data-dismiss)
  };

  /* --------------------------------------------------------------
   * 7) Export (Markdown Snapshot)
   * -------------------------------------------------------------- */
  const initExport = () => {
    const btn = $("#export-btn");
    if (!btn) return;
    on(btn, "click", () => {
      const md = buildMarkdownExport();
      const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Karriere-Portfolio_Markus-Lurz_${new Date().toISOString().slice(0,10)}.md`;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
      a.remove();
      notifier.success("Export erstellt.");
    });
  };

  const buildMarkdownExport = () => {
    const p = State.data?.profile || {};
    const tracks = State.data?.tracks || [];
    const vers = (State.idx?.versions || []).map(v => `- ${fmtDate(v)}`).join("\n");
    const lines = [];
    lines.push(`# Karriere-Portfolio · ${p.name || ""}`);
    lines.push(`**Titel:** ${p.title || ""}`);
    lines.push(`**Ort:** ${p.location || ""}`);
    lines.push("");
    lines.push("## Tarifstände");
    lines.push(vers || "- n/a");
    lines.push("");
    lines.push("## Karrierepfade");
    tracks.forEach((t) => {
      lines.push(`### ${t.title}`);
      if (t.summary) lines.push(t.summary);
      if (t.tags?.length) lines.push(`Tags: ${t.tags.join(", ")}`);
      const positions = t.positions || (t.employers?.flatMap(e => e.roles?.map(r => ({ ...r, company: e.name }))) || []);
      positions.forEach(p => {
        lines.push(`- **${p.title}** – ${p.company || p.employer || ""}${p.location ? ", " + p.location : ""}`);
        if (p.salary_min || p.salary_max || p.compensation) {
          lines.push(`  - Vergütung: ${p.compensation_note || ""} ${p.salary_min ? fmtCurr.format(p.salary_min) : ""}${p.salary_max ? " – " + fmtCurr.format(p.salary_max) : ""}`);
        }
        if (p.requirements?.length) lines.push(`  - Anforderungen: ${p.requirements.join("; ")}`);
        if (p.benefits?.length) lines.push(`  - Benefits: ${p.benefits.join("; ")}`);
      });
      lines.push("");
    });
    return lines.join("\n");
  };

  /* --------------------------------------------------------------
   * 8) Boot
   * -------------------------------------------------------------- */
  const boot = async () => {
    // Theme initial (persisted value von vendor.js gesetzt)
    try {
      const saved = localStorage.getItem("theme");
      if (saved) document.documentElement.setAttribute("data-theme", saved);
    } catch {}

    await loadData();
    Router.init();

    // Register routes
    Router.register("overview", ViewOverview);
    Router.register("profile", ViewProfile);
    Router.register("tracks", ViewTracks);
    Router.register("calculator", ViewCalculator);
    Router.register("compare", ViewCompare);
    Router.register("sources", ViewSources);

    // Command palette & Export
    initCommandPalette();
    initExport();

    // Initial render (falls hash schon gesetzt)
    await Router.render();
  };

  if (document.readyState === "complete" || document.readyState === "interactive") {
    boot();
  } else {
    on(document, "DOMContentLoaded", boot);
  }

})();
