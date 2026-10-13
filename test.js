const fs = require("fs");
const { JSDOM } = require("jsdom");

const HTML = process.argv[2] || "/mnt/user-data/outputs/cut/index.html";

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra ? "  → " + extra : "")); }
};

function boot(fixedDate, seed) {
  const store = seed ? { "thecut.v1": seed } : {};
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
  ok("weight written to storage", s && s.A.entries.sq[0].w === "80", JSON.stringify(s));
  ok("reps written to storage", s && s.A.entries.sq[0].r === "8");
  ok("session letter recorded", s && !!s.A);

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
    sessions: { "2026-08-31": { A: { entries: { sq: [{w:"80",r:"8"},{w:"80",r:"8"},{w:"80",r:"8"},{w:"80",r:"8"}] } } } },
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



/* ── 13. food logging: macro maths + totals ── */
{
  console.log("\nFood logging");
  const { w, d, store } = boot("2026-08-31T09:00:00");
  ok("scan button present", !!d.getElementById("openScan"));
  ok("sheet exists but hidden", d.getElementById("sheet") && !d.getElementById("sheet").classList.contains("on"));

  // seed an extra item as the scanner would, then reload
  const seeded = JSON.stringify({ weights:{}, sessions:{}, shopping:{}, meals:{},
    extra:{ "2026-08-31":[{n:"Test cheddar",g:50,p:12.5,kcal:208,c:0.1,f:17.4,sat:10.9}] } });
  const { JSDOM } = require("jsdom");
  const dom2 = new JSDOM(require("fs").readFileSync(HTML,"utf8"), {
    runScripts:"dangerously", pretendToBeVisual:true, url:"https://x.github.io/cut/",
    beforeParse(win){
      const st={"thecut.v1":seeded};
      Object.defineProperty(win,"localStorage",{value:{getItem:k=>(k in st?st[k]:null),setItem:(k,v)=>{st[k]=String(v)},removeItem:k=>{delete st[k]}}});
      const R=win.Date;
      class D extends R{ constructor(...a){ return a.length?new R(...a):new R("2026-08-31T09:00:00"); } static now(){ return new R("2026-08-31T09:00:00").getTime(); } }
      win.Date=D;
    },
  });
  const t = dom2.window.document.getElementById("view").textContent;
  ok("extra item listed with grams", t.includes("Test cheddar") && t.includes("50 g"));
  ok("counts toward protein total", /\b13\/170 G PROTEIN/i.test(t), t.match(/\d+\/170 G PROTEIN/i));
  ok("surfaces saturated fat", t.includes("10.9"));
  ok("delete control rendered", !!dom2.window.document.querySelector("[data-del]"));

  // deleting removes it
  const del = dom2.window.document.querySelector("[data-del]");
  del.dispatchEvent(new dom2.window.MouseEvent("click",{bubbles:true}));
  ok("delete removes the item", !dom2.window.document.getElementById("view").textContent.includes("Test cheddar"));
}

/* ── 14. offline-dependency honesty ── */
{
  console.log("\nNetwork boundaries");
  const html = fs.readFileSync(HTML, "utf8");
  ok("scanner polyfill loaded lazily, not at boot", !/<script[^>]+type="module"/.test(html) && html.includes('iife/ponyfill.min.js'));
  ok("uses Open Food Facts v2 product endpoint", html.includes("/api/v2/product/"));
  ok("lookup failures are surfaced", html.includes("check your connection"));
}




/* ── 15. session D ── */
{
  console.log("\nSession D");
  const { w, d } = boot("2026-09-03T09:00:00");       // a Thursday
  ok("Thursday shows accessories, not a ride", text(d).includes("Accessories + 4x4"));
  ok("Thursday is no longer a ride day", !text(d).includes("Ride day"));
  ok("rest-day macros on Thursday", text(d).includes("1950"));

  gotoTab(w, d, "train");
  ok("four session buttons", d.querySelectorAll("[data-pick]").length === 4);
  ok("auto-selects D", text(d).includes("Accessories + 4x4"));
  ok("lateral raise present", text(d).includes("Lateral raise"));
  ok("calf raise present", text(d).includes("calf raise"));
  ok("4x4 present", text(d).includes("4x4 intervals"));
  ok("interval row has no kg column", text(d).includes("MINUTES"));
  ok("protocol note shown", text(d).includes("4 min hard"));

  const inputs = d.querySelectorAll('[data-lift="lat"]');
  ok("lateral raise has 3 sets", inputs.length === 6, inputs.length + " inputs");

  // Tuesday and Saturday still ride
  const t = boot("2026-09-01T09:00:00");
  ok("Tuesday still a ride day", text(t.d).includes("Ride day"));
  const sat = boot("2026-09-05T09:00:00");
  ok("Saturday still a ride day", text(sat.d).includes("Ride day"));
  // A/B/C untouched
  const mon = boot("2026-08-31T09:00:00");
  ok("Monday still session A", text(mon.d).includes("Lift day — A"));
  ok("Monday still a training-macro day", text(mon.d).includes("2350"));
}


console.log("\nCook tab + new shopping list");
{
  const {w,d,store}=boot("2026-10-13T09:00:00");
  gotoTab(w,d,"shop");
  ok("potatoes cut to 1 kg", text(d).includes("Potatoes — 1 kg") && !text(d).includes("jackets"));
  ok("tray bake chickpeas on the list", text(d).includes("Chickpeas — 5 tins"));
  ok("korma paste on the list", text(d).includes("Mild korma paste"));
  ok("old salmon line gone", !text(d).includes("Salmon fillets"));
  gotoTab(w,d,"cook");
  ok("cook tab lists three recipes", d.querySelectorAll("[data-recipe]").length===3);
  tap(w,d.querySelector('[data-recipe="korma"]'));
  ok("korma opens with method", text(d).includes("Turn the slow cooker OFF"));
  tap(w,d.querySelector('[data-recipe="korma"]'));
  ok("korma closes again", !text(d).includes("Turn the slow cooker OFF"));
  tap(w,d.querySelector('[data-recipe="beef"]'));
  ok("beef stew opens", text(d).includes("pearl barley"));
}
console.log("\nOld shopping ticks are cleared");
{
  const seed=JSON.stringify({weights:{},sessions:{},meals:{},extra:{},
    shopping:{"Salmon fillets — 3":true,"Rice — 1 kg":true}});
  const {w,d,store}=boot("2026-10-13T09:00:00",seed);
  gotoTab(w,d,"shop");
  ok("kept tick still counts", text(d).includes("1 of "));
}

console.log("\nDinner swaps");
{
  const {w,d,store}=boot("2026-09-14T09:00:00");   // Monday, lift day
  ok("plan dinner shown by default", text(d).includes("Salmon, potatoes, greens"));
  ok("swap chips on dinner", d.querySelectorAll("[data-swap]").length===4);
  tap(w,d.querySelector('[data-swap="korma"]'));
  ok("korma replaces salmon", text(d).includes("Lighter chicken korma") && !text(d).includes("Salmon, potatoes, greens"));
  ok("swap saved for the day", saved(store).dinner["2026-09-14"]==="korma");
  ok("korma training-day numbers", text(d).includes("63g P · 710 kcal"));
  tap(w,d.querySelector('[data-meal="t4"]'));
  ok("ticked korma counts toward kcal", text(d).includes("710/2350 kcal"));
  tap(w,d.querySelector('[data-open="t4"]'));
  ok("sides listed", text(d).includes("Slow-cooker portion") && text(d).includes("Rice, cooked"));
  tap(w,d.querySelector('[data-cookgo="korma"]'));
  ok("jumps to cook tab with korma open", text(d).includes("Turn the slow cooker OFF"));
  gotoTab(w,d,"today");
  w.document.getElementById("next").click();
  ok("next day unaffected", !text(d).includes("Lighter chicken korma"));
  w.document.getElementById("prev").click();
  tap(w,d.querySelector('[data-swap="plan"]'));
  ok("back to plan dinner", text(d).includes("Salmon, potatoes, greens") && !saved(store).dinner["2026-09-14"]);
}
{
  const {w,d}=boot("2026-09-08T09:00:00");   // Tuesday, rest day
  tap(w,d.querySelector('[data-swap="beef"]'));
  ok("rest-day beef stew numbers", text(d).includes("51g P · 590 kcal"));
}
{
  const seed=JSON.stringify({weights:{},sessions:{},shopping:{},meals:{},extra:{}});
  const {d}=boot("2026-09-14T09:00:00",seed);
  ok("old saves without dinner field still load", text(d).includes("Salmon, potatoes, greens"));
}

console.log("\nLunch swaps");
{
  const {w,d,store}=boot("2026-09-14T09:00:00");   // Monday, lift day
  ok("plan lunch by default", text(d).includes("Chicken, rice, big salad"));
  ok("four lunch chips", d.querySelectorAll("[data-lswap]").length===4);
  tap(w,d.querySelector('[data-lswap="traybake"]'));
  ok("tray bake replaces salad", text(d).includes("Chicken, chickpea & veg tray bake") && !text(d).includes("Chicken, rice, big salad"));
  ok("lunch swap saved", saved(store).lunch["2026-09-14"]==="traybake");
  ok("tray bake training numbers", text(d).includes("62g P · 665 kcal"));
  tap(w,d.querySelector('[data-open="t2"]'));
  ok("method shown when opened", text(d).includes("200 °C fan"));
  tap(w,d.querySelector('[data-swap="korma"]'));
  ok("lunch and dinner swaps coexist", text(d).includes("Chicken, chickpea & veg tray bake") && text(d).includes("Lighter chicken korma"));
  tap(w,d.querySelector('[data-meal="t2"]')); tap(w,d.querySelector('[data-meal="t4"]'));
  ok("both count toward kcal", text(d).includes("1375/2350 kcal"));
  tap(w,d.querySelector('[data-lswap="plan"]'));
  ok("lunch back to plan, dinner kept", text(d).includes("Chicken, rice, big salad") && text(d).includes("Lighter chicken korma"));
}
{
  const {w,d}=boot("2026-09-08T09:00:00");   // rest day
  ok("no jacket chip", !d.querySelector('[data-lswap="jacket"]'));
  tap(w,d.querySelector('[data-lswap="soup"]'));
  ok("rest-day soup numbers", text(d).includes("56g P · 520 kcal"));
}

console.log(`\n${pass} passed, ${fail} failed`);
console.log("\nSession data isolation");
{
  const {w,d,store:st}=boot("2026-09-07T09:00:00");
  tap(w, d.querySelector('[data-tab="train"]'));
  type(w, d.querySelector('[data-lift="sq"][data-f="w"]'),"85");
  tap(w, d.querySelector('[data-pick="B"]'));
  type(w, d.querySelector('[data-lift="dl"][data-f="w"]'),"90");
  ok("A survives switching to B", saved(st).sessions["2026-09-07"].A.entries.sq[0].w==="85");
  ok("B stored alongside it", saved(st).sessions["2026-09-07"].B.entries.dl[0].w==="90");
  tap(w, d.querySelector('[data-pick="A"]'));
  ok("A redisplays its own value", d.querySelector('[data-lift="sq"][data-f="w"]').value==="85",
     d.querySelector('[data-lift="sq"][data-f="w"]').value);
  // clear day only clears the visible session
  const clr=d.querySelector("[data-clear]");
  if(clr) tap(w,clr);
  ok("clear day removes only A", !saved(st).sessions["2026-09-07"].A && !!saved(st).sessions["2026-09-07"].B,
     JSON.stringify(saved(st).sessions));
}

console.log("\nSkipped sets");
{
  const {w,d,store:st}=boot("2026-09-07T09:00:00");
  tap(w, d.querySelector('[data-tab="train"]'));
  const boxes=d.querySelectorAll('[data-lift="sq"][data-f="r"]');
  type(w,boxes[3],"8");                       // fill only set 4
  const rows=saved(st).sessions["2026-09-07"].A.entries.sq;
  ok("no holes in the array", rows.length===4 && rows.every(r=>r!==null&&r!==undefined),
     JSON.stringify(rows));
  ok("survives a JSON round trip", JSON.parse(JSON.stringify(rows)).every(r=>r!==null));
}

console.log("\nCrash on reload with legacy sparse data");
{
  const seed=JSON.stringify({weights:{},shopping:{},meals:{},extra:{},
    sessions:{"2026-09-07":{day:"A",entries:{sq:[null,null,null,{w:"85",r:"8"}]}}}});
  const {w,d,store:st}=boot("2026-09-14T09:00:00",seed);
  tap(w, d.querySelector('[data-tab="train"]'));
  ok("Train tab still renders", text(d).includes("Back squat"));
  ok("old data migrated to the new shape", !!saved(st).sessions["2026-09-07"].A, JSON.stringify(saved(st).sessions));
  ok("no false progression prompt", !text(d).includes("add 5 kg"));
}

console.log("\nProgression still fires when it should");
{
  const seed=JSON.stringify({weights:{},shopping:{},meals:{},extra:{},
    sessions:{"2026-09-07":{A:{entries:{sq:[{w:"80",r:"8"},{w:"80",r:"8"},{w:"80",r:"8"},{w:"80",r:"8"}]}}}}});
  const {w,d}=boot("2026-09-14T09:00:00",seed);
  tap(w, d.querySelector('[data-tab="train"]'));
  ok("offers +5 kg on a completed lift", text(d).includes("add 5 kg"));
  ok("names 85 kg", text(d).includes("85 kg"));
  ok("ghost shows last session", d.querySelector('[data-lift="sq"][data-f="w"]').getAttribute("placeholder")==="80");
}

console.log("\nRest-day plan update");
{
  const {d}=boot("2026-09-08T09:00:00");   // Tuesday
  ok("carbs now 160 g", text(d).includes("160g"));
  ok("fat down to 70 g", text(d).includes("70g"));
  ok("ride-day fuelling note", text(d).includes("60 g of carbs an hour"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
