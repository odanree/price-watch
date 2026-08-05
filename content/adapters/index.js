(function () {
  const NS = (self.PriceWatch = self.PriceWatch || {});
  NS.adapters = NS.adapters || [];
  NS.register = function (adapter) {
    // generic always goes last so vendor-specific adapters win.
    if (adapter.vendor === "generic") NS.adapters.push(adapter);
    else NS.adapters.unshift(adapter);
  };
  NS.match = function (url, doc) {
    return NS.adapters.find(a => {
      try { return a.canHandle(url, doc); } catch { return false; }
    });
  };
})();
