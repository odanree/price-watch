(function () {
  const NS = self.PriceWatch;

  function findProductLD(doc) {
    for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try { data = JSON.parse(s.textContent); } catch { continue; }
      for (const node of [data].flat()) {
        if (node && node["@type"] === "Product") return node;
        for (const child of node?.["@graph"] || []) {
          if (child?.["@type"] === "Product") return child;
        }
      }
    }
    return null;
  }

  NS.register({
    vendor: "generic",
    canHandle: () => true,
    extract: (doc) => {
      const product = findProductLD(doc);
      if (product?.offers) {
        const offer = [product.offers].flat()[0];
        const priceCents = NS.price.parseCents(offer.price ?? offer.lowPrice);
        if (priceCents) {
          return {
            title: product.name,
            priceCents,
            imageUrl: [product.image].flat()[0],
            canonicalUrl: doc.querySelector("link[rel=canonical]")?.href
          };
        }
      }
      const ogPrice = doc.querySelector(
        "meta[property='og:price:amount'], meta[property='product:price:amount']"
      )?.content;
      const ogTitle = doc.querySelector("meta[property='og:title']")?.content;
      const priceCents = NS.price.parseCents(ogPrice);
      if (priceCents && ogTitle) {
        return {
          title: ogTitle,
          priceCents,
          imageUrl: doc.querySelector("meta[property='og:image']")?.content,
          canonicalUrl: doc.querySelector("link[rel=canonical]")?.href
        };
      }
      return null;
    }
  });
})();
