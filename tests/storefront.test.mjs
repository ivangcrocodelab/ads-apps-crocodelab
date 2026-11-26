import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
const source = readFileSync(
  "extensions/partner-ads/assets/partner-ads.js",
  "utf8",
);
class Element {
  children = [];
  events = {};
  hidden = true;
  textContent = "";
  parent = null;
  constructor(kind) {
    this.kind = kind;
  }
  append(...items) {
    for (const item of items) {
      if (item.kind === "fragment") this.append(...item.children);
      else {
        item.parent = this;
        this.children.push(item);
      }
    }
  }
  replaceChildren(...items) {
    this.children = [];
    this.append(...items);
  }
  addEventListener(name, callback) {
    this.events[name] = callback;
  }
  remove() {
    this.parent.children = this.parent.children.filter(
      (child) => child !== this,
    );
  }
}
async function run({
  consent = true,
  cards = [],
  fail = false,
  automated = false,
  passwordProtected = false,
  lifetime = 300000,
  fetchImpl,
} = {}) {
  let now = Date.now();
  const serverTime = now;
  const timers = new Map();
  const root = new Element("div");
  root.dataset = { proxyPath: "/apps/partner-ads" };
  let calls = 0;
  const events = {};
  const privacy = {
    marketingAllowed: () => consent,
    analyticsProcessingAllowed: () => consent,
  };
  vm.runInNewContext(source, {
    window: { Shopify: { customerPrivacy: privacy } },
    navigator: { webdriver: automated },
    document: {
      readyState: "complete",
      querySelectorAll: () => [root],
      createElement: (kind) => new Element(kind),
      createDocumentFragment: () => new Element("fragment"),
      addEventListener: (name, callback) => {
        events[name] = callback;
      },
    },
    fetch: async (_url, options) => {
      calls++;
      if (fetchImpl) return fetchImpl(_url, options);
      if (fail) throw new Error("offline");
      if (passwordProtected && options.credentials !== "same-origin")
        return {
          ok: true,
          json: async () => {
            throw new SyntaxError("Storefront password page is not JSON");
          },
        };
      return {
        ok: true,
        json: async () => ({
          cards: cards.map((card) => ({
            expiresAt: serverTime + lifetime,
            ...card,
          })),
          serverTime,
        }),
      };
    },
    URL,
    AbortController,
    WeakMap,
    Date: { now: () => now },
    setTimeout: (callback, delay) => {
      const id = {};
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  await new Promise((resolve) => setImmediate(resolve));
  return {
    root,
    calls,
    events,
    advance: (ms, fireTimers = true) => {
      now += ms;
      if (fireTimers)
        for (const [id, timer] of timers) {
          if (timer.at <= now) {
            timers.delete(id);
            timer.callback();
          }
        }
    },
    revoke: () => {
      consent = false;
      events.visitorConsentCollected();
    },
  };
}
test("empty offers and network failures render no frame", async () => {
  for (const options of [{ cards: [] }, { fail: true }]) {
    const { root } = await run(options);
    assert.equal(root.hidden, true);
    assert.equal(root.children.length, 0);
  }
});
const offer = {
  title: "Product",
  seller: "Shop",
  token: "signed",
  imageUrl: "https://cdn.shopify.com/image.png",
  productUrl: "https://partner.example/products/product",
};
for (const event of ["visitorConsentCollected", "shopify:section:load"]) {
  test(`${event}: aborted old request cannot hide or abort its replacement`, async () => {
    const pending = [];
    const state = await run({
      fetchImpl: (_url, { signal }) =>
        new Promise((resolve, reject) => {
          pending.push({ signal, resolve, reject });
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    });
    state.events[event]();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(pending[0].signal.aborted, true);
    assert.equal(pending[1].signal.aborted, false);
    pending[1].resolve({
      ok: true,
      json: async () => ({
        cards: [{ ...offer, expiresAt: Date.now() + 300000 }],
        serverTime: Date.now(),
      }),
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.root.hidden, false);
    assert.equal(state.root.children.length, 1);
    state.revoke();
    assert.equal(state.root.hidden, true);
  });
}
test("offers disappear before expiry and expired responses stay hidden", async () => {
  const state = await run({ cards: [offer] });
  state.advance(285000);
  assert.equal(state.root.hidden, true);
  assert.equal(state.root.children.length, 0);
  assert.equal(
    (await run({ cards: [offer], lifetime: 10000 })).root.hidden,
    true,
  );
});
test("expired clicks are blocked even when background timers are suspended", async () => {
  for (const kind of ["click", "auxclick", "contextmenu"]) {
    const state = await run({ cards: [offer] });
    const link = state.root.children[0].children[1];
    state.advance(300001, false);
    let prevented = false;
    link.events[kind]({
      isTrusted: true,
      preventDefault: () => {
        prevented = true;
      },
    });
    assert.equal(prevented, true);
    assert.equal(state.root.hidden, true);
  }
});
test("returning to a background tab removes expired cards", async () => {
  const state = await run({ cards: [offer] });
  state.advance(300001, false);
  state.events.visibilitychange();
  assert.equal(state.root.hidden, true);
});
test("privacy refusal and automation do not request ads", async () => {
  for (const options of [{ consent: false }, { automated: true }])
    assert.equal((await run(options)).calls, 0);
});
test("password-protected storefront keeps its session when loading ads", async () => {
  const { root, calls } = await run({
    passwordProtected: true,
    cards: [
      {
        title: "Product",
        seller: "Partner",
        token: "signed",
        imageUrl: "https://cdn.shopify.com/image.png",
        productUrl: "https://partner.myshopify.com/products/example",
      },
    ],
  });
  assert.equal(calls, 1);
  assert.equal(root.hidden, false);
  assert.equal(root.children.length, 1);
});
test("card labels are safe text and revoked consent removes cards", async () => {
  const title = '<img src=x onerror="alert(1)">';
  const state = await run({
    cards: [
      {
        title,
        seller: "Shop A",
        token: "signed",
        imageUrl: "https://cdn.shopify.com/image.png",
        productUrl: "https://a.myshopify.com/products/example",
      },
    ],
  });
  assert.equal(state.root.hidden, false);
  const article = state.root.children[0];
  assert.equal(article.children[0].textContent, "Partner ad");
  assert.equal(article.children[1].children[1].textContent, title);
  assert.equal(
    article.children[1].href.startsWith("/apps/partner-ads/click?token="),
    true,
  );
  state.revoke();
  assert.equal(state.root.hidden, true);
  assert.equal(state.root.children.length, 0);
});
test("untrusted synthetic clicks are blocked", async () => {
  const state = await run({
    cards: [
      {
        title: "Product",
        seller: "Shop",
        token: "signed",
        imageUrl: "https://cdn.shopify.com/image.png",
        productUrl: "https://a.myshopify.com/products/example",
      },
    ],
  });
  let prevented = false;
  state.root.children[0].children[1].events.click({
    isTrusted: false,
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(state.root.hidden, true);
});
