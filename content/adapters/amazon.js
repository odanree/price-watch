(function () {
  const NS = self.PriceWatch;
  NS.register({
    vendor: "amazon",
    canHandle: (url) => {
      const h = new URL(url).hostname;
      return /(^|\.)amazon\.[a-z.]+$/.test(h) && /\/(dp|gp\/product)\//.test(url);
    },
    extract: (doc) => {
      const title = doc.querySelector("#productTitle")?.textContent.trim();
      const priceText =
        doc.querySelector(".a-price .a-offscreen")?.textContent ||
        doc.querySelector("#priceblock_ourprice")?.textContent ||
        doc.querySelector("#priceblock_dealprice")?.textContent;
      const priceCents = NS.price.parseCents(priceText);
      const imageUrl = doc.querySelector("#landingImage")?.src;
      const canonicalUrl = doc.querySelector("link[rel=canonical]")?.href;
      return title && priceCents ? { title, priceCents, imageUrl, canonicalUrl } : null;
    }
  });
})();
