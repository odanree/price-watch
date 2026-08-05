(function () {
  const NS = self.PriceWatch;
  const url = location.href;
  const candidates = NS.adapters.filter((a) => {
    try { return a.canHandle(url, document); } catch { return false; }
  });
  if (!candidates.length) return;

  // Poll tabs open with active: false and Chrome throttles their JS, so SPA
  // hydration takes noticeably longer than interactive tabs. Give poll mode
  // a longer window; keep interactive snappy.
  const isPollMode = /pricewatch-poll=/.test(location.hash);
  const DEADLINE_MS = isPollMode ? 15000 : 8000;
  const start = Date.now();

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
      const finish = (r) => {
        if (done) return;
        done = true;
        if (obs) obs.disconnect();
        resolve(r);
      };
      const immediate = tryExtract();
      if (immediate) return finish(immediate);
      obs = new MutationObserver(() => {
        const r = tryExtract();
        if (r) finish(r);
        else if (Date.now() - start > DEADLINE_MS) finish(null);
      });
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => finish(null), DEADLINE_MS);
    });
  }

  // Extract-only mode: opened by the background poll loop. Push result back
  // and skip UI. Tab is closed by the background after the message arrives.
  const pollMatch = location.hash.match(/pricewatch-poll=([a-f0-9]+)/);
  if (pollMatch) {
    const itemId = pollMatch[1];
    waitForExtract().then((r) => {
      console.log("[price-watch] poll-result", itemId, r?.scraped?.priceCents);
      chrome.runtime.sendMessage({
        type: "poll-result",
        itemId,
        vendor: r?.adapter?.vendor,
        scraped: r?.scraped || null
      });
    });
    return;
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
