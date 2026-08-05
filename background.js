// Classic service worker. Only lib/price.js is needed here now — all price
// extraction happens in real tabs via the content-script adapter registry.
importScripts("lib/price.js");

const NS = self.PriceWatch;
const STORAGE_KEY = "items";
const POLL_MINUTES = 60;
const DEFAULT_THRESHOLD_PCT = 5;
const POLL_BASE_SPACING_MS = 2000;
const POLL_JITTER_MS = 1000;   // jittered token-bucket rate limiter between polls
const POLL_TAB_TIMEOUT_MS = 20000; // how long we wait for a poll tab to report back

// In-flight poll tabs — itemId → { resolve, tabId, timer }
const pollWaiters = new Map();

chrome.runtime.onInstalled.addListener(async () => {
  chrome.alarms.create("poll", { periodInMinutes: POLL_MINUTES });
  // One-time migration: sync → local (sync silently fails when Chrome isn't signed in).
  try {
    const { [STORAGE_KEY]: legacy } = await chrome.storage.sync.get(STORAGE_KEY);
    const { [STORAGE_KEY]: current } = await chrome.storage.local.get(STORAGE_KEY);
    if (legacy && !current) {
      await chrome.storage.local.set({ [STORAGE_KEY]: legacy });
      console.log("[price-watch] migrated", Object.keys(legacy).length, "items sync → local");
    }
  } catch (e) { console.warn("[price-watch] migration skipped", e); }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "track") {
    console.log("[price-watch] track message received", { from: sender.tab?.url, vendor: msg.vendor });
    trackItem(msg)
      .then((item) => {
        console.log("[price-watch] saved", item.id, item.vendor, item.title);
        sendResponse({ ok: true, item });
      })
      .catch((err) => {
        console.error("[price-watch] trackItem threw", err);
        sendResponse({ ok: false, error: String(err) });
      });
    return true; // keep the message channel open for async response
  }
  if (msg?.type === "poll-result") {
    const waiter = pollWaiters.get(msg.itemId);
    if (waiter) {
      pollWaiters.delete(msg.itemId);
      clearTimeout(waiter.timer);
      waiter.resolve(msg);
    }
    sendResponse({ ok: true });
    return; // sync
  }
});

chrome.alarms.onAlarm.addListener(async ({ name }) => {
  if (name !== "poll") return;
  const items = Object.values(await loadAll());
  console.log("[price-watch] poll cycle starting for", items.length, "items");
  for (const item of items) {
    await pollItem(item);
    // Jittered token-bucket rate limiter — avoids bursts against any single vendor.
    await sleep(POLL_BASE_SPACING_MS + Math.floor(Math.random() * POLL_JITTER_MS));
  }
  console.log("[price-watch] poll cycle finished");
});

// Poll a single item by opening its URL as an inactive tab. The declarative
// content script auto-injects, runs the full adapter DOM path (with SPA-hydration
// retry), and pushes the result back via a `poll-result` message. We then
// close the tab. This is the only way to get post-hydration prices from vendors
// like Home Depot / Costco / Target where the raw HTML doesn't include them.
async function pollItem(item) {
  const sep = item.url.includes("#") ? "&" : "#";
  const pollUrl = `${item.url}${sep}pricewatch-poll=${item.id}`;
  let tabId = null;
  try {
    const tab = await chrome.tabs.create({ url: pollUrl, active: false });
    tabId = tab.id;
    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        pollWaiters.delete(item.id);
        resolve(null);
      }, POLL_TAB_TIMEOUT_MS);
      pollWaiters.set(item.id, { resolve, tabId, timer });
    });
    const cents = result?.scraped?.priceCents;
    if (cents) {
      await recordPrice(item.id, cents);
    } else {
      console.warn("[price-watch] poll got no price", item.title);
      await bumpParseFail(item.id);
    }
  } catch (e) {
    console.warn("[price-watch] pollItem failed", item.url, e);
    await bumpParseFail(item.id);
  } finally {
    if (tabId != null) {
      try { await chrome.tabs.remove(tabId); } catch { /* already closed */ }
    }
  }
}

