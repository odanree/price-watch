(function () {
  const NS = self.PriceWatch;
  NS.register({
    vendor: "bestbuy",
    canHandle: (url) => new URL(url).hostname.endsWith("bestbuy.com") && /\/site\//.test(url),
    extract: (doc) => {
      const title =
        doc.querySelector(".sku-title h1")?.textContent.trim() ||
        doc.querySelector("h1.heading-5")?.textContent.trim();
      const priceText =
        doc.querySelector(".priceView-hero-price span[aria-hidden='true']")?.textContent ||
        doc.querySelector(".priceView-customer-price span")?.textContent;
      const priceCents = NS.price.parseCents(priceText);
      const imageUrl = doc.querySelector(".primary-image")?.src;
      const canonicalUrl = doc.querySelector("link[rel=canonical]")?.href;
      return title && priceCents ? { title, priceCents, imageUrl, canonicalUrl } : null;
    }
  });
})();
