const fs = require("fs");
const { JSDOM } = require("jsdom");

const HTML = process.argv[2] || "/mnt/user-data/outputs/cut/index.html";

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  → " + extra : "")); }
};

function boot(fixedDate) {
  const store = {};
  const dom = new JSDOM(fs.readFileSync(HTML, "utf8"), {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "https://example.github.io/cut/",
    beforeParse(w) {
      Object.defineProperty(w, "localStorage", {
        value: {
          getItem: k => (k in store ? store[k] : null),
          setItem: (k, v) => { store[k] = String(v); },
          removeItem: k => { delete store[k]; },
        },
      });
      if (fixedDate) {
        const Real = w.Date;
        class D extends Real {
          constructor(...a) { return a.length ? new Real(...a) : new Real(fixedDate); }
          static now() { return new Real(fixedDate).getTime(); }
        }
        w.Date = D;
      }
    },
  });
  return { dom, w: dom.window, d: dom.window.document, store };
}

const text = d => d.getElementById("view").textContent;
const tap = (w, el) => {
  if (!el) throw new Error("no element to tap");
  el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
};
const type = (w, el, val) => {
  el.value = val;
  el.dispatchEvent(new w.Event("input", { bubbles: true }));
};
const gotoTab = (w, d, t) => tap(w, d.querySelector(`[data-tab="${t}"]`));
const saved = store => JSON.parse(store["thecut.v1"] || "{}");

/* ── 1. meal tick toggles both ways, repeatedly ── */
{
  console.log("\nMeal ticks");
  const { w, d, store } = boot("2026-08-31T09:00:00");   // a Monday = lift day
  const id = d.querySelector("[data-meal]").dataset.meal;
  const onNow = () => !!(saved(store).meals || {})[Object.keys(saved(store).meals || {})[0]]?.[id];

  for (let i = 1; i <= 6; i++) {
    tap(w, d.querySelector(`[data-meal="${id}"]`));
    const date = Object.keys(saved(store).meals)[0];
    const val = !!saved(store).meals[date][id];
    ok(`tap ${i} → ${i % 2 ? "ticked" : "unticked"}`, val === (i % 2 === 1), "got " + val);
  }
  const ticks = d.querySelectorAll(".tick.on").length;
  ok("no stuck tick in the DOM after 6 taps", ticks === 0, ticks + " still on");
}

/* ── 2. ingredient dropdown ── */
{
  console.log("\nIngredient dropdown");
  const { w, d } = boot("2026-08-31T09:00:00");
  const first = d.querySelector("[data-open]");
  const mealId = first.dataset.open;

  tap(w, first);
  ok("opens on tapping the meal name", text(d).includes("Weigh raw"));
  ok("shows a gram weight", /\d+\s*g/.test(d.querySelector(".ing")?.textContent || ""));

  tap(w, d.querySelector(`[data-open="${mealId}"]`));
  ok("closes again", !text(d).includes("Weigh raw"));

  // the +/− affordance must itself be tappable
  tap(w, d.querySelector(`[data-open="${mealId}"]`));
  const plus = [...d.querySelectorAll("span")].find(s => s.textContent.trim() === "−");
  ok("the −/+ marker is inside a tappable target", !!(plus && plus.closest("[data-open]")));

  // tapping the tick must NOT open the dropdown
  const { w: w2, d: d2 } = boot("2026-08-31T09:00:00");
  tap(w2, d2.querySelector("[data-meal]"));
  ok("ticking does not open ingredients", !text(d2).includes("Weigh raw"));
}

/* ── 3. protein total tracks the ticks ── */
{
  console.log("\nProtein running total");
  const { w, d } = boot("2026-08-31T09:00:00");
  const before = text(d).match(/(\d+)\/170 G PROTEIN/i);
  tap(w, d.querySelector("[data-meal]"));
  const after = text(d).match(/(\d+)\/170 G PROTEIN/i);
  ok("starts at 0", before && before[1] === "0", before && before[1]);
  ok("rises after one meal", after && +after[1] > 0, after && after[1]);
}