// If a poll tab is closed by the user (or crashes) before the content script
// reports, unblock the waiter so the poll loop keeps moving.
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [itemId, waiter] of pollWaiters) {
    if (waiter.tabId === tabId) {
      pollWaiters.delete(itemId);
      clearTimeout(waiter.timer);
      waiter.resolve(null);
    }
  }
});

chrome.notifications.onClicked.addListener(async (id) => {
  const items = await loadAll();
  if (items[id]) chrome.tabs.create({ url: items[id].url });
});

function vendorFromHost(url) {
  try {
    const h = new URL(url).hostname;
    for (const v of ["amazon", "bestbuy", "target", "lowes", "homedepot", "costco"]) {
      if (h.endsWith(`${v}.com`)) return v;
    }
  } catch { /* ignore */ }
  return "generic";
}

async function trackItem({ vendor, scraped, url }) {
  const items = await loadAll();
  const id = await hash(scraped.canonicalUrl || url);
  const resolvedVendor = vendor === "generic" ? vendorFromHost(url) : vendor;
  items[id] = {
    id,
    vendor: resolvedVendor,
    title: scraped.title,
    url: scraped.canonicalUrl || url,
    imageUrl: scraped.imageUrl,
    baselinePriceCents: scraped.priceCents,
    lastPriceCents: scraped.priceCents,
    lowestPriceCents: scraped.priceCents,
    lastCheckedAt: Date.now(),
    history: [{ at: Date.now(), priceCents: scraped.priceCents }],
    alertThresholdPct: DEFAULT_THRESHOLD_PCT,
    parseFailCount: 0
  };
  await saveAll(items);
  return items[id];
}

async function recordPrice(id, priceCents) {
  const items = await loadAll();
  const cur = items[id];
  if (!cur) return;

  // Capture pre-mutation state so we can detect threshold-crossing and new-low transitions.
  const baseline = cur.baselinePriceCents;
  const threshold = cur.alertThresholdPct;
  const prevPrice = cur.lastPriceCents;
  const prevLow = cur.lowestPriceCents;
  const prevDropPct = ((baseline - prevPrice) / baseline) * 100;
  const dropPct = ((baseline - priceCents) / baseline) * 100;

  cur.lastPriceCents = priceCents;
  cur.lowestPriceCents = Math.min(prevLow, priceCents);
  cur.lastCheckedAt = Date.now();
  cur.parseFailCount = 0;
  cur.history = [...cur.history.slice(-49), { at: Date.now(), priceCents }];
  await saveAll(items);

  // Transition trigger: fire only when we newly cross the threshold OR set a new all-time low.
  // Prevents the notification storm from firing every poll while a drop is sustained.
  const crossedThreshold = prevDropPct < threshold && dropPct >= threshold;
  const newLow = priceCents < prevLow;
  if (crossedThreshold || newLow) {
    chrome.notifications.create(cur.id, {
      type: "basic",
      iconUrl: cur.imageUrl || "icon.png",
      title: `${newLow ? "★ new low" : "↓"} ${dropPct.toFixed(0)}% — ${cur.title}`,
      message: `Now ${NS.price.formatUSD(priceCents)} (was ${NS.price.formatUSD(baseline)})`,
      priority: 2
    });
  }
}

async function bumpParseFail(id) {
  const items = await loadAll();
  if (!items[id]) return;
  items[id].parseFailCount = (items[id].parseFailCount || 0) + 1;
  items[id].lastCheckedAt = Date.now();
  await saveAll(items);
}

async function loadAll() {
  const { [STORAGE_KEY]: items } = await chrome.storage.local.get(STORAGE_KEY);
  return items || {};
}

async function saveAll(items) {
  await chrome.storage.local.set({ [STORAGE_KEY]: items });
}

async function hash(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
