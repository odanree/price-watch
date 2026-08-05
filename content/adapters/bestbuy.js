(function () {
  const NS = self.PriceWatch;

  function jsonLdProduct(doc) {
    for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try { data = JSON.parse(s.textContent); } catch { continue; }
      for (const node of [data].flat()) {
        if (node?.["@type"] === "Product") return node;
        for (const child of node?.["@graph"] || []) {
          if (child?.["@type"] === "Product") return child;
        }
      }
    }
    return null;
  }

  // JSON-LD `image` can be a string, an array, or a nested ImageObject.
  function ldImageUrl(ld) {
    const img = [ld?.image].flat()[0];
    if (!img) return null;
    if (typeof img === "string") return img;
    if (typeof img === "object") return img.url || img.contentUrl || img["@id"] || null;
    return null;
  }

  function resolveImage(doc, ld) {
    return (
      ldImageUrl(ld) ||
      doc.querySelector("meta[property='og:image']")?.content ||
      doc.querySelector("meta[name='twitter:image']")?.content ||
      doc.querySelector("meta[name='twitter:image:src']")?.content ||
      doc.querySelector("link[rel='image_src']")?.href ||
      doc.querySelector("[itemprop='image']")?.content ||
      doc.querySelector("img[itemprop='image']")?.src ||
      doc.querySelector("[data-testid='product-image'] img")?.src ||
      doc.querySelector("[data-testid='hero-image'] img")?.src ||
      doc.querySelector(".primary-image")?.src ||
      doc.querySelector(".image-block img")?.src ||
      doc.querySelector("img.primary-image")?.src ||
      doc.querySelector(".shop-media-gallery img")?.src ||
      null
    );
  }

  NS.register({
    vendor: "bestbuy",
    canHandle: (url) => {
      try {
        const u = new URL(url);
        if (!u.hostname.endsWith("bestbuy.com")) return false;
        // Best Buy PDP patterns: /site/{slug}/{sku}.p, /site/{sku}.p,
        // /product/{slug}, or any path ending in .p (their canonical PDP suffix).
        const p = u.pathname;
        return /\/site\//.test(p) || /\/product\//.test(p) || /\.p$/.test(p);
      } catch { return false; }
    },
    extract: (doc) => {
      const canonicalUrl = doc.querySelector("link[rel=canonical]")?.href;
      const ld = jsonLdProduct(doc);
      const imageUrl = resolveImage(doc, ld);

      if (ld?.offers) {
        const offer = [ld.offers].flat()[0];
        const priceCents = NS.price.parseCents(offer?.price ?? offer?.lowPrice);
        if (priceCents && ld.name) {
          if (!imageUrl) console.warn("[price-watch] bestbuy: no image resolved for", ld.name);
          return { title: ld.name, priceCents, imageUrl, canonicalUrl };
        }
      }

      const title =
        doc.querySelector(".sku-title h1")?.textContent.trim() ||
        doc.querySelector("h1.heading-5")?.textContent.trim() ||
        doc.querySelector("main h1")?.textContent.trim();
      const priceText =
        doc.querySelector(".priceView-hero-price span[aria-hidden='true']")?.textContent ||
        doc.querySelector(".priceView-customer-price span")?.textContent;
      const priceCents = NS.price.parseCents(priceText);

      if (title && priceCents && !imageUrl) console.warn("[price-watch] bestbuy: no image resolved for", title);
      return title && priceCents ? { title, priceCents, imageUrl, canonicalUrl } : null;
    }
  });
})();
