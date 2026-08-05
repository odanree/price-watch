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
    vendor: "costco",
    canHandle: (url) => {
      const u = new URL(url);
      if (!u.hostname.endsWith("costco.com")) return false;
      // Current format: /p/-/<slug>/<numeric-id> or /p/<slug>/<numeric-id>
      // Legacy format: <slug>.product.<id>.html
      return /\/p\/[^/]*\/\d+/.test(u.pathname) || /\.product\.\d+\.html/.test(u.pathname);
    },
    extract: (doc) => {
      const canonicalUrl = doc.querySelector("link[rel=canonical]")?.href;

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

      const title =
        doc.querySelector("#product-page-title")?.textContent.trim() ||
        doc.querySelector("h1.product-title")?.textContent.trim() ||
        doc.querySelector("main h1")?.textContent.trim();
      const priceText =
        doc.querySelector("[automation-id='productPriceOutput']")?.textContent ||
        doc.querySelector(".your-price .value")?.textContent ||
        doc.querySelector(".price .value")?.textContent;
      const priceCents = NS.price.parseCents(priceText);
      const imageUrl =
        doc.querySelector("#initialProductImage")?.src ||
        doc.querySelector(".product-image img")?.src ||
        doc.querySelector("meta[property='og:image']")?.content;

      return title && priceCents ? { title, priceCents, imageUrl, canonicalUrl } : null;
    }
  });
})();
