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

  NS.register({
    vendor: "homedepot",
    canHandle: (url) => new URL(url).hostname.endsWith("homedepot.com") && /\/p\//.test(url),
    extract: (doc) => {
      const canonicalUrl = doc.querySelector("link[rel=canonical]")?.href;

      // Path 1 — JSON-LD Product (HD emits this reliably at hydration).
      const ld = jsonLdProduct(doc);
      if (ld?.offers) {
        const offer = [ld.offers].flat()[0];
        const priceCents = NS.price.parseCents(offer?.price ?? offer?.lowPrice);
        if (priceCents && ld.name) {
          return {
            title: ld.name,
            priceCents,
            imageUrl: [ld.image].flat()[0],
            canonicalUrl
          };
        }
      }

      // Path 2 — DOM selectors (fragile; selectors change quarterly).
      const title =
        doc.querySelector("h1.product-details__title")?.textContent.trim() ||
        doc.querySelector("h1[data-testid='product-header']")?.textContent.trim() ||
        doc.querySelector("main h1")?.textContent.trim();
      const priceText =
        doc.querySelector(".price-format__main-price")?.textContent ||
        doc.querySelector("[data-testid='price']")?.textContent ||
        doc.querySelector("[data-testid='product-price']")?.textContent ||
        doc.querySelector(".price__wrapper")?.textContent;
      const priceCents = NS.price.parseCents(priceText);
      const imageUrl =
        doc.querySelector(".mediagallery__mainimage img")?.src ||
        doc.querySelector("img[data-testid='product-image']")?.src ||
        doc.querySelector("meta[property='og:image']")?.content;

      return title && priceCents ? { title, priceCents, imageUrl, canonicalUrl } : null;
    }
  });
})();
