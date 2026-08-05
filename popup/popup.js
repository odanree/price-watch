const STORAGE_KEY = "items";

async function render() {
  const { [STORAGE_KEY]: items = {} } = await chrome.storage.local.get(STORAGE_KEY);
  const list = document.getElementById("items");
  list.innerHTML = "";
  const rows = Object.values(items).sort((a, b) => dropPct(b) - dropPct(a));
  if (!rows.length) {
    list.innerHTML =
      '<li class="empty">No items tracked yet. Visit a product page and click 📌.</li>';
    return;
  }
  const tpl = document.getElementById("item-template");
  for (const it of rows) {
    const node = tpl.content.cloneNode(true);
    const thumb = node.querySelector(".thumb");
    thumb.referrerPolicy = "no-referrer";
    thumb.src = it.imageUrl || "";
    thumb.addEventListener("error", () => { thumb.style.visibility = "hidden"; });
    const a = node.querySelector(".title");
    a.textContent = it.title;
    a.href = it.url;
    node.querySelector(".now").textContent = fmt(it.lastPriceCents);
    const pct = dropPct(it);
    const delta = node.querySelector(".delta");
    if (Math.abs(pct) < 0.5) {
      delta.textContent = "—";
    } else {
      delta.textContent = `${pct > 0 ? "↓" : "↑"} ${Math.abs(pct).toFixed(1)}%`;
      delta.classList.add(pct > 0 ? "down" : "up");
    }
    const spark = node.querySelector(".spark");
    spark.innerHTML = renderSparkline(it.history || [], it.baselinePriceCents);
    spark.title = sparkTooltip(it);
    node.querySelector(".vendor").textContent = it.vendor;
    const checked = node.querySelector(".checked");
    checked.textContent = it.parseFailCount
      ? `⚠ ${it.parseFailCount} parse misses`
      : timeAgo(it.lastCheckedAt);
    node.querySelector(".remove").addEventListener("click", async () => {
      const { [STORAGE_KEY]: all = {} } = await chrome.storage.local.get(STORAGE_KEY);
      delete all[it.id];
      await chrome.storage.local.set({ [STORAGE_KEY]: all });
      render();
    });
    list.appendChild(node);
  }
}

function dropPct(it) {
  return ((it.baselinePriceCents - it.lastPriceCents) / it.baselinePriceCents) * 100;
}

// Inline SVG polyline over the item's history[] samples. Dashed reference line
// at the tracked-at baseline; color reflects the current position relative to it.
function renderSparkline(history, baseline, w = 90, h = 30) {
  if (!history.length) return "";
  if (history.length === 1) {
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      <line x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}" stroke="#ccc" stroke-width="1"/>
      <circle cx="${w - 1}" cy="${h / 2}" r="2" fill="#666"/>
    </svg>`;
  }
  const prices = history.map((p) => p.priceCents);
  const min = Math.min(...prices, baseline);
  const max = Math.max(...prices, baseline);
  const range = max - min || 1;
  const scaleY = (c) => h - ((c - min) / range) * h;
  const points = history.map((p, i) => {
    const x = (i / (history.length - 1)) * w;
    return `${x.toFixed(1)},${scaleY(p.priceCents).toFixed(1)}`;
  }).join(" ");
  const last = history[history.length - 1].priceCents;
  const color = last < baseline ? "#0a7d2c" : last > baseline ? "#b00020" : "#666";
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <line x1="0" y1="${scaleY(baseline).toFixed(1)}" x2="${w}" y2="${scaleY(baseline).toFixed(1)}"
          stroke="#ddd" stroke-dasharray="2,2" stroke-width="1"/>
    <polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>
    <circle cx="${w - 1}" cy="${scaleY(last).toFixed(1)}" r="2" fill="${color}"/>
  </svg>`;
}

function sparkTooltip(it) {
  if (!it.history?.length) return "";
  const prices = it.history.map((p) => p.priceCents);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return `n=${it.history.length}  low=${fmt(min)}  high=${fmt(max)}  baseline=${fmt(it.baselinePriceCents)}`;
}

function fmt(c) {
  return "$" + (c / 100).toFixed(2);
}

function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

document.getElementById("poll-now").addEventListener("click", () => {
  chrome.alarms.create("poll", { when: Date.now() + 100 });
});

// Present on popup only; absent on list.html (uses same script otherwise).
document.getElementById("open-all")?.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("list/list.html") });
});

// Live-refresh on any write to items (e.g. Track from a tab while popup is open).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) render();
});

render();
