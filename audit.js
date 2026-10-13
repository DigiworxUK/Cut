const fs=require("fs"); const {JSDOM,VirtualConsole}=require("jsdom");
const HTML=fs.readFileSync("index.html","utf8");
let pass=0,fail=0,errs=[];
const ok=(n,c,x)=>{ if(c){pass++;} else {fail++; console.log("  FAIL "+n+(x?" → "+x:""));} };
function boot(date,seed){
  const store=seed?{"thecut.v1":seed}:{}; const vc=new VirtualConsole(); const local=[];
  vc.on("jsdomError",e=>{ if(!/Not implemented/.test(e.message)) local.push(e.message); });
  vc.on("error",e=>local.push(String(e)));
  const dom=new JSDOM(HTML,{runScripts:"dangerously",pretendToBeVisual:true,url:"https://x.github.io/cut/",virtualConsole:vc,
    beforeParse(w){ Object.defineProperty(w,"localStorage",{value:{getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>{delete store[k]}}});
      const R=w.Date; class D extends R{constructor(...a){return a.length?new R(...a):new R(date)} static now(){return new R(date).getTime()}} w.Date=D;
      w.addEventListener("error",e=>local.push(e.message)); }});
  return {w:dom.window,d:dom.window.document,store,local};
}
const tap=(w,el)=>el.dispatchEvent(new w.MouseEvent("click",{bubbles:true}));
const view=d=>d.getElementById("view").textContent;
const bad=t=>/undefined|NaN|\[object|null g|Infinity/.test(t);

// 1. syntax
const scripts=[...HTML.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
scripts.forEach((s,i)=>{ fs.writeFileSync("/tmp/s"+i+".js",s); });
scripts.forEach((s,i)=>{ if(!s.trim()) return; try{ new Function(s); ok("inline script "+i+" parses",true);}catch(e){ ok("inline script "+i+" parses",false,e.message);} });
ok("sw.js parses",(()=>{try{new Function(fs.readFileSync("sw.js","utf8"));return true}catch(e){return false}})());

// 2. crawl 14 days x every tab x every tappable thing
console.log("Crawl: 14 days, every tab, every button");
let taps=0;
for(let n=0;n<14;n++){
  const day=new Date(Date.UTC(2026,9,12+n,9)).toISOString();
  const {w,d,local}=boot(day);
  for(const tab of ["today","train","shop","cook","log"]){
    tap(w,d.querySelector(`[data-tab="${tab}"]`));
    ok(`${day.slice(0,10)} ${tab} renders clean`,!bad(view(d)),view(d).match(/.{0,40}(undefined|NaN|\[object|Infinity).{0,20}/)?.[0]);
    if(tab==="today"||tab==="cook"||tab==="shop"){
      const sels=["[data-open]","[data-recipe]","[data-lswap]","[data-swap]","[data-meal]","[data-shop]"];
      for(const sel of sels){
        const count=d.querySelectorAll(sel).length;
        for(let i=0;i<count;i++){ const el=d.querySelectorAll(sel)[i]; if(!el) continue; tap(w,el); taps++;
          if(tab!==(d.querySelector("nav .on")||{}).dataset?.tab) tap(w,d.querySelector(`[data-tab="${tab}"]`));
          if(bad(view(d))) ok(`${day.slice(0,10)} ${tab} after ${sel}#${i}`,false,view(d).match(/.{0,40}(undefined|NaN).{0,20}/)?.[0]); }
      }
    }
  }
  ok(`${day.slice(0,10)} no runtime errors`,local.length===0,local.join(" | "));
}
console.log("  taps performed:",taps);

// 3. every lunch x dinner combo on lift, accessory, rest days: totals correct
console.log("Swap combos");
const MON="2026-10-12T09:00:00",THU="2026-10-15T09:00:00",TUE="2026-10-13T09:00:00";
for(const day of [MON,TUE,THU]){
  const {w,d}=boot(day);
  const L=[...d.querySelectorAll("[data-lswap]")].map(e=>e.dataset.lswap), D=[...d.querySelectorAll("[data-swap]")].map(e=>e.dataset.swap);
  ok(day+" has lunch+dinner chips",L.length===4&&D.length===4,`L${L.length} D${D.length}`);
  for(const l of L) for(const dn of D){
    tap(w,d.querySelector(`[data-lswap="${l}"]`)); tap(w,d.querySelector(`[data-swap="${dn}"]`));
    // tick all, read eyebrow totals, compare against per-row numbers
    for(let k=0;k<4;k++){ const b=d.querySelectorAll("[data-meal]")[k]; if(!b.querySelector(".tick.on")) tap(w,b); }
    const rows=[...d.querySelectorAll("[data-open] .sub")].map(e=>e.textContent);
    const sumK=rows.reduce((a,r)=>a+Number((r.match(/(\d+) kcal/)||[])[1]||0),0);
    const sumP=rows.reduce((a,r)=>a+Number((r.match(/(\d+)g P/)||[])[1]||0),0);
    const eb=d.querySelector(".panel:nth-child(2) .eyebrow").textContent;
    const m=eb.match(/(\d+)\/\d+ g protein · (\d+)\/\d+ kcal/);
    ok(`${day.slice(5,10)} ${l}+${dn} totals match rows`,m&&+m[1]===sumP&&+m[2]===sumK,`${eb} vs ${sumP}P ${sumK}kcal`);
    for(let k=0;k<4;k++){ const b=d.querySelectorAll("[data-meal]")[k]; if(b.querySelector(".tick.on")) tap(w,b); }
  }
}

// 4. stale / legacy data
console.log("Stale and legacy data");
{
  const seed=JSON.stringify({weights:{"2026-10-10":88},sessions:{},meals:{},extra:{},
    shopping:{"Salmon fillets — 3":true,"Rice — 1 kg":true},
    lunch:{"2026-10-12":"stirfry","2026-10-13":"jacket"},dinner:{"2026-10-12":"tagine"}});
  const {w,d,local}=boot(MON,seed);
  ok("removed lunch falls back to plan",view(d).includes("Chicken, rice, big salad"));
  ok("unknown dinner falls back to plan",view(d).includes("Salmon, potatoes, greens"));
  ok("plan chip shows selected for stale lunch",d.querySelector('[data-lswap="plan"]').style.background.includes("ochre")||d.querySelector('[data-lswap="plan"]').outerHTML.includes("var(--ochre)"));
  tap(w,d.querySelector('[data-tab="shop"]'));
  ok("old shopping ticks dropped, live kept",/^1 of /.test(view(d).trim()),view(d).slice(0,30));
  ok("no errors with stale data",local.length===0,local.join("|"));
}
{
  const {d,local}=boot(MON,"{not json");
  ok("corrupt storage still boots",view(d).includes("Targets")&&local.length===0,local.join("|"));
}
{
  const {d,local}=boot(MON,JSON.stringify({weights:{}}));
  ok("minimal storage boots",view(d).includes("Targets")&&local.length===0,local.join("|"));
}

// 5. persistence across reload
console.log("Persistence");
{
  const a=boot(MON); tap(a.w,a.d.querySelector('[data-lswap="soup"]')); tap(a.w,a.d.querySelector('[data-swap="beef"]'));
  const b=boot(MON,a.store["thecut.v1"]);
  ok("swaps survive reload",view(b.d).includes("Chicken & red lentil soup")&&view(b.d).includes("Lean beef, barley"));
}

// 6. import of an older export file keeps new fields working
console.log("Import");
{
  const {w,d,store,local}=boot(MON);
  tap(w,d.querySelector('[data-swap="chilli"]'));
  const S=JSON.parse(store["thecut.v1"]);
  ok("export would include lunch + dinner",("lunch" in S)&&("dinner" in S));
}

// 7. shopping list integrity
console.log("Shopping list");
{
  const {w,d}=boot(MON); tap(w,d.querySelector('[data-tab="shop"]'));
  const items=[...d.querySelectorAll("[data-shop]")].map(e=>e.dataset.shop);
  ok("no duplicate items",new Set(items).size===items.length);
  ok("no jacket/stir-fry/tagine leftovers",!/jacket|stir|tagine|apricot|cinnamon/i.test(items.join()));
  const needs=["korma paste","Ground almonds","Pearl barley","Red lentils","Chickpeas — 5","Black beans","Kidney beans","Butter beans","Sweet potatoes","Cauliflower","ginger","Swede","Celery","Courgettes","Spinach","Mushrooms","Lean diced beef"];
  needs.forEach(n=>ok("list covers "+n,items.some(i=>i.toLowerCase().includes(n.toLowerCase()))));
  tap(w,d.querySelector("[data-shop]")); tap(w,d.querySelector("[data-reset]"));
  ok("reset week clears ticks",/^0 of /.test(view(d).trim()));
}

// 8. HTML hygiene
console.log("HTML hygiene");
{
  const {d}=boot(MON);
  const ids=[...d.querySelectorAll("[id]")].map(e=>e.id);
  ok("no duplicate ids",new Set(ids).size===ids.length);
  ok("viewport meta",!!d.querySelector('meta[name=viewport]'));
  ok("tab bar has 5 tabs",d.querySelectorAll("#tabs [data-tab]").length===5);
}
console.log(`\n${pass} passed, ${fail} failed`);
