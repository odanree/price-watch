(function () {
  const NS = self.PriceWatch;
  NS.register({
    vendor: "lowes",
    canHandle: (url) => new URL(url).hostname.endsWith("lowes.com") && /\/pd\//.test(url),
    extract: (doc) => {
      const title =
        doc.querySelector("h1.pd-page-title")?.textContent.trim() ||
        doc.querySelector("h1[data-selector='splp-prd-tl']")?.textContent.trim() ||
        doc.querySelector("h1")?.textContent.trim();
      const priceText =
        doc.querySelector("[itemprop='price']")?.getAttribute?.("content") ||
        doc.querySelector("[data-selector='splp-price'] .main-price")?.textContent ||
        doc.querySelector(".main-price")?.textContent ||
        doc.querySelector(".sc-price-major")?.textContent;
      const priceCents = NS.price.parseCents(priceText);
      const imageUrl =
        doc.querySelector("[data-selector='hero-image'] img")?.src ||
        doc.querySelector("img.styleguide--img")?.src;
      const canonicalUrl = doc.querySelector("link[rel=canonical]")?.href;
      return title && priceCents ? { title, priceCents, imageUrl, canonicalUrl } : null;
    }
  });
})();
