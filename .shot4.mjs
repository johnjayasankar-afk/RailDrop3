import { chromium } from 'playwright';
const base='http://127.0.0.1:3212';
const b=await chromium.launch();
for (const theme of ['light','dark']) {
for (const w of [1440,390]) {
  const ctx=await b.newContext({viewport:{width:w,height:900},deviceScaleFactor:1,colorScheme:theme});
  const p=await ctx.newPage();
  await p.goto(base+'/',{waitUntil:'networkidle'});
  const r = await p.evaluate(()=>{
    function lum(c){const m=c.match(/[\d.]+/g).map(Number);const f=m.slice(0,3).map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)});return 0.2126*f[0]+0.7152*f[1]+0.0722*f[2];}
    function bgOf(el){let e=el;while(e){const b=getComputedStyle(e).backgroundColor;if(b&&!/rgba\(0, 0, 0, 0\)|transparent/.test(b))return b;e=e.parentElement;}return 'rgb(255,255,255)';}
    const picks=[['hero eyebrow','.lookup-eyebrow .micro'],['sample board label','.ticket p.text-\\[10px\\]'],['board foot','.ticket .timetable > p'],['spec label','.spec-cell .micro'],['spec copy','.spec-copy'],['closer foot','.closer-foot'],['hero note','form.hero-search + p'],['faq summary','.faq summary'],['from input','.hero-field input'],['step copy','.step-list li']];
    return picks.map(([n,sel])=>{const el=document.querySelector(sel);if(!el)return[n,'MISSING'];const cs=getComputedStyle(el);const fg=cs.color;const bg=bgOf(el);const l1=lum(fg),l2=lum(bg);const cr=(Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);return [n, cs.fontSize, fg, bg, cr.toFixed(2)];});
  });
  console.log('==',theme,w); r.forEach(x=>console.log('  ',x.join(' | ')));
  await ctx.close();
}}
await b.close();
