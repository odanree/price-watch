# Price Watch

Chrome MV3 extension that tracks product prices across Amazon, Best Buy, Target, Lowe's, Home Depot, and Costco. Click 📌 on a product page → the item lands in the popup watchlist → hourly polls detect drops → **transition-triggered notifications** fire only when a price crosses the alert threshold or sets a new all-time low.

## How it works

```
Product page (vendor)
      │
      ▼
Content script (inject.js) ───► adapter registry (self.PriceWatch.adapters)
      │                             │  canHandle(url, doc)?
      │                             ▼
      │                        Vendor adapter  ─or─  generic JSON-LD/og:price
      │                             │
      ▼                             ▼
📌 Track button click ──message──► background service worker
                                       │
                                       ▼
                             chrome.storage.local
                        {id, baseline, history, threshold}

  every 60 min (chrome.alarms):
      │
      ▼
  Poll loop opens each URL as an INACTIVE TAB
      │  content script re-runs, MutationObserver
      ▼  waits for SPA hydration, pushes result back
  recordPrice()
      │
      ├── crossed threshold OR new low → chrome.notifications
      └── otherwise silent
```

The **adapter pattern** is the load-bearing abstraction: one `canHandle + extract` module per vendor, registered on `self.PriceWatch.adapters`, consumed by both the on-page content script (for capture) and the poll-time invisible tab (for updates). The **generic JSON-LD / og:price adapter** is the fallback so unknown pages still get a shot; vendor identity is re-resolved from the hostname on save so fallback captures don't split into a separate `generic` row.

The **invisible-tab poll loop** exists because MV3 service workers can't `DOMParser` — a naive `fetch → regex` path finds nothing on React SPAs like Home Depot / Costco / Target where prices hydrate client-side. Opening each URL as an inactive tab gets us the post-hydration DOM at the cost of a brief tab-strip flash. Polls are spaced by a **jittered token-bucket rate limiter** (2s + 0–1000ms) so we don't burst any single vendor.

Notifications fire on **transition triggers only** — the first poll where a drop crosses the alert threshold, or one that sets a new all-time low. This suppresses the notification storm the naive `drop >= threshold` check would produce every hour a discount holds.

## Quick start

1. Clone the repo.
2. Chrome → `chrome://extensions` → toggle **Developer mode** (top-right).
3. **Load unpacked** → pick the repo root.
4. Visit a product page on a supported vendor → click **📌 Track price** (bottom-right).
5. Click the toolbar icon for the popup; ↻ triggers an immediate poll instead of waiting for the hourly alarm.

## Supported vendors

| Vendor | URL match | Primary extraction |
|---|---|---|
| Amazon | `/dp/`, `/gp/product/` | `.a-price .a-offscreen` |
| Best Buy | `/site/` | `.priceView-*` |
| Target | `/p/` | `[data-test='product-price']` |
| Lowe's | `/pd/` | `[itemprop='price']` + DOM |
| Home Depot | `/p/` | JSON-LD Product → DOM fallback |
| Costco | `/p/-/<slug>/<id>` or legacy `.product.<id>.html` | JSON-LD Product → DOM fallback |
| _anything_ | fallback | `schema.org/Product` JSON-LD → `og:price:amount` |

Adding a vendor: drop a file at [`content/adapters/<vendor>.js`](content/adapters/) that calls `NS.register({vendor, canHandle, extract})`, add the site to `manifest.json`'s `matches` + `host_permissions`, and reference the file in the manifest's `content_scripts.js` array.

## Config

Constants in [`background.js`](background.js) (no options UI yet):

| Constant | Default | Purpose |
|---|---|---|
| `POLL_MINUTES` | 60 | Poll interval per item |
| `DEFAULT_THRESHOLD_PCT` | 5 | Drop % that triggers a notification (per-item overridable via `items[id].alertThresholdPct`) |
| `POLL_BASE_SPACING_MS` | 2000 | Base delay between poll-tab launches |
| `POLL_JITTER_MS` | 1000 | Random jitter on top of the base spacing |
| `POLL_TAB_TIMEOUT_MS` | 20000 | Per-tab extraction deadline before parseFail |
| `DEADLINE_MS` (`content/inject.js`) | 8000 | MutationObserver window for SPA hydration |

## Stack

- **Runtime:** Chrome MV3, classic service worker (`importScripts` for shared helpers)
- **Storage:** `chrome.storage.local` (10MB; migrated from `chrome.storage.sync` on install)
- **Extraction:** vendor-specific DOM selectors + `schema.org/Product` JSON-LD fallback
- **Scheduling:** `chrome.alarms` (hourly), one invisible tab per item per cycle
- **UI:** popup only, Chrome native notifications

## Known trade-offs

- Poll tabs briefly appear in the current window's tab strip — MV3 has no truly-hidden-tab API. Sequential + jittered so they don't stack.
- Service-worker termination mid-poll leaves the `pollWaiters` map behind; the poll tab stays open until you close it. Rare because of the 20s per-tab timeout.
- Cookies-included polling reflects member prices (Costco, Target Circle) but can also expose personalized variants at slightly different prices — feature or bug depending on intent.
- Anti-bot: some vendors serve challenge pages on invisible-tab loads if you're signed out. `parseFailCount` in the popup surfaces this per item.
