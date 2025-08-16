/* File: js/app.js
   Rolle: Karriere- & Vergütungs-Strategieberater (Radiologie) / UX Engineer
   Zweck: Single-Page-App-Logik, Daten-Layer, UI-Renderer, TV-Ärzte/St. Georg Kalkulations-Engine
   Anforderungen: 
   - Nutzt Vendor-CDNs (gsap, lottie, notyf, fuse.js, chart.js, tippy) sofern verfügbar (vendor.js lädt diese).
   - Läuft robust auch ohne Vendor (Feature-Detection + Fallbacks).
   - Liest Domänenwissen aus data/careers.json (Tarif, Karrierepfade, Quellen).
   - Bietet präzise Gehalts-/Dienst-Kalkulation auf Basis des TV-Ärzte/St. Georg inkl. 6. Ä-TV (2025).
   - UI: progressive Enhancement, ARIA, Tastaturbedienbarkeit, Animations-on-scroll (GSAP) wenn vorhanden.
   - Keine externen Integritäts- oder CSP-Restriktionen (CDN ohne integrity).
*/

(() => {
  "use strict";

  /*****************************************************************
   * Minimal Utilities
   *****************************************************************/
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const on = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const noop = () => {};
  const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  const fmt = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
  const fmtInt = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
  const fmtPct = (v, digits = 1) => `${v.toFixed(digits).replace(".", ",")}%`;

  const parseDeNumber = (txt) => {
    if (typeof txt === "number") return txt;
    if (!txt) return 0;
    // allow "1.234,56" or "1234,56" or "1234.56" or "1 234,56"
    const normalized = String(txt).replace(/\./g, "").replace(/\s/g, "").replace(",", ".");
    const n = Number(normalized);
    return Number.isFinite(n) ? n : 0;
  };

  // Focus ring helper
  const focusVisiblePolyfill = () => {
    let hadKeyboardEvent = true;
    const KEY_CODES = new Set(["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
    const focusTriggersKeyboardModality = (e) => {
      if (KEY_CODES.has(e.key)) {
        hadKeyboardEvent = true;
        document.documentElement.classList.add("modality--keyboard");
      }
    };
    const pointerDown = () => {
      hadKeyboardEvent = false;
      document.documentElement.classList.remove("modality--keyboard");
    };
    document.addEventListener("keydown", focusTriggersKeyboardModality, { capture: true, passive: true });
    document.addEventListener("mousedown", pointerDown, { capture: true, passive: true });
    document.addEventListener("pointerdown", pointerDown, { capture: true, passive: true });
    document.addEventListener("touchstart", pointerDown, { capture: true, passive: true });
    document.addEventListener("focus", (e) => {
      if (hadKeyboardEvent) e.target.classList.add("focus--keyboard");
    }, { capture: true, passive: true });
    document.addEventListener("blur", (e) => e.target.classList.remove("focus--keyboard"), { capture: true, passive: true });
  };

  /*****************************************************************
   * Vendor (optional) Detection
   *****************************************************************/
  const VENDOR = {
    gsap: window.gsap || null,
    ScrollTrigger: window.ScrollTrigger || null,
    lottie: window.lottie || null,
    Notyf: window.Notyf || null,
    Fuse: window.Fuse || null,
    Chart: window.Chart || null,
    tippy: window.tippy || null,
  };

  /*****************************************************************
   * Notifications
   *****************************************************************/
  const notifier = (() => {
    try {
      if (VENDOR.Notyf) {
        return new VENDOR.Notyf({
          duration: 3500,
          position: { x: "right", y: "top" },
          dismissible: true,
        });
      }
    } catch (_) { /* ignore */ }
    return {
      success: (msg) => console.log("✔︎", msg),
      error: (msg) => console.warn("✖︎", msg),
      open: (obj) => console.log("ℹ︎", obj?.message || obj),
    };
  })();

  /*****************************************************************
   * State & Data Layer
   *****************************************************************/
  const State = {
    data: null,               // careers.json content
    tariffIndex: null,        // optimized lookup structures
    theme: (localStorage.getItem("theme") || "system"),
    route: "overview",
    selectedCompare: new Set(),
  };

  // Build quick indices & helpers after data load
  const buildTariffIndex = (data) => {
    const idx = {
      versions: [],
      entgelttabellen: {}, // by valid_from -> { EG: { stufe: value } }
      bdHourly: {},        // by valid_from -> { EG: value }
      rbFactors: {},       // stage factors mapping table
      rbExtraTaxfree: {},  // taxfree percentages for RB by slot
      weeklyHours: 40,
      schichtzulage: [],   // [{valid_from, monthly_eur}]
      wechselschichtNachtzuschlag: [], // [{valid_from, eur_per_hour}]
    };

    try {
      idx.weeklyHours = data?.tariff?.weekly_hours || 40;

      // Entgelttabellen (tabellenentgelt)
      (data?.tariff?.entgelttabellen || []).forEach((t) => {
        idx.entgelttabellen[t.valid_from] = t.table; // { EG_I: [...], EG_II: [...], ... }
        idx.versions.push(t.valid_from);
      });

      // BD Stundenentgelte
      (data?.tariff?.bd_hourly || []).forEach((row) => {
        idx.bdHourly[row.valid_from] = row.by_eg; // {EG_I: 31.23, EG_II: 38.03, ...}
        if (!idx.versions.includes(row.valid_from)) idx.versions.push(row.valid_from);
      });

      // RB factors (Bewertung als Arbeitszeit in % je Slot & Stufe)
      idx.rbFactors = data?.tariff?.rb_factors || {};

      // RB tax-free Zuschläge je Slot (% auf Entgelt RB)
      idx.rbExtraTaxfree = data?.tariff?.rb_taxfree || {};

      // Schichtzulage (monatlich)
      idx.schichtzulage = data?.tariff?.schichtzulage || [];

      // Nachtarbeit in Wechselschicht (fix €/h)
      idx.wechselschichtNachtzuschlag = data?.tariff?.wechselschicht_nacht_eur_per_h || [];

      // Sort versions by date asc
      idx.versions.sort((a, b) => new Date(a) - new Date(b));
    } catch (e) {
      console.warn("Tariff index build failed", e);
    }

    return idx;
  };

  // Effective version key for a given date (latest <= date)
  const pickVersion = (idx, y, m) => {
    const d = new Date(Date.UTC(Number(y), Number(m) - 1, 15));
    const iso = d.toISOString().slice(0, 10);
    let pick = idx.versions[0];
    for (const v of idx.versions) {
      if (new Date(v) <= d) pick = v;
      else break;
    }
    return pick;
  };

  // Lookup helpers
  const getBaseMonthly = (idx, versionKey, eg, stufe) => {
    const table = idx.entgelttabellen[versionKey];
    if (!table) return 0;
    const egKey = eg.replace("-", "_"); // EG-II => EG_II
    const arr = table[egKey] || [];
    const i = clamp(Number(stufe) - 1, 0, arr.length - 1);
    return parseDeNumber(arr[i] || 0);
  };

  const getBDHourly = (idx, versionKey, eg) => {
    // fallback: search back in versions if exact versionKey absent for bdHourly
    let bd = idx.bdHourly[versionKey];
    if (bd && has(bd, eg)) return parseDeNumber(bd[eg]);

    const vers = idx.versions.slice().sort((a, b) => new Date(a) - new Date(b));
    let last = 0;
    for (const v of vers) {
      if (new Date(v) <= new Date(versionKey) && idx.bdHourly[v] && has(idx.bdHourly[v], eg)) {
        last = parseDeNumber(idx.bdHourly[v][eg]);
      }
    }
    return last || 0;
  };

  const getMonthlyHours = (weeklyHours = 40) => weeklyHours * 52 / 12; // 4.333... We'll use 4.333333 precise
  const hourlyFromMonthly = (monthly, weeklyHours = 40) => {
    const h = getMonthlyHours(weeklyHours);
    return h > 0 ? monthly / h : 0;
  };

  const getSchichtzulage = (idx, y, m) => {
    const d = new Date(Number(y), Number(m) - 1, 1);
    let val = 0;
    for (const it of idx.schichtzulage) {
      if (new Date(it.valid_from) <= d) val = parseDeNumber(it.eur_per_month);
    }
    return val;
  };

  const getWechselschichtNachtEuro = (idx, y, m) => {
    const d = new Date(Number(y), Number(m) - 1, 1);
    let val = 0;
    for (const it of idx.wechselschichtNachtzuschlag) {
      if (new Date(it.valid_from) <= d) val = parseDeNumber(it.eur_per_hour);
    }
    return val;
  };

  /*****************************************************************
   * Theme & Header Interactions
   *****************************************************************/
  const Theme = (() => {
    const root = document.documentElement;
    const picker = $("#themePicker");
    const trigger = $("#menuTrigger");
    const drawer = $("#drawer");

    const setTheme = (mode) => {
      State.theme = mode;
      localStorage.setItem("theme", mode);
      if (mode === "system") {
        root.removeAttribute("data-theme");
      } else {
        root.setAttribute("data-theme", mode);
      }
      updatePickerUI();
    };

    const updatePickerUI = () => {
      $$(".theme-btn").forEach(btn => {
        btn.setAttribute("aria-pressed", String(btn.dataset.theme === State.theme));
      });
      // indicator movement could be done via CSS translate, but keep minimal here
    };

    const init = () => {
      // Restore / set initial
      setTheme(State.theme);

      // Toggle drawer
      on(trigger, "click", () => {
        const open = drawer.hasAttribute("open");
        if (open) drawer.removeAttribute("open"); else drawer.setAttribute("open", "");
      });

      // Theme buttons
      $$(".theme-btn", picker).forEach(btn => {
        on(btn, "click", () => setTheme(btn.dataset.theme));
      });
    };

    return { init, setTheme };
  })();

  /*****************************************************************
   * Router
   *****************************************************************/
  const Router = (() => {
    const outlet = $("#viewOutlet");
    const routes = new Map();

    const register = (name, renderFn) => routes.set(name, renderFn);

    const parseHash = () => {
      const h = location.hash.replace(/^#\/?/, "");
      return h || "overview";
    };

    const render = async () => {
      const name = parseHash();
      State.route = name;
      if (!routes.has(name)) return routes.get("overview")?.();
      await routes.get(name)();
      animateIn(outlet);
    };

    const goto = (name) => {
      if (!name) name = "overview";
      if (location.hash.replace(/^#\/?/, "") !== name) {
        location.hash = `#/${name}`;
      } else {
        render(); // re-render same route
      }
    };

    const init = () => {
      on(window, "hashchange", render);
      on(window, "load", render);
      // nav links
      $$("a[data-nav]").forEach(a => {
        on(a, "click", (e) => {
          e.preventDefault();
          goto(a.dataset.nav);
        });
      });
    };

    return { init, goto, render };
  })();

  /*****************************************************************
   * Animations (hero, scroll-in)
   *****************************************************************/
  const animateIn = (root = document) => {
    try {
      if (!VENDOR.gsap) return;
      const targets = $$(".fade-in", root);
      if (!targets.length) return;
      VENDOR.gsap.set(targets, { autoAlpha: 0, y: 16 });
      VENDOR.gsap.to(targets, {
        autoAlpha: 1, y: 0, duration: 0.6, ease: "power2.out", stagger: 0.06
      });
    } catch(_) {}
  };

  const initHeroAnimation = () => {
    const svg = $("#heroAnim");
    if (!svg || !VENDOR.gsap) return;
    const p = $("#hero-precision");
    const l = $("#hero-learning");
    const i = $("#hero-impact");
    VENDOR.gsap.set([p, l, i], { autoAlpha: 0, x: -8 });
    VENDOR.gsap.to([p, l, i], { autoAlpha: 1, x: 0, duration: 0.6, ease: "power2.out", stagger: 0.15, delay: 0.2 });

    // simple stroke-draw for the path
    const paths = $$("path", svg);
    paths.forEach(path => {
      const len = path.getTotalLength?.() || 400;
      path.style.strokeDasharray = String(len);
      path.style.strokeDashoffset = String(len);
      if (VENDOR.gsap) {
        VENDOR.gsap.to(path, { strokeDashoffset: 0, duration: 1.5, ease: "power2.out", delay: 0.1 });
      }
    });
  };

  /*****************************************************************
   * Data Loading (careers.json)
   *****************************************************************/
  const loadData = async () => {
    try {
      const res = await fetch("data/careers.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // Build index
      State.data = data;
      State.tariffIndex = buildTariffIndex(data);
      return true;
    } catch (e) {
      notifier.error("Daten konnten nicht geladen werden. Fallback wird verwendet.");
      console.warn("Falling back minimal dataset", e);

      // Minimal fallback (nur damit App startet – tatsächliche Daten kommen aus careers.json)
      State.data = {
        profile: {
          name: "Dr. med. Markus Lurz",
          role: "Facharzt für Radiologie | MRT-Leitung | IT & KI-Integration",
          location: "Leipzig, Deutschland",
          summary: "Radiologie (MRT/CT/Röntgen), Abteilungsleitung MRT, Protokoll-Optimierung, teleradiologische Expertise, Syngo.via & KI-Integration.",
        },
        tariff: {
          weekly_hours: 40,
          entgelttabellen: [
            {
              valid_from: "2025-04-01",
              table: {
                EG_I: [5223, 5516, 5728, 6104, 6542, 6722],
                EG_II: [6910, 7489, 7992, 8300, 8587, 8887, 9174],
                EG_III: [8643, 9155, 9865, 10341],
                EG_IV: [10165, 10904, 11122]
              }
            }
          ],
          bd_hourly: [
            { valid_from: "2025-04-01", by_eg: { EG_I: 32.78, EG_II: 38.03, EG_III: 41.29, EG_IV: 43.92 } }
          ],
          rb_factors: {
            // Stufe I / II / III in %
            wd_6_20: { I: 12.50, II: 12.90, III: 16.67 },
            wd_4_6: { I: 10.00, II: 10.32, III: 13.34 },
            wd_20_24: { I: 10.00, II: 10.32, III: 13.34 },
            wd_0_4: { I: 8.93, II: 9.21, III: 11.91 },
            sat: { I: 12.50, II: 12.90, III: 16.67 },
            sun: { I: 8.33, II: 0, III: 11.11 },
            hol: { I: 5.56, II: 0, III: 7.41 },
            silvester_14_24: { I: 5.56, II: 0, III: 7.41 },
            weihnachtstag: { I: 5.00, II: 0, III: 6.67 },
            heiligabend_14_24: { I: 5.00, II: 0, III: 6.67 },
            erster_mai: { I: 5.00, II: 0, III: 6.67 }
          },
          rb_taxfree: {
            wd_6_20: 0,
            wd_4_6: 25.0,
            wd_20_24: 25.0,
            wd_0_4: 40.0,
            sun: 50.0,
            hol: 125.0,
            silvester_14_24: 125.0,
            weihnachtstag: 150.0,
            heiligabend_14_24: 150.0,
            erster_mai: 150.0
          },
          schichtzulage: [
            { valid_from: "2022-01-01", eur_per_month: 200 },
            { valid_from: "2025-04-01", eur_per_month: 220 }
          ],
          wechselschicht_nacht_eur_per_h: [
            { valid_from: "2022-01-01", eur_per_hour: 7.50 },
            { valid_from: "2025-04-01", eur_per_hour: 8.25 }
          ]
        },
        tracks: [],
        sources: []
      };
      State.tariffIndex = buildTariffIndex(State.data);
      return false;
    }
  };

  /*****************************************************************
   * Overview Renderer
   *****************************************************************/
  const ViewOverview = async () => {
    const el = $("#viewOutlet");
    const p = State.data?.profile || {};
    const tracks = State.data?.tracks || [];
    const now = new Date();
    el.innerHTML = `
      <section class="fade-in">
        <div class="overview-grid">
          <article class="card kpi" role="group" aria-labelledby="kpi1">
            <h3 id="kpi1">Kernprofil</h3>
            <p><strong>${p.name || ""}</strong></p>
            <p>${p.role || ""}</p>
            <p><span class="tag">MRT-Leitung</span> <span class="tag">Protokoll-Optimierung</span> <span class="tag">teleradiologisch</span> <span class="tag">syngo.via</span> <span class="tag">KI-Integration</span></p>
          </article>

          <article class="card kpi" role="group" aria-labelledby="kpi2">
            <h3 id="kpi2">Karrierepfade</h3>
            <p>Aktiv recherchierte Optionen: <strong>${tracks.length}</strong></p>
            <div class="hl">
              <div>Letzte Aktualisierung</div>
              <div>${now.toLocaleDateString("de-DE")}</div>
            </div>
          </article>

          <article class="card kpi" role="group" aria-labelledby="kpi3">
            <h3 id="kpi3">Tarifversionen</h3>
            <p>Bekannte wirksame Stände: <strong>${State.tariffIndex?.versions?.length || 0}</strong></p>
            <p class="muted">Automatische Versionswahl je Monat</p>
          </article>

          <article class="card kpi" role="group" aria-labelledby="kpi4">
            <h3 id="kpi4">Toolset</h3>
            <p>Interaktive Kalkulation (BD/RB), Vergleichsmatrix, Quellenbrowser.</p>
            <p class="muted">Animations- &amp; Search-Enhancements aktiv.</p>
          </article>
        </div>
      </section>
    `;

    // simple tilt or entrance animation
    animateIn(el);
  };

  /*****************************************************************
   * Profile Renderer
   *****************************************************************/
  const ViewProfile = async () => {
    const el = $("#viewOutlet");
    const p = State.data?.profile || {};
    // Fill existing static section with richer data
    $("#profileSummary")?.textContent = p.summary || $("#profileSummary")?.textContent;

    // Skills could be enriched from data
    const skillsList = $("#skillsList");
    if (skillsList && Array.isArray(p.skills)) {
      skillsList.innerHTML = p.skills.map(s => `<span class="skill">${s}</span>`).join("");
    }

    // Projects / Publications etc.
    const perf = p?.highlights || [
      { title: "MRT-Protokolloptimierung (3T/1.5T)", value: "Leitung & Standardisierung", note: "MAGNETOM Prisma fit, Altea" },
      { title: "KI-Integration Radiologie", value: "syngo.via & PACS-Workflow", note: "Befundunterstützung" },
      { title: "Teleradiologie", value: "Mehrstandort-Betrieb", note: "Wermsdorf + 8 weitere Kliniken" },
    ];

    const perfGrid = document.createElement("div");
    perfGrid.className = "overview-grid fade-in";
    perfGrid.innerHTML = perf.map(item => `
      <article class="card" role="group" aria-labelledby="${item.title}">
        <h3 id="${item.title}">${item.title}</h3>
        <p><strong>${item.value}</strong></p>
        ${item.note ? `<p class="muted">${item.note}</p>` : ""}
      </article>
    `).join("");

    el.innerHTML = ``; // clear
    el.append(perfGrid);
    animateIn(el);
  };

  /*****************************************************************
   * Tracks Renderer (Search, Filter, Compare)
   *****************************************************************/
  const ViewTracks = async () => {
    const el = $("#viewOutlet");
    const tracks = State.data?.tracks || [];

    const tagSet = new Set();
    tracks.forEach(t => (t.tags || []).forEach(tag => tagSet.add(tag)));
    const tags = Array.from(tagSet);

    el.innerHTML = `
      <section class="fade-in">
        <div class="tracks-controls">
          <div class="search">
            <input id="trackSearch" type="search" placeholder="Suchen (z. B. 'Teleradiologie', 'Siemens', 'Remote')"
                   aria-label="Karrierepfade durchsuchen" />
          </div>
          <div class="filters" role="toolbar" aria-label="Filter">
            <button class="btn btn--sm" data-filter="*">Alle</button>
            ${tags.map(t => `<button class="btn btn--sm" data-filter="${t}">${t}</button>`).join("")}
          </div>
        </div>
        <div id="tracksGrid" class="cards-grid"></div>
      </section>
    `;

    const grid = $("#tracksGrid", el);

    const renderCards = (list) => {
      grid.innerHTML = list.map(track => TrackCard(track)).join("");
      bindTrackCardEvents();
    };

    const TrackCard = (t) => {
      const id = `t_${t.id || Math.random().toString(36).slice(2)}`;
      const tagsHtml = (t.tags || []).map(x => `<span class="tag">${x}</span>`).join("");
      const badges = (t.badges || []).map(x => `<span class="badge">${x}</span>`).join("");
      const selected = State.selectedCompare.has(t.slug || id) ? "aria-pressed='true'" : "aria-pressed='false'";
      return `
        <article class="card track" data-slug="${t.slug || id}">
          <header class="card__header">
            <div>
              <h3>${t.title}</h3>
              <div class="card__meta">${tagsHtml}</div>
            </div>
            <div class="actions">
              <button class="btn btn--ghost add-compare" ${selected} title="Zum Vergleich hinzufügen">
                <span class="btn__icon" aria-hidden="true">+</span><span class="sr-only">Vergleichen</span>
              </button>
            </div>
          </header>
          <div class="card__body">
            ${t.summary ? `<p>${t.summary}</p>` : ""}
            ${badges ? `<div class="badges">${badges}</div>` : ""}
            ${t.key_points ? `<ul class="bullets">${t.key_points.map(li => `<li>${li}</li>`).join("")}</ul>` : ""}
          </div>
          <footer class="card__footer">
            <button class="btn more" data-details="${t.slug || id}">Mehr Details</button>
          </footer>
        </article>

        <dialog class="modal" id="dlg_${t.slug || id}" aria-label="${t.title}">
          <article class="modal__content">
            <header>
              <h3>${t.title}</h3>
              <button class="btn btn--ghost close" data-close="${t.slug || id}" aria-label="Schließen">✕</button>
            </header>
            <section class="modal__body">
              ${t.details_html || `<p>${t.details || "Ausführliche Beschreibung wird bereitgestellt."}</p>`}
              ${renderPositions(t.positions || [])}
              ${renderSources(t.sources || [])}
            </section>
            <footer class="modal__footer">
              <button class="btn btn--primary add-compare" data-slug="${t.slug || id}">Zum Vergleich</button>
            </footer>
          </article>
        </dialog>
      `;
    };

    const renderPositions = (positions) => {
      if (!positions.length) return "";
      return `
        <h4>Konkrete Positionen</h4>
        <div class="positions">
          ${positions.map(p => `
            <section class="position">
              <header class="position__head">
                <h5>${p.title} <span class="muted">– ${p.company || p.employer || ""}${p.location ? ", " + p.location : ""}</span></h5>
              </header>
              <div class="position__grid">
                <div><strong>Vergütung:</strong> ${p.compensation_note || ""} ${p.salary_min ? fmt.format(p.salary_min) : ""}${p.salary_max ? " – " + fmt.format(p.salary_max) : ""}</div>
                <div><strong>Arbeitszeit:</strong> ${p.working_time || "n. a."}</div>
                <div><strong>Modell:</strong> ${p.model || "n. a."}</div>
                <div><strong>Vertrag:</strong> ${p.contract || "n. a."}</div>
              </div>
              ${p.requirements?.length ? `<h6>Anforderungen</h6><ul class="bullets">${p.requirements.map(r => `<li>${r}</li>`).join("")}</ul>` : ""}
              ${p.benefits?.length ? `<h6>Benefits</h6><ul class="bullets">${p.benefits.map(r => `<li>${r}</li>`).join("")}</ul>` : ""}
              ${p.notes?.length ? `<h6>Besonderheiten</h6><ul class="bullets">${p.notes.map(r => `<li>${r}</li>`).join("")}</ul>` : ""}
            </section>
          `).join("")}
        </div>
      `;
    };

    const renderSources = (sources) => {
      if (!sources.length) return "";
      return `
        <h4>Quellen</h4>
        <ul class="links">
          ${sources.map(s => `<li><a href="${s.url}" target="_blank" rel="noopener">${s.label || s.url}</a>${s.note ? ` – <span class="muted">${s.note}</span>` : ""}</li>`).join("")}
        </ul>
      `;
    };

    const bindTrackCardEvents = () => {
      // Details
      $$(".card.track .more").forEach(btn => {
        on(btn, "click", () => {
          const slug = btn.dataset.details;
          const dlg = $(`#dlg_${slug}`);
          dlg?.showModal?.();
        });
      });
      $$(".modal .close").forEach(btn => {
        on(btn, "click", () => {
          const slug = btn.dataset.close;
          const dlg = $(`#dlg_${slug}`);
          dlg?.close?.();
        });
      });

      // Compare
      $$(".add-compare").forEach(btn => {
        on(btn, "click", () => {
          const containerCard = btn.closest(".card.track");
          const slug = btn.dataset.slug || containerCard?.dataset.slug;
          if (!slug) return;

          if (State.selectedCompare.has(slug)) {
            State.selectedCompare.delete(slug);
            btn.setAttribute("aria-pressed", "false");
            notifier.open({ type: "info", message: "Aus Vergleich entfernt." });
          } else {
            State.selectedCompare.add(slug);
            btn.setAttribute("aria-pressed", "true");
            notifier.success("Zum Vergleich hinzugefügt.");
          }
        });
      });
    };

    // Initial render
    renderCards(tracks);

    // Filtering
    $$(".filters .btn").forEach(btn => {
      on(btn, "click", () => {
        const f = btn.dataset.filter;
        if (f === "*") {
          renderCards(tracks);
        } else {
          renderCards(tracks.filter(t => (t.tags || []).includes(f)));
        }
      });
    });

    // Search (Fuse)
    const input = $("#trackSearch");
    if (VENDOR.Fuse) {
      const fuse = new VENDOR.Fuse(tracks, {
        keys: ["title", "summary", "details", "tags", "positions.title", "positions.company", "positions.employer", "positions.location"],
        threshold: 0.35,
        ignoreLocation: true,
        minMatchCharLength: 2,
      });
      on(input, "input", () => {
        const q = input.value.trim();
        if (!q) return renderCards(tracks);
        const res = fuse.search(q).map(x => x.item);
        renderCards(res);
      });
    } else {
      // Simple filter fallback
      on(input, "input", () => {
        const q = input.value.trim().toLowerCase();
        if (!q) return renderCards(tracks);
        const res = tracks.filter(t => JSON.stringify(t).toLowerCase().includes(q));
        renderCards(res);
      });
    }

    animateIn(el);
  };

  /*****************************************************************
   * Calculator (TV-Ärzte/St. Georg)
   *****************************************************************/
  const ViewCalculator = async () => {
    const el = $("#viewOutlet");
    const idx = State.tariffIndex;

    el.innerHTML = `
      <section class="calc fade-in">
        <div class="calc__grid">
          <div class="panel">
            <h3>Eingaben</h3>
            <div class="calc__form">
              <div class="form-row">
                <label for="calcMonth">Monat</label>
                <select id="calcMonth" aria-label="Monat">
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
                  <label>BD-Stufe</label>
                  <select id="bdLevel">
                    <option value="I">I (65%)</option>
                    <option value="II">II (80%)</option>
                    <option value="III" selected>III (95%)</option>
                  </select>

                  <label>BD-Stunden gesamt</label>
                  <input id="bdHours" type="number" min="0" step="0.5" value="0" />

                  <label>davon Nachtstunden (21–6 Uhr)</label>
                  <input id="bdNightHours" type="number" min="0" step="0.5" value="0" />

                  <label>davon Feiertagsstunden</label>
                  <input id="bdHolidayHours" type="number" min="0" step="0.5" value="0" />
                </div>
                <p class="muted">BD-Vergütung je Stunde gemäß § 12 Abs. 2 TV-Ärzte/St. Georg (statisch je EG, abhängig von Tarifstand). Nacht im BD: +15 % (§ 12 Abs. 5), Feiertag im BD: +25 % (§ 12 Abs. 4), ab der 97. BD-Stunde: +5 % Zuschlag (§ 12 Abs. 3).</p>
              </details>

              <details class="mt" open>
                <summary>Rufbereitschaft (RB)</summary>
                <div class="form-grid" id="rbContainer">
                  <label>RB-Stufe</label>
                  <select id="rbLevel">
                    <option value="I">I</option>
                    <option value="II">II</option>
                    <option value="III" selected>III</option>
                  </select>

                  <label>Werktag 6–20 Uhr (h)</label>
                  <input id="rb_wd_6_20" type="number" min="0" step="0.5" value="0" />

                  <label>Werktag 4–6 Uhr (h)</label>
                  <input id="rb_wd_4_6" type="number" min="0" step="0.5" value="0" />

                  <label>Werktag 20–24 Uhr (h)</label>
                  <input id="rb_wd_20_24" type="number" min="0" step="0.5" value="0" />

                  <label>Werktag 0–4 Uhr (h)</label>
                  <input id="rb_wd_0_4" type="number" min="0" step="0.5" value="0" />

                  <label>Samstag (h)</label>
                  <input id="rb_sat" type="number" min="0" step="0.5" value="0" />

                  <label>Sonntag (h)</label>
                  <input id="rb_sun" type="number" min="0" step="0.5" value="0" />

                  <label>Feiertag (h)</label>
                  <input id="rb_hol" type="number" min="0" step="0.5" value="0" />
                </div>
                <p class="muted">RB-Bewertung gemäß § 12a (Faktor in % als Arbeitszeit) + individueller Stundenentgelt-Satz (§ 12a Abs. 2). Steuerfreie Zuschläge je Zeitfenster gemäß § 12a Abs. 3.</p>
              </details>

              <details class="mt">
                <summary>Schicht- & Nachtzuschläge (außerhalb BD/RB)</summary>
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

                  <label>Feiertagsarbeit ohne Freizeitausgleich (h)</label>
                  <input id="holNoCompHours" type="number" min="0" step="0.5" value="0" />

                  <label>Feiertagsarbeit mit Freizeitausgleich (h)</label>
                  <input id="holWithCompHours" type="number" min="0" step="0.5" value="0" />
                </div>
                <p class="muted">§ 11: Sonntagsarbeit 40 % (auf Stufe 3), Feiertag 135 % (ohne FA) / 35 % (mit FA) (auf Stufe 3), Nachtarbeit 15 % (auf Stufe 3), zusätzlich Wechselschicht-Nacht fix €/h gemäß Änderungs-TV. Überstunden werden hier nicht berechnet.</p>
              </details>

              <div class="form-row mt">
                <button id="btnCalc" class="btn btn--primary">Berechnen</button>
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
                    <p class="muted">inkl. EG/Stufe zum Tarifstand</p>
                  </div>
                  <div class="result-amount" id="resBase">–</div>
                </div>
                <div class="result-details">
                  <div class="result-item"><span>Tarifstand</span><span id="resVersion">–</span></div>
                  <div class="result-item"><span>EG/Stufe</span><span id="resEGStufe">–</span></div>
                  <div class="result-item"><span>Stundenentgelt (individuell)</span><span id="resBaseHourly">–</span></div>
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
                  <div class="result-item"><span>BD-Stufe</span><span id="resBDLevel">–</span></div>
                  <div class="result-item"><span>BD-Zuschläge (Nacht/Feiertag/≥97h)</span><span id="resBDZuschl">–</span></div>
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
                  <div class="result-item"><span>RB-Arbeitszeit-Äquivalent</span><span id="resRBHoursEq">–</span></div>
                  <div class="result-item"><span>Steuerfreie Zuschläge</span><span id="resRBTaxfree">–</span></div>
                </div>
              </div>

              <div class="result-card">
                <div class="result-card__header">
                  <div>
                    <h4>Schicht/Nacht/Sonntag/Feiertag</h4>
                    <p class="muted">§ 11</p>
                  </div>
                  <div class="result-amount" id="resShift">–</div>
                </div>
                <div class="result-details">
                  <div class="result-item"><span>Schichtzulage (monatlich)</span><span id="resSchichtZul">–</span></div>
                  <div class="result-item"><span>Wechselschicht-Nacht (€/h)</span><span id="resWsNacht">–</span></div>
                  <div class="result-item"><span>§ 11-Zuschläge (Summe)</span><span id="resPara11Sum">–</span></div>
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
                <summary>Hinweise & Rechenlogik (vollständig)</summary>
                <ul class="bullets small">
                  <li><strong>Tabellenentgelt:</strong> aus Entgelttabelle (EG/Stufe) zum wirksamen Tarifstand des Monats.</li>
                  <li><strong>Stundenentgelt (individuell):</strong> Tabellenentgelt / (wöchentl. Stunden × 52 / 12).</li>
                  <li><strong>BD (§ 12):</strong> BD-Stunden × BD-Basis (je EG/Stand). Nacht im BD: +15 % auf BD-Basis; Feiertag im BD: +25 % auf BD-Basis; ab 97. BD-Stunde: +5 %/h auf BD-Basis (nur für h ≥ 97).</li>
                  <li><strong>RB (§ 12a):</strong> Je Slot: Stunden × Faktor(%) = Arbeitszeit-Äquivalent; Vergütung = Äquivalent × individuelles Stundenentgelt. Zusätzlich steuerfreie Zuschläge als % auf RB-Entgelt je Slot.</li>
                  <li><strong>§ 11-Zuschläge:</strong> Sonntags 40 % / Feiertag 135 % (ohne FA) bzw. 35 % (mit FA) / Nacht 15 % – jeweils auf das Stundenentgelt der Stufe 3 der EG. Wechselschicht-Nacht zusätzlich fixer €/h-Betrag.</li>
                  <li><strong>Schichtzulage:</strong> bei ständiger Schichtarbeit (monatlich, abhängig vom Stand).</li>
                </ul>
              </details>
            </div>
          </div>
        </div>
      </section>
    `;

    // Populate defaults
    const now = new Date();
    $("#calcMonth").value = String(now.getMonth() + 1);
    $("#calcYear").value = String(now.getFullYear());

    // Populate Stufen dynamisch basierend auf Entgelttabelle
    const egSel = $("#calcEG");
    const stufeSel = $("#calcStufe");
    const updateStufen = () => {
      const y = Number($("#calcYear").value);
      const m = Number($("#calcMonth").value);
      const version = pickVersion(idx, y, m);
      const eg = egSel.value.replace(" ", "_").replace("-", "_"); // EG_II
      const table = idx.entgelttabellen[version] || {};
      const arr = table[eg] || [];
      stufeSel.innerHTML = arr.map((_, i) => `<option value="${i+1}">${i+1}</option>`).join("");
      stufeSel.value = String(Math.min(3, arr.length)); // sensible default
    };
    on(egSel, "change", updateStufen);
    on($("#calcMonth"), "change", updateStufen);
    on($("#calcYear"), "input", updateStufen);
    updateStufen();

    // Calculation
    const calc = () => {
      const y = Number($("#calcYear").value);
      const m = Number($("#calcMonth").value);
      const egHuman = $("#calcEG").value.trim();        // "EG II"
      const eg = egHuman.replace(" ", "_");             // "EG_II"
      const stufe = Number($("#calcStufe").value || 1);
      const version = pickVersion(idx, y, m);

      // Base monthly & hourly
      const baseMonthly = getBaseMonthly(idx, version, eg, stufe);
      const baseHourlyIndiv = hourlyFromMonthly(baseMonthly, idx.weeklyHours);

      // §11 Stufe-3 Stundenentgelt (für Prozent-Zuschläge)
      const hourlyOnStufe3 = (() => {
        const baseOnStufe3 = getBaseMonthly(idx, version, eg, 3) || baseMonthly;
        return hourlyFromMonthly(baseOnStufe3, idx.weeklyHours);
      })();

      // BD
      const bdLevel = $("#bdLevel").value; // I/II/III – beeinflusst Bewertung (hier relevant für Transparenz; Vergütung hier per statischer €/h)
      const bdHours = parseDeNumber($("#bdHours").value);
      const bdNightHours = clamp(parseDeNumber($("#bdNightHours").value), 0, bdHours);
      const bdHolidayHours = clamp(parseDeNumber($("#bdHolidayHours").value), 0, bdHours - bdNightHours);
      const bdHourly = getBDHourly(idx, version, eg);
      const bdBase = bdHours * bdHourly;

      // §12 Abs. 5: Nacht im BD +15% auf BD-Basis
      const bdNightPlus = bdNightHours * (bdHourly * 0.15);
      // §12 Abs. 4: Feiertag im BD +25% auf BD-Basis
      const bdHolPlus = bdHolidayHours * (bdHourly * 0.25);
      // §12 Abs. 3: ab 97. Stunde im Monat +5%/h (nur auf >97)
      const extraHoursOver97 = Math.max(0, bdHours - 97);
      const bdPlus97 = extraHoursOver97 * (bdHourly * 0.05);

      const bdTotal = bdBase + bdNightPlus + bdHolPlus + bdPlus97;

      // RB
      const rbLevel = $("#rbLevel").value; // I/II/III – steuert Faktor je Slot
      const rbSlots = [
        ["wd_6_20", parseDeNumber($("#rb_wd_6_20").value)],
        ["wd_4_6", parseDeNumber($("#rb_wd_4_6").value)],
        ["wd_20_24", parseDeNumber($("#rb_wd_20_24").value)],
        ["wd_0_4", parseDeNumber($("#rb_wd_0_4").value)],
        ["sat", parseDeNumber($("#rb_sat").value)],
        ["sun", parseDeNumber($("#rb_sun").value)],
        ["hol", parseDeNumber($("#rb_hol").value)],
      ];

      let rbHoursEqSum = 0;
      let rbEuroSum = 0;
      let rbTaxfreeSum = 0;

      for (const [slot, hrs] of rbSlots) {
        if (!hrs) continue;
        const f = idx.rbFactors?.[slot]?.[rbLevel] || 0;         // %, e.g. 12.5
        const hrsEq = hrs * (f / 100.0);                         // in Stunden
        const euro = hrsEq * baseHourlyIndiv;                    // Vergütung lt. §12a Abs.2
        const taxfreePct = (idx.rbExtraTaxfree?.[slot] || 0) / 100.0;
        const taxfree = euro * taxfreePct;                       // Zusätzlicher steuerfreier Zuschlag
        rbHoursEqSum += hrsEq;
        rbEuroSum += euro;
        rbTaxfreeSum += taxfree;
      }

      // §11 – Schicht & Nacht & Sonn/Feiertagsarbeit (außerhalb BD/RB)
      const schichtDauerhaft = $("#schichtDauerhaft").value === "ja";
      const wsNacht = parseDeNumber($("#wsNachtHours").value);
      const sunH = parseDeNumber($("#sunHours").value);
      const holNoCompH = parseDeNumber($("#holNoCompHours").value);
      const holWithCompH = parseDeNumber($("#holWithCompHours").value);

      const schichtZulMonat = schichtDauerhaft ? getSchichtzulage(idx, y, m) : 0;
      const wsNachtEur = getWechselschichtNachtEuro(idx, y, m);
      const wsNachtSum = wsNacht * wsNachtEur;

      // §11: Sonntags 40% / Feiertag 135% (ohne FA) / 35% (mit FA) / Nacht 15%
      // Nacht außerhalb BD: wir nehmen hier Nachtanteil via wsNacht input (für fix €/h) und optional könnten 15% Nacht hinzukommen
      // Da Nachtarbeit nach §11 b) 15% je Stunde (auf Stufe-3), aber wir haben bereits den fixen WS-Nachtbetrag. 
      // Für maximale Genauigkeit: getrennte Eingabe für „Nachtarbeit (außerhalb WS)“ ist nicht vorhanden; wir belassen es beim fixen WS-Nachtbetrag.
      const sunSum = sunH * (hourlyOnStufe3 * 0.40);
      const holNoCompSum = holNoCompH * (hourlyOnStufe3 * 1.35);
      const holWithCompSum = holWithCompH * (hourlyOnStufe3 * 0.35);
      const para11Sum = sunSum + holNoCompSum + holWithCompSum + wsNachtSum;

      // Totals
      const total = baseMonthly + bdTotal + rbEuroSum + schichtZulMonat + para11Sum;

      // Render
      $("#resVersion").textContent = version;
      $("#resEGStufe").textContent = `${egHuman} / Stufe ${stufe}`;
      $("#resBase").textContent = fmt.format(baseMonthly);
      $("#resBaseHourly").textContent = fmt.format(baseHourlyIndiv);

      $("#resBD").textContent = fmt.format(bdTotal);
      $("#resBDHourly").textContent = bdHourly ? fmt.format(bdHourly) : "–";
      $("#resBDLevel").textContent = `Stufe ${bdLevel}`;
      $("#resBDZuschl").textContent = [
        bdNightPlus ? `Nacht: ${fmt.format(bdNightPlus)}` : null,
        bdHolPlus ? `Feiertag: ${fmt.format(bdHolPlus)}` : null,
        bdPlus97 ? `≥97 h: ${fmt.format(bdPlus97)}` : null
      ].filter(Boolean).join(" · ") || "–";

      $("#resRB").textContent = fmt.format(rbEuroSum);
      $("#resRBHoursEq").textContent = `${rbHoursEqSum.toFixed(2).replace(".", ",")} h`;
      $("#resRBTaxfree").textContent = rbTaxfreeSum ? fmt.format(rbTaxfreeSum) : "–";

      $("#resSchichtZul").textContent = schichtZulMonat ? fmt.format(schichtZulMonat) : "–";
      $("#resWsNacht").textContent = wsNachtSum ? `${fmt.format(wsNachtEur)} / h → ${fmt.format(wsNachtSum)}` : "–";
      $("#resPara11Sum").textContent = para11Sum ? fmt.format(para11Sum) : "–";

      $("#resShift").textContent = fmt.format(schichtZulMonat + para11Sum);
      $("#resTotal").textContent = fmt.format(total);

      // celebratory animation if total crosses a threshold
      if (VENDOR.gsap && total > 20000) {
        VENDOR.gsap.to("#resTotal", { scale: 1.06, yoyo: true, repeat: 1, duration: 0.12, ease: "power1.inOut" });
      }
    };

    on($("#btnCalc"), "click", () => {
      calc();
      notifier.success("Berechnung aktualisiert.");
    });

    // Auto-calc initially
    calc();

    animateIn(el);
  };

  /*****************************************************************
   * Compare Renderer
   *****************************************************************/
  const ViewCompare = async () => {
    const el = $("#viewOutlet");
    const tracks = State.data?.tracks || [];

    const selected = tracks.filter(t => State.selectedCompare.has(t.slug || t.id));
    if (!selected.length) {
      el.innerHTML = `
        <section class="fade-in">
          <p class="muted">Noch keine Elemente im Vergleich. Füge Karrierepfade im Reiter „Pfad-Explorer“ hinzu.</p>
        </section>
      `;
      return;
    }

    el.innerHTML = `
      <section class="fade-in">
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
        <canvas id="cmpChart" aria-label="Vergleichschart" role="img"></canvas>
      </section>
    `;

    const body = $("#cmpBody");
    body.innerHTML = selected.map(t => {
      // derive summary across positions
      const pos = t.positions || [];
      const min = Math.min(...pos.map(p => p.salary_min || Infinity));
      const max = Math.max(...pos.map(p => p.salary_max || 0));
      const model = (new Set(pos.map(p => p.model || ""))).values().next().value || (t.model || "n. a.");
      const hours = (new Set(pos.map(p => p.weekly_hours || ""))).values().next().value || (t.weekly_hours || "n. a.");
      const remote = (new Set(pos.map(p => p.remote || p.location || ""))).values().next().value || (t.location || "n. a.");
      const highlights = (t.badges || []).slice(0,3).join(", ");

      const span = (isFinite(min) && max > 0) ? `${fmt.format(min)} – ${fmt.format(max)}` : (t.compensation_note || "n. a.");
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

    // Radar chart (if chart.js)
    if (VENDOR.Chart) {
      const ctx = $("#cmpChart");
      const labels = ["Vergütung", "Planbarkeit", "Forschung/Lehre", "Technik/Innovation", "Führungsverantwortung", "Work-Life"];
      const datasets = selected.map((t, i) => {
        const m = t.metrics || { pay: 4, schedule: 3, research: 3, tech: 5, lead: 4, wl: 3 };
        return {
          label: t.title,
          data: [m.pay, m.schedule, m.research, m.tech, m.lead, m.wl],
          fill: true
        };
      });

      try {
        new VENDOR.Chart(ctx, {
          type: "radar",
          data: { labels, datasets },
          options: {
            responsive: true,
            plugins: { legend: { position: "top" } },
            scales: {
              r: { min: 0, max: 5, ticks: { stepSize: 1 } }
            }
          }
        });
      } catch (e) {
        console.warn("Chart error", e);
      }
    }

    animateIn(el);
  };

  /*****************************************************************
   * Sources Renderer
   *****************************************************************/
  const ViewSources = async () => {
    const el = $("#viewOutlet");
    const src = State.data?.sources || [];

    el.innerHTML = `
      <section class="fade-in">
        <div class="table-wrapper">
          <table class="table">
            <thead>
              <tr><th>Quelle</th><th>Beschreibung</th><th>Stand</th></tr>
            </thead>
            <tbody>
              ${src.map(s => `
                <tr>
                  <td><a href="${s.url}" target="_blank" rel="noopener">${s.label || s.url}</a></td>
                  <td>${s.note || ""}</td>
                  <td>${s.date || ""}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </section>
    `;
    animateIn(el);
  };

  /*****************************************************************
   * Bind Route Handlers
   *****************************************************************/
  Router.init();
  Router.register("overview", ViewOverview);
  Router.register("profile", ViewProfile);
  Router.register("tracks", ViewTracks);
  Router.register("calculator", ViewCalculator);
  Router.register("compare", ViewCompare);
  Router.register("sources", ViewSources);

  /*****************************************************************
   * Boot
   *****************************************************************/
  const boot = async () => {
    focusVisiblePolyfill();
    Theme.init();
    initHeroAnimation();

    const ok = await loadData();
    if (ok) notifier.success("Daten erfolgreich geladen.");
    await Router.render();

    // Tooltips
    if (VENDOR.tippy) {
      VENDOR.tippy("[title]", { delay: [300, 0], touch: ["hold", 500], allowHTML: false, arrow: true });
    }
  };

  // DOM ready
  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(boot, 0);
  } else {
    on(document, "DOMContentLoaded", boot);
  }

})();
