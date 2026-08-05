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
      doc.querySelector("[data-selector='hero-image'] img")?.src ||
      doc.querySelector(".pd-hero img")?.src ||
      doc.querySelector("img.styleguide--img")?.src ||
      null
    );
  }

  NS.register({
    vendor: "lowes",
    canHandle: (url) => new URL(url).hostname.endsWith("lowes.com") && /\/pd\//.test(url),
    extract: (doc) => {
      const canonicalUrl = doc.querySelector("link[rel=canonical]")?.href;
      const ld = jsonLdProduct(doc);
      const imageUrl = resolveImage(doc, ld);

      if (ld?.offers) {
        const offer = [ld.offers].flat()[0];
        const priceCents = NS.price.parseCents(offer?.price ?? offer?.lowPrice);
        if (priceCents && ld.name) {
          if (!imageUrl) console.warn("[price-watch] lowes: no image resolved for", ld.name);
          return { title: ld.name, priceCents, imageUrl, canonicalUrl };
        }
      }

      const title =
        doc.querySelector("h1.pd-page-title")?.textContent.trim() ||
        doc.querySelector("h1[data-selector='splp-prd-tl']")?.textContent.trim() ||
        doc.querySelector("main h1")?.textContent.trim() ||
        doc.querySelector("h1")?.textContent.trim();
      const priceText =
        doc.querySelector("[itemprop='price']")?.getAttribute?.("content") ||
        doc.querySelector("[data-selector='splp-price'] .main-price")?.textContent ||
        doc.querySelector(".main-price")?.textContent ||
        doc.querySelector(".sc-price-major")?.textContent;
      const priceCents = NS.price.parseCents(priceText);

      if (title && priceCents && !imageUrl) console.warn("[price-watch] lowes: no image resolved for", title);
      return title && priceCents ? { title, priceCents, imageUrl, canonicalUrl } : null;
    }
  });
})();
