(function () {
  const NS = self.PriceWatch;
  NS.register({
    vendor: "amazon",
    canHandle: (url) => {
      const h = new URL(url).hostname;
      return /(^|\.)amazon\.[a-z.]+$/.test(h) && /\/(dp|gp\/product)\//.test(url);
    },
    extract: (doc) => {
      const title =
        doc.querySelector("#productTitle")?.textContent.trim() ||
        doc.querySelector("#title")?.textContent.trim();

      // Amazon's price DOM varies heavily by category, variant, seller, and A/B test.
      // Order matters — buy-box specific containers first, then broader apex classes,
      // then legacy IDs, then a final broad fallback that can accidentally match a
      // strikethrough compare-price. parseCents pulls the first number out of textContent,
      // which handles the duplicated "$599.99$599.99" (visible + accessibility) shape
      // Amazon emits on modern PDPs.
      const priceText =
        doc.querySelector(".reinventPricePriceToPayMargin.apex-pricetopay-value")?.textContent ||
        doc.querySelector(".reinventPricePriceToPayMargin .apex-pricetopay-accessibility-label")?.textContent ||
        doc.querySelector(".apex-core-price-identifier .apex-pricetopay-accessibility-label")?.textContent ||
        doc.querySelector(".apex-core-price-identifier .apex-pricetopay-value")?.textContent ||
        doc.querySelector(".apex-pricetopay-value")?.textContent ||
        doc.querySelector("#corePriceDisplay_desktop_feature_div .a-price .a-offscreen")?.textContent ||
        doc.querySelector("#corePrice_feature_div .a-price .a-offscreen")?.textContent ||
        doc.querySelector("#apex_desktop .a-price .a-offscreen")?.textContent ||
        doc.querySelector("#buybox .a-price .a-offscreen")?.textContent ||
        doc.querySelector(".a-price[data-a-color='price'] .a-offscreen")?.textContent ||
        doc.querySelector(".a-price .a-offscreen")?.textContent ||
        doc.querySelector("#priceblock_ourprice")?.textContent ||
        doc.querySelector("#priceblock_dealprice")?.textContent ||
        doc.querySelector("#priceblock_saleprice")?.textContent ||
        doc.querySelector("meta[itemprop='price']")?.getAttribute?.("content");
      const priceCents = NS.price.parseCents(priceText);

      const imageUrl =
        doc.querySelector("#landingImage")?.src ||
        doc.querySelector("#imgBlkFront")?.src ||
        doc.querySelector("#main-image")?.src ||
        doc.querySelector("meta[property='og:image']")?.content;
      const canonicalUrl = doc.querySelector("link[rel=canonical]")?.href;

      return title && priceCents ? { title, priceCents, imageUrl, canonicalUrl } : null;
    }
  });
})();