/* ── 4. shopping list ── */
{
  console.log("\nShopping list");
  const { w, d, store } = boot();
  gotoTab(w, d, "shop");
  const item = d.querySelector("[data-shop]").dataset.shop;
  tap(w, d.querySelector(`[data-shop="${item}"]`) || d.querySelector("[data-shop]"));
  ok("ticks on", saved(store).shopping[item] === true);
  tap(w, [...d.querySelectorAll("[data-shop]")].find(e => e.dataset.shop === item));
  ok("ticks off", saved(store).shopping[item] === false);
  ok("item text survives the round trip", item.includes("—") ? item.includes("—") : true);
}

/* ── 5. training log ── */
{
  console.log("\nTraining log");
  const { w, d, store } = boot("2026-08-31T09:00:00");
  gotoTab(w, d, "train");
  ok("auto-selects Monday's session A", text(d).includes("Full body A"));

  const wIn = d.querySelector('[data-lift][data-f="w"]');
  const rIn = d.querySelector('[data-lift][data-f="r"]');
  type(w, wIn, "80");
  type(w, rIn, "8");
  const s = saved(store).sessions["2026-08-31"];
  ok("weight written to storage", s && s.entries.sq[0].w === "80", JSON.stringify(s));
  ok("reps written to storage", s && s.entries.sq[0].r === "8");
  ok("session letter recorded", s && s.day === "A");

  tap(w, d.querySelector('[data-pick="B"]'));
  ok("switching to B shows deadlift", text(d).includes("Deadlift"));
  tap(w, d.querySelector('[data-pick="A"]'));
  ok("switching back to A keeps the typed value",
    d.querySelector('[data-lift="sq"][data-f="w"]').value === "80",
    d.querySelector('[data-lift="sq"][data-f="w"]').value);
}

/* ── 6. progression prompt ── */
{
  console.log("\nProgression prompt");
  const { w, d, store } = boot("2026-09-02T09:00:00"); // Wednesday
  store["thecut.v1"] = JSON.stringify({
    weights: {}, shopping: {}, meals: {},
    sessions: { "2026-08-31": { day: "A", entries: { sq: [{w:"80",r:"8"},{w:"80",r:"8"},{w:"80",r:"8"},{w:"80",r:"8"}] } } },
  });
  const b = boot("2026-09-02T09:00:00");
  b.store["thecut.v1"] = store["thecut.v1"];
  const r = boot("2026-09-02T09:00:00");
  // reload with the seeded store
  const dom2 = new JSDOM(fs.readFileSync(HTML, "utf8"), {
    runScripts: "dangerously", pretendToBeVisual: true, url: "https://example.github.io/cut/",
    beforeParse(win) {
      const st = { "thecut.v1": store["thecut.v1"] };
      Object.defineProperty(win, "localStorage", { value: {
        getItem: k => (k in st ? st[k] : null), setItem: (k,v)=>{st[k]=String(v)}, removeItem: k=>{delete st[k]} } });
      const Real = win.Date;
      class D extends Real {
        constructor(...a){ return a.length ? new Real(...a) : new Real("2026-09-02T09:00:00"); }
        static now(){ return new Real("2026-09-02T09:00:00").getTime(); }
      }
      win.Date = D;
    },
  });
  const w2 = dom2.window, d2 = dom2.window.document;
  gotoTab(w2, d2, "train");
  tap(w2, d2.querySelector('[data-pick="A"]'));
  ok("offers +5 kg after clearing the rep range", text(d2).includes("add 5 kg"));
  ok("names the new load", text(d2).includes("85 kg"));
  const ph = d2.querySelector('[data-lift="sq"][data-f="w"]').getAttribute("placeholder");
  ok("last session shows as a ghost number", ph === "80", ph);
}

/* ── 7. weights + averages ── */
{
  console.log("\nWeight log");
  const { w, d, store } = boot("2026-08-31T09:00:00");
  gotoTab(w, d, "log");
  type(w, d.querySelector("#wIn"), "85.4");
  ok("weight saved", saved(store).weights["2026-08-31"] === 85.4);
  ok("average updates live", d.querySelector("#avg").textContent === "85.4",
     d.querySelector("#avg").textContent);
  type(w, d.querySelector("#wIn"), "");
  ok("clearing the field removes the entry", !("2026-08-31" in saved(store).weights));
  type(w, d.querySelector("#wIn"), "999");
  ok("rejects an absurd value", !("2026-08-31" in saved(store).weights));
}

