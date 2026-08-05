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
    vendor: "bestbuy",
    canHandle: (url) => new URL(url).hostname.endsWith("bestbuy.com") && /\/site\//.test(url),
    extract: (doc) => {
      const canonicalUrl = doc.querySelector("link[rel=canonical]")?.href;
      const ogImage = doc.querySelector("meta[property='og:image']")?.content;

      const ld = jsonLdProduct(doc);
      if (ld?.offers) {
        const offer = [ld.offers].flat()[0];
        const priceCents = NS.price.parseCents(offer?.price ?? offer?.lowPrice);
        if (priceCents && ld.name) {
          return {
            title: ld.name,
            priceCents,
            imageUrl: [ld.image].flat()[0] || ogImage,
            canonicalUrl
          };
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
      const imageUrl =
        doc.querySelector(".primary-image")?.src ||
        doc.querySelector(".image-block img")?.src ||
        doc.querySelector("img.primary-image")?.src ||
        ogImage;

      return title && priceCents ? { title, priceCents, imageUrl, canonicalUrl } : null;
    }
  });
})();
