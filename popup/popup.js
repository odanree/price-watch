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