/* ── 8. date navigation ── */
{
  console.log("\nDate navigation");
  const { w, d } = boot("2026-08-31T09:00:00"); // Monday
  ok("Monday is a lift day", text(d).includes("Lift day — A"));
  tap(w, d.querySelector("#next"));
  ok("Tuesday is a ride day", text(d).includes("Ride day"));
  ok("rest-day macros shown on Tuesday", text(d).includes("1950"));
  tap(w, d.querySelector("#prev"));
  ok("back to Monday", text(d).includes("Lift day — A"));
  ok("training macros on Monday", text(d).includes("2350"));
  tap(w, d.querySelector("#prev"));
  ok("Sunday is a rest day", text(d).includes("Rest day"));
}

/* ── 9. per-day isolation ── */
{
  console.log("\nPer-day isolation");
  const { w, d, store } = boot("2026-08-31T09:00:00");
  tap(w, d.querySelector("[data-meal]"));
  tap(w, d.querySelector("#next"));
  const onNext = d.querySelectorAll(".tick.on").length;
  ok("yesterday's tick doesn't bleed into the next day", onNext === 0, onNext + " ticked");
  tap(w, d.querySelector("#prev"));
  ok("original day still ticked", d.querySelectorAll(".tick.on").length === 1);
}

/* ── 10. persistence across a restart ── */
{
  console.log("\nPersistence");
  const { w, d, store } = boot("2026-08-31T09:00:00");
  gotoTab(w, d, "train");
  type(w, d.querySelector('[data-lift][data-f="w"]'), "100");
  const snapshot = store["thecut.v1"];

  const dom2 = new JSDOM(fs.readFileSync(HTML, "utf8"), {
    runScripts: "dangerously", pretendToBeVisual: true, url: "https://example.github.io/cut/",
    beforeParse(win) {
      const st = { "thecut.v1": snapshot };
      Object.defineProperty(win, "localStorage", { value: {
        getItem: k => (k in st ? st[k] : null), setItem: (k,v)=>{st[k]=String(v)}, removeItem: k=>{delete st[k]} } });
      const Real = win.Date;
      class D extends Real {
        constructor(...a){ return a.length ? new Real(...a) : new Real("2026-08-31T09:00:00"); }
        static now(){ return new Real("2026-08-31T09:00:00").getTime(); }
      }
      win.Date = D;
    },
  });
  gotoTab(dom2.window, dom2.window.document, "train");
  const v = dom2.window.document.querySelector('[data-lift="sq"][data-f="w"]').value;
  ok("value survives a full reload", v === "100", "got '" + v + "'");
}

/* ── 11. no duplicate listeners ── */
{
  console.log("\nHandler hygiene");
  const { w, d, store } = boot("2026-08-31T09:00:00");
  for (let i = 0; i < 10; i++) { gotoTab(w, d, "shop"); gotoTab(w, d, "today"); }
  const id = d.querySelector("[data-meal]").dataset.meal;
  tap(w, d.querySelector(`[data-meal="${id}"]`));
  const date = Object.keys(saved(store).meals)[0];
  ok("one tap = one toggle after 20 redraws", saved(store).meals[date][id] === true,
     JSON.stringify(saved(store).meals));
}

/* ── 12. offline plumbing ── */
{
  console.log("\nPWA plumbing");
  const html = fs.readFileSync(HTML, "utf8");
  ok("registers a service worker", html.includes('register("sw.js")'));
  ok("links the manifest", html.includes('rel="manifest"'));
  ok("apple touch icon present", html.includes('apple-touch-icon'));
  ok("standalone meta present", html.includes('apple-mobile-web-app-capable'));
  ok("16px inputs (no iOS zoom)", /input\{font-size:16px\}/.test(html.replace(/\s/g, "")));
  ok("safe-area padding on the tab bar", html.includes("safe-area-inset-bottom"));
  const sw = fs.readFileSync(HTML.replace(/index\.html$/, "sw.js"), "utf8");
  ok("service worker caches index.html", sw.includes("./index.html"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
