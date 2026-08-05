(function () {
  const NS = (self.PriceWatch = self.PriceWatch || {});
  NS.price = {
    parseCents(text) {
      if (text == null) return null;
      const m = String(text).replace(/[\s,]/g, "").match(/(\d+(?:\.\d{1,2})?)/);
      if (!m) return null;
      return Math.round(parseFloat(m[1]) * 100);
    },
    formatUSD(cents) {
      return "$" + (cents / 100).toFixed(2);
    }
  };
})();
