(function () {
  const NS = self.PriceWatch;
  NS.register({
    vendor: "target",
    canHandle: (url) => new URL(url).hostname.endsWith("target.com") && /\/p\//.test(url),
    extract: (doc) => {
      const title = doc.querySelector("h1[data-test='product-title']")?.textContent.trim();
      const priceText = doc.querySelector("[data-test='product-price']")?.textContent;
      const priceCents = NS.price.parseCents(priceText);
      const imageUrl = doc.querySelector("picture img")?.src;
      const canonicalUrl = doc.querySelector("link[rel=canonical]")?.href;
      return title && priceCents ? { title, priceCents, imageUrl, canonicalUrl } : null;
    }
  });
})();
