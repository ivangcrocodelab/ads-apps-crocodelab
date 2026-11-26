(() => {
  if (window.partnerAdsInitialized) return;
  window.partnerAdsInitialized = true;
  const controllers = new WeakMap();
  const expiryTimers = new WeakMap();
  const deadlines = new WeakMap();
  const allowed = () => {
    const privacy = window.Shopify?.customerPrivacy;
    return (
      !navigator.webdriver &&
      privacy?.marketingAllowed() === true &&
      privacy?.analyticsProcessingAllowed() === true
    );
  };
  function hide(element) {
    clearTimeout(expiryTimers.get(element));
    deadlines.delete(element);
    controllers.get(element)?.abort();
    controllers.delete(element);
    element.replaceChildren();
    element.hidden = true;
  }
  async function load(element) {
    hide(element);
    if (!allowed()) return;
    const path = element.dataset.proxyPath;
    if (!/^\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(path || "")) return;
    const controller = new AbortController();
    controllers.set(element, controller);
    const timeout = setTimeout(() => controller.abort(), 6000);
    const startedAt = Date.now();
    try {
      const response = await fetch(`${path}/ads?consent=1`, {
        signal: controller.signal,
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) return;
      const result = await response.json();
      if (
        controllers.get(element) !== controller ||
        !allowed() ||
        controller.signal.aborted ||
        !Array.isArray(result.cards) ||
        !Number.isFinite(result.serverTime)
      )
        return;
      const fragment = document.createDocumentFragment();
      let deadline = Infinity;
      for (const card of result.cards.slice(0, 3)) {
        // Use server-relative lifetime, subtract the whole request time and a
        // navigation margin. The visitor's wall clock need not match the server.
        const cardDeadline =
          startedAt + card.expiresAt - result.serverTime - 15000;
        if (
          !Number.isFinite(cardDeadline) ||
          cardDeadline <= Date.now() ||
          typeof card.title !== "string" ||
          typeof card.seller !== "string" ||
          typeof card.token !== "string"
        )
          continue;
        const image = new URL(card.imageUrl);
        const destination = new URL(card.productUrl);
        if (image.protocol !== "https:" || destination.protocol !== "https:")
          continue;
        const article = document.createElement("article");
        article.className = "partner-ads__card";
        const label = document.createElement("span");
        label.className = "partner-ads__label";
        label.textContent = "Partner ad";
        const link = document.createElement("a");
        link.href = `${path}/click?token=${encodeURIComponent(card.token)}&gesture=1&consent=1`;
        link.rel = "sponsored nofollow noreferrer";
        const guard = (event) => {
          if (!event.isTrusted || !allowed() || Date.now() >= cardDeadline) {
            event.preventDefault();
            hide(element);
          }
        };
        link.addEventListener("click", guard);
        link.addEventListener("auxclick", guard);
        link.addEventListener("contextmenu", guard);
        const img = document.createElement("img");
        img.src = image.toString();
        img.alt = card.title;
        img.width = 480;
        img.height = 360;
        img.loading = "lazy";
        img.referrerPolicy = "no-referrer";
        img.addEventListener("error", () => {
          article.remove();
          if (!element.children.length) element.hidden = true;
        });
        const title = document.createElement("h3");
        title.textContent = card.title;
        const seller = document.createElement("span");
        seller.textContent = card.seller;
        link.append(img, title);
        article.append(label, link, seller);
        fragment.append(article);
        deadline = Math.min(deadline, cardDeadline);
      }
      if (fragment.children.length) {
        element.replaceChildren(fragment);
        element.hidden = false;
        deadlines.set(element, deadline);
        expiryTimers.set(
          element,
          setTimeout(() => hide(element), deadline - Date.now()),
        );
      }
    } catch {
      if (controllers.get(element) === controller) hide(element);
    } finally {
      clearTimeout(timeout);
    }
  }
  const refresh = () =>
    document.querySelectorAll("[data-partner-ads]").forEach(load);
  document.addEventListener("visitorConsentCollected", refresh);
  document.addEventListener("shopify:section:load", refresh);
  document.addEventListener("visibilitychange", () => {
    document.querySelectorAll("[data-partner-ads]").forEach((element) => {
      if (Date.now() >= (deadlines.get(element) ?? Infinity)) hide(element);
    });
  });
  function initialize() {
    if (window.Shopify?.customerPrivacy) refresh();
    else
      window.Shopify?.loadFeatures?.(
        [{ name: "consent-tracking-api", version: "0.2" }],
        (error) => {
          if (!error) refresh();
        },
      );
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
