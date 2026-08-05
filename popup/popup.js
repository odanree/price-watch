const STORAGE_KEY = "items";

async function render() {
  const { [STORAGE_KEY]: items = {} } = await chrome.storage.local.get(STORAGE_KEY);
  const list = document.getElementById("items");
  list.innerHTML = "";
  const rows = Object.values(items);
  if (!rows.length) {
    list.innerHTML =
      '<li class="empty">No items tracked yet. Visit a product page and click 📌.</li>';
    return;
  }

  // Derived-key clustering: group by (brand + model-code) so the same product
  // across vendors sits together. Groups sorted by biggest drop within them,
  // items within a group sorted by price ascending (cheapest offer first).
  const groups = new Map();
  for (const it of rows) {
    const key = productKey(it.title);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  for (const g of groups.values()) g.sort((a, b) => a.lastPriceCents - b.lastPriceCents);
  const ordered = [...groups.values()].sort((a, b) => {
    const bestA = Math.max(...a.map(dropPct));
    const bestB = Math.max(...b.map(dropPct));
    return bestB - bestA;
  });

  const tpl = document.getElementById("item-template");
  for (const group of ordered) {
    let first = true;
    for (const it of group) {
      const node = tpl.content.cloneNode(true);
      const li = node.querySelector(".item");
      if (first && list.children.length > 0) li.classList.add("group-start");
      first = false;
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
}

function dropPct(it) {
  return ((it.baselinePriceCents - it.lastPriceCents) / it.baselinePriceCents) * 100;
}

// Derive a stable group key from a title so the same product across vendors
// clusters together. Heuristic: brand (first token) + first "model-code"-looking
// token (1-4 letters followed by digits, optionally trailing letter suffix).
// This is a best-effort tokenizer — expect ~80% correct on retail titles.
const MODEL_NOISE = new Set([
  "gen1", "gen2", "gen3", "gen4", "gen5",
  "v1", "v2", "v3", "v4", "v5",
  "4k", "5k", "8k", "1080p", "720p", "2160p"
]);
function productKey(title) {
  if (!title) return "unknown";
  const tokens = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const brand = tokens[0] || "unknown";
  const model = tokens.find(
    (t) => /^[a-z]{1,4}\d+[a-z]?$/.test(t) && !MODEL_NOISE.has(t)
  );
  return model ? `${brand}-${model}` : brand;
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
