/* ==========================================================================
   File: js/vendor.js
   Rolle: Frontend-Platform Engineer · Loader/Bootstrap für Vendor-Bibliotheken
   Zweck:
   - Lädt und initialisiert alle externen Bibliotheken (CDN, ohne integrity)
   - Garantiert robuste, idempotente Initialisierung mit Fallback-CDNs
   - Stellt globale Verfügbarkeit sicher (window.*), damit app.js optional enhancen kann
   - Visuelles Fortschrittsfeedback über den Top-Loader (CSS-Var --loader-progress)
   Kompatibilität:
   - Funktioniert „best effort“: Bei Ladefehlern fährt die App mit Basis-Funktionen fort.
   ========================================================================== */

(() => {
  "use strict";

  /* --------------------------------------------------------------
   * 0) Utilities
   * -------------------------------------------------------------- */
  const d = document;
  const w = window;
  const root = d.documentElement;

  // Simple once-only registry to avoid duplicate loads
  const REG = new Map(); // url -> Promise

  const setProgress = (pct) => {
    const clamped = Math.max(0, Math.min(100, pct));
    root.style.setProperty("--loader-progress", clamped + "%");
  };

  const loadCSS = (href) => {
    if (!href) return Promise.resolve();
    // de-dupe by href
    if (REG.has(href)) return REG.get(href);
    const p = new Promise((resolve, reject) => {
      const link = d.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.onload = () => resolve(href);
      link.onerror = (e) => reject(new Error(`CSS load failed: ${href}`));
      d.head.appendChild(link);
    });
    REG.set(href, p);
    return p;
  };

  const loadScript = (src) => {
    if (!src) return Promise.resolve();
    if (REG.has(src)) return REG.get(src);
    const p = new Promise((resolve, reject) => {
      const s = d.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve(src);
      s.onerror = () => reject(new Error(`Script load failed: ${src}`));
      d.head.appendChild(s);
    });
    REG.set(src, p);
    return p;
  };

  // Try multiple sources in sequence (first wins)
  const loadFirstAvailable = async (urls = []) => {
    let lastErr;
    for (const url of urls) {
      try { await loadScript(url); return url; }
      catch (e) { lastErr = e; /* try next */ }
    }
    if (lastErr) throw lastErr;
  };

  // Small helper to wait a frame
  const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));

  /* --------------------------------------------------------------
   * 1) CDN Registry (with sane defaults and fallbacks)
   *    index.html kann window.__CDN__ bereitstellen; hier werden
   *    fehlende Einträge ergänzt.
   * -------------------------------------------------------------- */
  const CDN = Object.assign({
    // Animation
    gsap: "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js",
    gsapScroll: "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js",

    // Lottie
    lottie: "https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js",

    // Tooltips (Bundle enthält Popper)
    tippyCore: "https://unpkg.com/tippy.js@6/dist/tippy-bundle.umd.min.js",

    // SVG stroke animation
    vivus: "https://cdnjs.cloudflare.com/ajax/libs/vivus/0.4.6/vivus.min.js",

    // Carousel
    splide: "https://cdn.jsdelivr.net/npm/@splidejs/splide@4.1.4/dist/js/splide.min.js",
    splideCSS: "https://cdn.jsdelivr.net/npm/@splidejs/splide@4.1.4/dist/css/splide.min.css",

    // Notifications
    notyfJS: "https://cdn.jsdelivr.net/npm/notyf@3/notyf.min.js",
    notyfCSS: "https://cdn.jsdelivr.net/npm/notyf@3/notyf.min.css",

    // Search
    fuse: "https://cdn.jsdelivr.net/npm/fuse.js@6.6.2/dist/fuse.min.js",

    // Charts
    chart: "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js",
  }, w.__CDN__ || {});

  // Fallback sets (if a primary fails)
  const FB = {
    gsap: [
      CDN.gsap,
      "https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js",
      "https://unpkg.com/gsap@3.12.5/dist/gsap.min.js",
    ],
    gsapScroll: [
      CDN.gsapScroll,
      "https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js",
      "https://unpkg.com/gsap@3.12.5/dist/ScrollTrigger.min.js",
    ],
    lottie: [
      CDN.lottie,
      "https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/build/player/lottie.min.js",
      "https://unpkg.com/lottie-web@5.12.2/build/player/lottie.min.js",
    ],
    tippyCore: [
      CDN.tippyCore,
      "https://cdn.jsdelivr.net/npm/tippy.js@6/dist/tippy-bundle.umd.min.js",
      "https://unpkg.com/tippy.js@6/dist/tippy-bundle.umd.min.js",
    ],
    vivus: [
      CDN.vivus,
      "https://cdn.jsdelivr.net/npm/vivus@0.4.6/dist/vivus.min.js",
      "https://unpkg.com/vivus@0.4.6/dist/vivus.min.js",
    ],
    splide: [
      CDN.splide,
      "https://unpkg.com/@splidejs/splide@4.1.4/dist/js/splide.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/Splide/4.1.4/js/splide.min.js",
    ],
    notyfJS: [
      CDN.notyfJS,
      "https://cdn.jsdelivr.net/npm/notyf@3.10.0/notyf.min.js",
      "https://unpkg.com/notyf@3/dist/notyf.min.js",
    ],
    fuse: [
      CDN.fuse,
      "https://unpkg.com/fuse.js@6.6.2/dist/fuse.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/fuse.js/6.6.2/fuse.min.js",
    ],
    chart: [
      CDN.chart,
      "https://unpkg.com/chart.js@4.4.1/dist/chart.umd.min.js",
      "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js",
    ],
  };

  /* --------------------------------------------------------------
   * 2) Progressive Top-Loader
   * -------------------------------------------------------------- */
  setProgress(8);

  /* --------------------------------------------------------------
   * 3) Load CSS dependencies first (non-blocking)
   * -------------------------------------------------------------- */
  const cssLoads = Promise.all([
    loadCSS(CDN.splideCSS),
    loadCSS(CDN.notyfCSS),
  ]).catch(() => {/* ignore CSS load errors */});

  setProgress(18);

  /* --------------------------------------------------------------
   * 4) Load JS libraries with sensible ordering
   * -------------------------------------------------------------- */
  const loadVendors = async () => {
    try {
      // Core animation (gsap)
      await loadFirstAvailable(FB.gsap);
      setProgress(35);

      // ScrollTrigger (optional plugin)
      try {
        await loadFirstAvailable(FB.gsapScroll);
        if (w.gsap && w.ScrollTrigger) w.gsap.registerPlugin(w.ScrollTrigger);
      } catch { /* optional */ }
      setProgress(45);

      // Lottie (optional)
      try { await loadFirstAvailable(FB.lottie); } catch { /* optional */ }
      setProgress(52);

      // Tippy bundle (includes Popper)
      try { await loadFirstAvailable(FB.tippyCore); } catch { /* optional */ }
      setProgress(58);

      // Vivus (optional)
      try { await loadFirstAvailable(FB.vivus); } catch { /* optional */ }
      setProgress(63);

      // Splide (carousel)
      try { await loadFirstAvailable(FB.splide); } catch { /* optional */ }
      setProgress(68);

      // Notyf (notifications)
      try { await loadFirstAvailable(FB.notyfJS); } catch { /* optional */ }
      setProgress(74);

      // Fuse (search)
      try { await loadFirstAvailable(FB.fuse); } catch { /* optional */ }
      setProgress(80);

      // Chart.js (compare radar)
      try { await loadFirstAvailable(FB.chart); } catch { /* optional */ }
      setProgress(86);

      // Give CSS time to apply, mark ready
      await cssLoads;
      await nextFrame();

      // Cosmetic: add .ready to body to trigger logo stroke animation
      d.body && d.body.classList.add("ready");

      // Initialize Splide carousels if present
      if (w.Splide) {
        const nodes = d.querySelectorAll(".splide");
        nodes.forEach((el) => {
          try {
            const splide = new w.Splide(el, {
              arrows: true,
              pagination: true,
              gap: "1rem",
              autoplay: false,
              type: "loop",
              perPage: 3,
              breakpoints: {
                1140: { perPage: 2 },
                820: { perPage: 1 },
              }
            });
            splide.mount();
          } catch (e) {
            /* ignore single mount errors */
          }
        });
      }

      // Optional: global tooltip init for elements with [data-tip] – app.js nutzt [title]
      if (w.tippy) {
        try {
          w.tippy("[data-tip]", { arrow: true, delay: [300, 0] });
        } catch { /* noop */ }
      }

      setProgress(100);
      // Smoothly hide the loader after a short delay (visual polish)
      setTimeout(() => setProgress(0), 900);

      // Expose a resolved readiness promise for app.js (if needed)
      w.vendorReady = Promise.resolve(true);
    } catch (err) {
      console.warn("[vendor] Ladefehler:", err);
      setProgress(92);
      w.vendorReady = Promise.resolve(false);
    }
  };

  /* --------------------------------------------------------------
   * 5) Boot sequence
   * -------------------------------------------------------------- */
  if (d.readyState === "complete" || d.readyState === "interactive") {
    loadVendors();
  } else {
    d.addEventListener("DOMContentLoaded", loadVendors, { once: true, passive: true });
  }

  /* --------------------------------------------------------------
   * 6) Diagnostics (dev-friendly console hints)
   * -------------------------------------------------------------- */
  const banner = [
    "%c Karriere-Portfolio · Vendor Loader ",
    "background: linear-gradient(90deg,#0A98D6,#7DD3FC); color:#fff; padding:4px 8px; border-radius:6px; font-weight:700;"
  ];
  try { console.info(...banner); } catch {}

})();
