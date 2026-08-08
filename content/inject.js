(async function () {
  const NS = self.PriceWatch;
  const url = location.href;
  const candidates = NS.adapters.filter((a) => {
    try { return a.canHandle(url, document); } catch { return false; }
  });
  if (!candidates.length) return;

  // Ask the background whether this tab was opened by the poll loop. Doing
  // this via message (rather than a URL marker) survives redirects that
  // strip hash fragments (Amazon does this on some PDPs).
  let isPollMode = false;
  let pollItemId = null;
  await new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "am-i-polling" }, (res) => {
        if (chrome.runtime.lastError) return resolve();
        if (res?.itemId) { isPollMode = true; pollItemId = res.itemId; }
        resolve();
      });
    } catch { resolve(); }
  });
  const DEADLINE_MS = isPollMode ? 25000 : 8000;
  const start = Date.now();

  // React SPAs like Best Buy defer rendering when document.visibilityState is
  // 'hidden'. Poll tabs are always hidden, so their deferred effects never fire
  // and elements like .primary-image never enter the DOM. Spoof visibility and
  // fire a scroll to nudge IntersectionObserver-based lazy loaders.
  if (isPollMode) {
    try {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      Object.defineProperty(document, "hidden", { value: false, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    } catch { /* property already non-configurable — best-effort */ }
    setTimeout(() => {
      try {
        window.scrollTo(0, 500);
        document.dispatchEvent(new Event("scroll", { bubbles: true }));
        window.dispatchEvent(new Event("resize"));
      } catch { /* ignore */ }
    }, 300);
  }

  function tryExtract() {
    for (const a of candidates) {
      let scraped = null;
      try { scraped = a.extract(document); } catch (e) {
        console.warn("[price-watch] adapter threw", a.vendor, e);
      }
      if (scraped?.priceCents && scraped?.title) return { adapter: a, scraped };
    }
    return null;
  }

  function waitForExtract() {
    return new Promise((resolve) => {
      let done = false;
      let obs = null;
      // Best-result-so-far: keep the earliest imageless success as a fallback,
      // but keep observing so we upgrade to an imageful result if hydration
      // produces one before deadline. This handles vendors like Best Buy that
      // server-render JSON-LD title+price but hydrate .primary-image late.
      let best = null;
      const finish = (r) => {
        if (done) return;
        done = true;
        if (obs) obs.disconnect();
        resolve(r);
      };
      const consider = (r) => {
        if (!r) return false;
        if (r.scraped?.imageUrl) { finish(r); return true; }
        if (!best) best = r;
        return false;
      };
      if (consider(tryExtract())) return;
      obs = new MutationObserver(() => {
        if (consider(tryExtract())) return;
        if (Date.now() - start > DEADLINE_MS) finish(best);
      });
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => finish(best), DEADLINE_MS);
    });
  }

  // Extract-only mode: opened by the background poll loop. Push result back
  // and skip UI. Tab is closed by the background after the message arrives.
  if (isPollMode) {
    const itemId = pollItemId;
    // Fire-and-forget ping so the SW knows inject.js reached this point on this tab.
    // If we see poll-started but no poll-result later, extraction hung; if we see
    // neither, inject.js never ran (Amazon anti-bot, redirect, or CSP block).
    try {
      chrome.runtime.sendMessage({
        type: "poll-started",
        itemId,
        url: location.href.slice(0, 120),
        candidateCount: candidates.length,
        candidateVendors: candidates.map((a) => a.vendor)
      });
    } catch { /* ignore */ }
    const imagePathDiagnostic = (r) => imageDiag(r);
    const pricePathDiagnostic = (r) => priceDiag(r);
    waitForExtract().then((r) => {
      console.log("[price-watch] poll-result", itemId, r?.scraped?.priceCents);
      let diagnostic = null;
      try {
        if (!r?.scraped?.priceCents) {
          diagnostic = { reason: "no_price", ...pricePathDiagnostic(r) };
        } else if (!r.scraped.imageUrl) {
          diagnostic = { reason: "no_image", ...imagePathDiagnostic(r) };
        }
      } catch (e) {
        diagnostic = { reason: "diagnostic_error", error: String(e), stack: String(e.stack).slice(0, 300) };
      }
      chrome.runtime.sendMessage({
        type: "poll-result",
        itemId,
        vendor: r?.adapter?.vendor,
        scraped: r?.scraped || null,
        diagnostic
      });
    }).catch((e) => {
      // waitForExtract itself failed — the poll tab is unusable. Report anyway
      // so the SW isn't stuck waiting for a message that never comes.
      chrome.runtime.sendMessage({
        type: "poll-result",
        itemId,
        vendor: null,
        scraped: null,
        diagnostic: { reason: "waitForExtract_threw", error: String(e), url: location.href }
      });
    });
    return;

    function imageDiag(r) {
      const primary = document.querySelector(".primary-image");
      return {
        url: location.href,
        adapterMatched: r?.adapter?.vendor,
        primarySrc: primary?.src,
        primaryDataSrc: primary?.dataset?.src,
        primarySrcset: primary?.srcset,
        primaryExists: !!primary,
        primaryOuter: primary?.outerHTML?.slice(0, 200),
        metaOg: document.querySelector("meta[property='og:image']")?.content,
        bigImgs: [...document.querySelectorAll("img")]
          .filter((i) => (i.naturalWidth || 0) > 200)
          .slice(0, 3)
          .map((i) => ({ src: i.src.slice(0, 100), cls: i.className.slice(0, 80) }))
      };
    }

    function priceDiag(r) {
      const body = document.body.textContent || "";
      return {
        url: location.href,
        adapterMatched: r?.adapter?.vendor || "none",
        title: document.querySelector("#productTitle, #title, main h1")?.textContent?.trim()?.slice(0, 80),
        // Amazon-specific price containers
        apexPricetoPay: document.querySelector(".apex-pricetopay-value")?.textContent?.slice(0, 60),
        apexAccessibility: document.querySelector(".apex-pricetopay-accessibility-label")?.textContent?.slice(0, 60),
        reinventMargin: document.querySelector(".reinventPricePriceToPayMargin")?.textContent?.slice(0, 60),
        aOffscreen: document.querySelector(".a-price .a-offscreen")?.textContent?.slice(0, 60),
        corePriceDisplay: !!document.querySelector("#corePriceDisplay_desktop_feature_div"),
        buyboxPrice: document.querySelector("#buybox .a-price .a-offscreen")?.textContent?.slice(0, 60),
        // JSON-LD availability
        jsonLdCount: document.querySelectorAll('script[type="application/ld+json"]').length,
        // Generic "any element with 'price' in class + a $-value" — the fishing-net fallback
        priceLike: [...document.querySelectorAll('[class*="price" i]')]
          .filter((el) => /\$\d/.test(el.textContent))
          .slice(0, 5)
          .map((el) => ({
            cls: el.className.slice(0, 80),
            text: el.textContent.trim().replace(/\s+/g, " ").slice(0, 50)
          })),
        // Bot-check / redirect indicators
        isBotCheck: /Type the characters|Enter the characters|Sorry.{0,20}robot|automated queries/i.test(body.slice(0, 5000)),
        // Sometimes Amazon shows "Currently unavailable" instead of a price
        currentlyUnavailable: /Currently unavailable/i.test(body.slice(0, 5000))
      };
    }
  }

  // Normal mode: mount the Track button once extraction succeeds.
  waitForExtract().then((r) => {
    if (!r) {
      console.warn("[price-watch] no price extracted", {
        url,
        tried: candidates.map((a) => a.vendor),
        hint: "Open devtools → Elements, find the price node, and paste its selector so the adapter can be updated."
      });
      return;
    }
    mount(r.adapter, r.scraped);
  });

  function mount(adapter, scraped) {
    const btn = document.createElement("button");
    btn.textContent = "📌 Track price";
    Object.assign(btn.style, {
      position: "fixed",
      right: "16px",
      bottom: "16px",
      zIndex: 2147483647,
      padding: "10px 14px",
      borderRadius: "8px",
      border: "none",
      background: "#111",
      color: "#fff",
      fontSize: "14px",
      fontFamily: "system-ui, sans-serif",
      cursor: "pointer",
      boxShadow: "0 4px 12px rgba(0,0,0,.25)"
    });
    btn.addEventListener("click", () => {
      console.log("[price-watch] click → sending track", { vendor: adapter.vendor, scraped });
      try {
        chrome.runtime.sendMessage(
          {
            type: "track",
            vendor: adapter.vendor,
            scraped,
            url: scraped.canonicalUrl || location.href
          },
          (res) => {
            if (chrome.runtime.lastError) {
              console.error("[price-watch] sendMessage lastError", chrome.runtime.lastError.message);
              btn.textContent = "⚠ Failed";
            } else {
              console.log("[price-watch] track response", res);
              btn.textContent = res?.ok ? "✓ Tracking" : "⚠ Failed";
            }
            setTimeout(() => btn.remove(), 1500);
          }
        );
      } catch (e) {
        console.error("[price-watch] sendMessage threw", e);
        btn.textContent = "⚠ Failed";
      }
    });
    document.body.appendChild(btn);
    console.log("[price-watch] mounted", { vendor: adapter.vendor, title: scraped.title });
  }
})();
