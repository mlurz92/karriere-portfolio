/* ==========================================================================
   File: js/vendor.js (REVISION)
   Rolle: Senior UX/Frontend-Architekt · Vendor-Bootstrap & Progressive Enhancements
   Ziel:
   - Robustes, idempotentes Laden externer Bibliotheken (CDN ohne integrity)
   - Fortschrittsanzeige via CSS Var --loader-progress (Top-Loader)
   - Sanfte Initialisierung: App funktioniert auch ohne Vendor-Libs
   - Einheitliche globale Exporte: window.VENDOR, window.vendorReady
   Hinweise:
   - index.html setzt window.__CDN__ (optional). Hier definierte Defaults & Fallbacks greifen sonst.
   - app.js nutzt window.vendorReady für „after-vendor“-Hooks.
   ========================================================================== */

(() => {
  "use strict";

  /* --------------------------------------------------------------
   * 0) Utilities
   * -------------------------------------------------------------- */
  const d = document;
  const w = window;
  const root = d.documentElement;

  /** Dedup-Registry für bereits geladene Ressourcen */
  const REG = new Map(); // url -> Promise<void>

  /** Setzt visuelle Fortschrittsanzeige der Top-Bar */
  const setProgress = (pct) => {
    const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
    root.style.setProperty("--loader-progress", clamped + "%");
  };

  /** CSS Loader mit De-Duplizierung */
  const loadCSS = (href) => {
    if (!href) return Promise.resolve();
    if (REG.has(href)) return REG.get(href);
    const p = new Promise((resolve, reject) => {
      const link = d.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.onload = () => resolve();
      link.onerror = () => reject(new Error(`CSS load failed: ${href}`));
      d.head.appendChild(link);
    });
    REG.set(href, p);
    return p;
  };

  /** JS Loader mit De-Duplizierung */
  const loadScript = (src) => {
    if (!src) return Promise.resolve();
    if (REG.has(src)) return REG.get(src);
    const p = new Promise((resolve, reject) => {
      const s = d.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Script load failed: ${src}`));
      d.head.appendChild(s);
    });
    REG.set(src, p);
    return p;
  };

  /** Probiert eine Liste an URLs in Reihenfolge – gibt bei Erfolg zurück, sonst wirft */
  const loadFirstAvailable = async (urls = []) => {
    let lastErr;
    for (const url of urls) {
      try { await loadScript(url); return url; } // success: exit
      catch (e) { lastErr = e; /* try next */ }
    }
    throw lastErr || new Error("No URL succeeded.");
  };

  /** Kleines Helper-Promise für nächste AnimationFrame */
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

  /* --------------------------------------------------------------
   * 1) CDN Registry (Defaults + optionale Überschreibungen aus window.__CDN__)
   * -------------------------------------------------------------- */
  const CDN = Object.assign({
    // Animation (GSAP Core & ScrollTrigger)
    gsap:       "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js",
    gsapScroll: "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js",

    // Lottie
    lottie:     "https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js",

    // Tooltips (Bundle inkl. Popper)
    tippyCore:  "https://unpkg.com/tippy.js@6/dist/tippy-bundle.umd.min.js",

    // SVG Stroke Animation
    vivus:      "https://cdnjs.cloudflare.com/ajax/libs/vivus/0.4.6/vivus.min.js",

    // Carousel
    splideJS:   "https://cdn.jsdelivr.net/npm/@splidejs/splide@4.1.4/dist/js/splide.min.js",
    splideCSS:  "https://cdn.jsdelivr.net/npm/@splidejs/splide@4.1.4/dist/css/splide.min.css",

    // Notifications
    notyfJS:    "https://cdn.jsdelivr.net/npm/notyf@3/notyf.min.js",
    notyfCSS:   "https://cdn.jsdelivr.net/npm/notyf@3/notyf.min.css",

    // Fuzzy Search
    fuse:       "https://cdn.jsdelivr.net/npm/fuse.js@6.6.2/dist/fuse.min.js",

    // Charts
    chart:      "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js",
  }, w.__CDN__ || {});

  /** Fallback-Kandidaten je Bibliothek */
  const FB = {
    gsap: [
      CDN.gsap,
      "https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js",
      "https://unpkg.com/gsap@3.12.5/dist/gsap.min.js"
    ],
    gsapScroll: [
      CDN.gsapScroll,
      "https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js",
      "https://unpkg.com/gsap@3.12.5/dist/ScrollTrigger.min.js"
    ],
    lottie: [
      CDN.lottie,
      "https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/build/player/lottie.min.js",
      "https://unpkg.com/lottie-web@5.12.2/build/player/lottie.min.js"
    ],
    tippyCore: [
      CDN.tippyCore,
      "https://cdn.jsdelivr.net/npm/tippy.js@6/dist/tippy-bundle.umd.min.js",
      "https://unpkg.com/tippy.js@6/dist/tippy-bundle.umd.min.js"
    ],
    vivus: [
      CDN.vivus,
      "https://cdn.jsdelivr.net/npm/vivus@0.4.6/dist/vivus.min.js",
      "https://unpkg.com/vivus@0.4.6/dist/vivus.min.js"
    ],
    splideJS: [
      CDN.splideJS,
      "https://unpkg.com/@splidejs/splide@4.1.4/dist/js/splide.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/Splide/4.1.4/js/splide.min.js"
    ],
    notyfJS: [
      CDN.notyfJS,
      "https://cdn.jsdelivr.net/npm/notyf@3.10.0/notyf.min.js",
      "https://unpkg.com/notyf@3/dist/notyf.min.js"
    ],
    fuse: [
      CDN.fuse,
      "https://unpkg.com/fuse.js@6.6.2/dist/fuse.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/fuse.js/6.6.2/fuse.min.js"
    ],
    chart: [
      CDN.chart,
      "https://unpkg.com/chart.js@4.4.1/dist/chart.umd.min.js",
      "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"
    ],
  };

  /* --------------------------------------------------------------
   * 2) Progressive Loader-Flow
   * -------------------------------------------------------------- */
  setProgress(6);

  // CSS-Abhängigkeiten vorladen (nicht-blockierend)
  const cssLoads = Promise.all([
    loadCSS(CDN.splideCSS),
    loadCSS(CDN.notyfCSS),
  ]).catch(() => {/* CSS-Fehler sind nicht kritisch */});

  setProgress(14);

  /* --------------------------------------------------------------
   * 3) Global Vendor Exports (werden später gefüllt)
   * -------------------------------------------------------------- */
  const VENDOR = {
    gsap: null,
    ScrollTrigger: null,
    lottie: null,
    tippy: null,
    Vivus: null,
    Splide: null,
    Notyf: null,
    Fuse: null,
    Chart: null,
  };
  // Exponiere Platzhalter direkt – app.js darf sofort referenzieren (mit Guards)
  w.VENDOR = VENDOR;

  /* --------------------------------------------------------------
   * 4) Vendor-Ladefolge
   * -------------------------------------------------------------- */
  const loadVendors = async () => {
    try {
      // GSAP Core
      await loadFirstAvailable(FB.gsap);
      VENDOR.gsap = w.gsap || null;
      setProgress(32);

      // ScrollTrigger (optional)
      try {
        await loadFirstAvailable(FB.gsapScroll);
        VENDOR.ScrollTrigger = w.ScrollTrigger || null;
        if (VENDOR.gsap && VENDOR.ScrollTrigger) VENDOR.gsap.registerPlugin(VENDOR.ScrollTrigger);
      } catch { /* optional */ }
      setProgress(40);

      // Lottie (optional)
      try {
        await loadFirstAvailable(FB.lottie);
        VENDOR.lottie = w.lottie || null;
      } catch { /* optional */ }
      setProgress(46);

      // Tippy (Tooltips – optional)
      try {
        await loadFirstAvailable(FB.tippyCore);
        VENDOR.tippy = w.tippy || null;
      } catch { /* optional */ }
      setProgress(52);

      // Vivus (SVG stroke – optional)
      try {
        await loadFirstAvailable(FB.vivus);
        VENDOR.Vivus = w.Vivus || null;
      } catch { /* optional */ }
      setProgress(58);

      // Splide (Carousel – optional)
      try {
        await loadFirstAvailable(FB.splideJS);
        VENDOR.Splide = w.Splide || null;
      } catch { /* optional */ }
      setProgress(64);

      // Notyf (Toasts – optional)
      try {
        await loadFirstAvailable(FB.notyfJS);
        VENDOR.Notyf = w.Notyf || null;
      } catch { /* optional */ }
      setProgress(70);

      // Fuse (Fuzzy search – optional)
      try {
        await loadFirstAvailable(FB.fuse);
        VENDOR.Fuse = w.Fuse || null;
      } catch { /* optional */ }
      setProgress(78);

      // Chart.js (optional)
      try {
        await loadFirstAvailable(FB.chart);
        VENDOR.Chart = w.Chart || null;
      } catch { /* optional */ }
      setProgress(84);

      // CSS warten, sanfte UI-Marken setzen
      await cssLoads;
      await nextFrame();

      // Body als „ready“ markieren (für Logo-Stroke & Fade-ins)
      d.body && d.body.classList.add("ready");

      // Carousels (idempotente Initialisierung)
      mountCarousels();

      // Tooltips global (idempotent)
      if (VENDOR.tippy) {
        try {
          VENDOR.tippy("[title]", { delay: [250, 0], arrow: true, allowHTML: false, placement: "top" });
        } catch {/* no-op */}
      }

      setProgress(100);
      // sanft zurücksetzen
      setTimeout(() => setProgress(0), 900);

      // Globale Ready-Promise zur Synchronisation
      w.vendorReady = Promise.resolve(true);

      // Diagnose-Banner
      bannerInfo();
    } catch (err) {
      console.warn("[vendor] Ladefehler:", err);
      setProgress(92);
      w.vendorReady = Promise.resolve(false);
      bannerInfo(true);
    }
  };

  /* --------------------------------------------------------------
   * 5) Carousels idempotent mounten
   * -------------------------------------------------------------- */
  const mountCarousels = () => {
    if (!VENDOR.Splide) return;
    const nodes = d.querySelectorAll(".splide");
    nodes.forEach((el) => {
      try {
        // Mehrfach-Mount verhindern
        if (el.__splideMounted) return;
        const splide = new VENDOR.Splide(el, {
          arrows: true,
          pagination: true,
          gap: "1rem",
          autoplay: false,
          type: "loop",
          perPage: 3,
          breakpoints: { 1140: { perPage: 2 }, 820: { perPage: 1 } }
        });
        splide.mount();
        el.__splideMounted = true;
      } catch (e) {
        // single-element Fehler ignorieren
      }
    });
  };
  // Exponiere Re-Mounter für dynamisch eingefügte Carousels
  w.mountCarousels = mountCarousels;

  /* --------------------------------------------------------------
   * 6) Kleines Dialog-Fallback (wenn <dialog> fehlen sollte)
   *    – app.js nutzt <dialog class="modal"> in den Track-Details.
   * -------------------------------------------------------------- */
  const ensureDialogSupport = () => {
    if ("HTMLDialogElement" in w) return; // native support
    // Minimal-Fallback: interpretiere <dialog> wie <div>, emuliere showModal/close
    const proto = HTMLElement.prototype;
    const dialogs = d.querySelectorAll("dialog.modal");
    dialogs.forEach((dlg) => {
      if (dlg.__polyfilled) return;
      dlg.__polyfilled = true;
      dlg.setAttribute("hidden", "");
      dlg.showModal = function () {
        this.removeAttribute("hidden");
        d.body.style.overflow = "hidden";
      };
      dlg.close = function () {
        this.setAttribute("hidden", "");
        d.body.style.overflow = "";
      };
    });
  };

  /* --------------------------------------------------------------
   * 7) Globale Usability-Hooks (klein & robust)
   *    – Command Palette Öffner (⌘K/CTRL+K) belasse ich hier schlank.
   *      Detail-Logic steuert app.js.
   * -------------------------------------------------------------- */
  const globalUX = () => {
    const onKey = (ev) => {
      const k = ev.key?.toLowerCase();
      if (!k) return;
      const meta = ev.metaKey || ev.ctrlKey;
      if (meta && k === "k") {
        ev.preventDefault();
        const dlg = d.getElementById("cmdk-dialog");
        if (!dlg) return;
        if (dlg.hasAttribute("hidden")) dlg.removeAttribute("hidden");
        const input = d.getElementById("cmdk-input");
        input?.focus?.();
      }
      if (k === "escape") {
        const dlg = d.getElementById("cmdk-dialog");
        if (dlg && !dlg.hasAttribute("hidden")) dlg.setAttribute("hidden", "");
      }
    };
    d.addEventListener("keydown", onKey, { passive: false });

    // Click-outside für Palette
    d.addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (target.matches("[data-dismiss]")) {
        const dlg = d.getElementById("cmdk-dialog");
        dlg?.setAttribute("hidden", "");
      }
    }, { passive: true });

    // Mobile Menu Toggle (IDs laut index.html)
    const menuBtn = d.getElementById("menu-toggle");
    const mobileNav = d.getElementById("mobile-nav");
    if (menuBtn && mobileNav) {
      menuBtn.addEventListener("click", () => {
        const open = !mobileNav.classList.contains("hidden");
        if (open) {
          mobileNav.classList.add("hidden");
          menuBtn.setAttribute("aria-expanded", "false");
        } else {
          mobileNav.classList.remove("hidden");
          menuBtn.setAttribute("aria-expanded", "true");
        }
      }, { passive: true });

      // Auto-close mobile nav bei Navigation
      mobileNav.addEventListener("click", (e) => {
        const a = e.target.closest("a[data-nav]");
        if (!a) return;
        mobileNav.classList.add("hidden");
        menuBtn.setAttribute("aria-expanded", "false");
      }, { passive: true });
    }

    // Theme Toggle (setzt data-theme auf <html>)
    const themeBtn = d.getElementById("theme-toggle");
    if (themeBtn) {
      const getCurrent = () => d.documentElement.getAttribute("data-theme") || "auto";
      const cycle = () => {
        const cur = getCurrent();
        const next = cur === "auto" ? "dark" : (cur === "dark" ? "light" : "auto");
        d.documentElement.setAttribute("data-theme", next);
        // persist
        try { localStorage.setItem("theme", next); } catch {/* no-op */}
        themeBtn.setAttribute("aria-pressed", String(next !== "auto"));
        // Kleinere Feedback-Animation
        if (VENDOR.gsap) {
          VENDOR.gsap.fromTo(themeBtn, { rotate: -10, scale: 0.96 }, { rotate: 0, scale: 1, duration: .25, ease: "power2.out" });
        }
      };
      // initial from storage
      try {
        const saved = localStorage.getItem("theme");
        if (saved) d.documentElement.setAttribute("data-theme", saved);
      } catch {/* ignore */}
      themeBtn.addEventListener("click", cycle, { passive: true });
    }
  };

  /* --------------------------------------------------------------
   * 8) Diagnose-Banner
   * -------------------------------------------------------------- */
  const bannerInfo = (failed = false) => {
    const msg = failed
      ? "%c Vendor Loader – teilweiser Fallback aktiv "
      : "%c Vendor Loader – alle Kernlibs geladen ";
    const style = failed
      ? "background: linear-gradient(90deg,#F59E0B,#EF4444); color:#fff; padding:4px 8px; border-radius:6px; font-weight:700;"
      : "background: linear-gradient(90deg,#0A98D6,#7DD3FC); color:#fff; padding:4px 8px; border-radius:6px; font-weight:700;";
    try { console.info(msg, style); } catch { /* ignore */ }
  };

  /* --------------------------------------------------------------
   * 9) Boot
   * -------------------------------------------------------------- */
  const boot = async () => {
    ensureDialogSupport();
    globalUX();
    await loadVendors();
  };

  if (d.readyState === "complete" || d.readyState === "interactive") {
    boot();
  } else {
    d.addEventListener("DOMContentLoaded", boot, { once: true, passive: true });
  }
})();
