// @ts-check
// In-page image generators shared by the duplication specs (crossfig-dup, within-dup):
// deterministic LCG textures and exact transforms (GEN), and the realistic blots, plates,
// letterboxed fields, grids and lattices of the false-positive benchmarks (GEN_REAL).
// Each is a script string for page.addScriptTag.
// In-page generators: deterministic LCG textures (no Math.random) and exact transforms.
const GEN = `
window.__mkTex = function(seed, w, h){
  let s = seed >>> 0;
  const rnd = () => (s = (1664525 * s + 1013904223) >>> 0) / 2 ** 32;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  const cell = 24, gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2, g = [];
  for (let i = 0; i < gw * gh; i++) g.push(rnd());
  const im = x.createImageData(w, h);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const fx = xx / cell, fy = yy / cell, x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0;
    const v = (g[y0*gw+x0]*(1-ax) + g[y0*gw+x0+1]*ax)*(1-ay) + (g[(y0+1)*gw+x0]*(1-ax) + g[(y0+1)*gw+x0+1]*ax)*ay;
    const i = (yy * w + xx) * 4, t = 40 + v * 120;
    im.data[i] = im.data[i+1] = im.data[i+2] = t; im.data[i+3] = 255;
  }
  x.putImageData(im, 0, 0);
  for (let b = 0, nb = Math.round(w * h / 2500); b < nb; b++) {
    const r = 3 + rnd() * 14, cx = rnd() * w, cy = rnd() * h, l = Math.round(rnd() * 255);
    x.fillStyle = 'rgb(' + l + ',' + l + ',' + l + ')'; x.beginPath();
    x.ellipse(cx, cy, r, r * (0.4 + rnd()), rnd() * 3, 0, 7); x.fill();
  }
  return c;
};
// k: 0-3 clockwise quarter turns, +4 = mirrored left-right first. Built with canvas
// transforms, independently of the app's own mapping, so the NAMES are checked too.
window.__tf = function(src, k, scale){
  const W = src.width, H = src.height, odd = k & 1, Wk = odd ? H : W, Hk = odd ? W : H;
  const c = document.createElement('canvas'); c.width = Math.round(Wk * scale); c.height = Math.round(Hk * scale);
  const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
  x.scale(c.width / Wk, c.height / Hk);
  const r = k & 3;
  if (r === 1) { x.translate(H, 0); x.rotate(Math.PI / 2); }
  else if (r === 2) { x.translate(W, H); x.rotate(Math.PI); }
  else if (r === 3) { x.translate(0, W); x.rotate(-Math.PI / 2); }
  if (k >= 4) { x.translate(W, 0); x.scale(-1, 1); }
  x.drawImage(src, 0, 0);
  return c;
};
window.__crop = function(src, sx, sy, w, h){ const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(src, sx, sy, w, h, 0, 0, w, h); return c; };
window.__flat = function(kind, w, h, seed){
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
  if (kind === 'blank') { x.fillStyle = '#808080'; x.fillRect(0, 0, w, h); }
  else if (kind === 'saturated') { x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h); }
  else { const im = x.createImageData(w, h); let s = seed >>> 0;
    for (let i = 0; i < im.data.length; i += 4) { s = (1664525 * s + 1013904223) >>> 0; const v = s >>> 24; im.data[i] = im.data[i+1] = im.data[i+2] = v; im.data[i+3] = 255; }
    x.putImageData(im, 0, 0); }
  return c;
};
// A panel of THIS figure, through the app's real import path.
window.__commit = function(canvas, name){
  const u = canvas.toDataURL('image/png');
  return new Promise(res => { const im = new Image(); im.onload = () => { _commitImage(im, u, name); res(); }; im.src = u; });
};
window.__others = function(list){ return list.map(([label, c]) => ({ label, fig: label, kind: 'file', load: async () => ({ src: c }) })); };
window.__pngFile = function(canvas, name){ return new Promise(r => canvas.toBlob(b => r(new File([b], name, { type: 'image/png' })), 'image/png')); };
`;

const GEN_REAL = `
window.__rng=function(seed){ let s=seed>>>0; return ()=>{ s=(Math.imul(s,1664525)+1013904223)>>>0; return s/4294967296; }; };
window.__gauss=function(r){ return Math.sqrt(-2*Math.log(r()+1e-12))*Math.cos(2*Math.PI*r()); };
window.__fromF=function(W,H,f){ const c=document.createElement('canvas'); c.width=W; c.height=H; const x=c.getContext('2d'), im=x.createImageData(W,H);
  for(let j=0;j<H;j++) for(let i=0;i<W;i++){ const v=f(i,j); const o=(j*W+i)*4; const vv=Array.isArray(v)?v:[v,v,v];
    im.data[o]=Math.max(0,Math.min(255,Math.round(vv[0]))); im.data[o+1]=Math.max(0,Math.min(255,Math.round(vv[1]))); im.data[o+2]=Math.max(0,Math.min(255,Math.round(vv[2]))); im.data[o+3]=255; }
  x.putImageData(im,0,0); return c; };
// western blot: lanes, bands at fixed rows with random amplitudes; the seed changes noise, jitter, smile, blotches
window.__wblot=function(o){ const r=__rng(o.seed||1); const W=o.w||480, H=o.h||200, n=o.lanes||6, pitch=(W-40)/n, lw=pitch*0.7;
  const bands=o.bands||[{y:60,s:4},{y:120,s:5}]; const amps=[]; for(let k=0;k<n;k++) amps.push(bands.map((b,bi)=>(o.amp?o.amp(k,bi):60+40*r())*(1+(o.ampJit||0.15)*(r()-0.5))));
  const jy=[]; for(let k=0;k<n;k++) jy.push(bands.map(()=>(o.yJit==null?1.5:o.yJit)*(r()-0.5)*2));
  const blot=[]; for(let q=0;q<(o.blotches==null?6:o.blotches);q++) blot.push([r()*W,r()*H,10+30*r(),5+10*r()]);
  const nr=__rng((o.seed||1)*7919+3);
  return __fromF(W,H,(i,j)=>{ let s=0; for(let k=0;k<n;k++){ const x0=20+k*pitch+(pitch-lw)/2; if(i<x0||i>=x0+lw) continue; const u=(i-x0)/lw-0.5; const smile=(o.smile||3)*u*u*4;
      bands.forEach((b,bi)=>{ const y=b.y+jy[k][bi]-smile; s+=amps[k][bi]*Math.exp(-((j-y)**2)/(2*b.s*b.s))*(1-0.3*Math.pow(Math.abs(2*u),4)); }); }
    let bg=(o.bg||225)-(o.grad||0)*j/H; blot.forEach(([bx,by,br,ba])=>{ bg-=ba*Math.exp(-((i-bx)**2+(j-by)**2)/(2*br*br)); });
    return bg-s+(o.noise==null?3:o.noise)*__gauss(nr); }); };
window.__cells=function(seed,W,H,o){ o=o||{}; const r=__rng(seed); const n=o.n||Math.round(W*H/1800); const cs=[]; for(let q=0;q<n;q++) cs.push([r()*W,r()*H,(o.rad||9)*(0.7+0.6*r()),0.6+0.8*r(),r()*3.14,0.6+0.4*r()]);
  const nr=__rng(seed*31+7); const bgv=o.bg||40;
  return __fromF(W,H,(i,j)=>{ let v=bgv+8*Math.sin(i/90+seed)*Math.cos(j/70); for(const [cx,cy,rr,e,a,b] of cs){ const dx=i-cx, dy=j-cy; if(Math.abs(dx)>rr*2.2||Math.abs(dy)>rr*2.2) continue; const ca=Math.cos(a), sa=Math.sin(a); const u=(dx*ca+dy*sa)/rr, w=(-dx*sa+dy*ca)/(rr*e); const d=u*u+w*w; v+=(o.amp||140)*b*Math.exp(-d*1.5); }
    return v+(o.noise==null?4:o.noise)*__gauss(nr); }); };
window.__plate=function(seed,W,H,o){ o=o||{}; const r=__rng(seed); const n=o.n||60; const ps=[]; for(let q=0;q<n;q++){ const a=r()*6.283, d=Math.sqrt(r())*0.42*Math.min(W,H); ps.push([W/2+d*Math.cos(a),H/2+d*Math.sin(a),(o.rad||5)*(0.7+0.6*r())]); }
  const nr=__rng(seed*13+1); const R=0.46*Math.min(W,H);
  return __fromF(W,H,(i,j)=>{ const dd=Math.hypot(i-W/2,j-H/2); if(dd>R+3) return 20+3*__gauss(nr); if(dd>R) return 230; let v=170+10*Math.sin(i/37+seed)*Math.sin(j/41);
    for(const [px,py,pr] of ps){ const q=Math.hypot(i-px,j-py); if(q<pr+1.5) v-=110*Math.max(0,Math.min(1,(pr+1.5-q)/1.5)); }
    return v+5*__gauss(nr); }); };
window.__hemo=function(seed,W,H,o){ o=o||{}; const r=__rng(seed); const ox=o.ox!=null?o.ox:r()*50, oy=o.oy!=null?o.oy:r()*50, P=o.P||50; const cells=[]; for(let q=0;q<(o.n||25);q++) cells.push([r()*W,r()*H,4+2*r()]);
  const nr=__rng(seed*17+5);
  return __fromF(W,H,(i,j)=>{ let v=180; const gx=((i-ox)%P+P)%P, gy=((j-oy)%P+P)%P; if(gx<2||gy<2) v-=90; if(((i-ox)%(P/4)+P)%(P/4)<1 && ((Math.floor((j-oy)/P)%2+2)%2===0)) v-=40;
    for(const [cx,cy,cr] of cells){ const q=Math.hypot(i-cx,j-cy); if(q<cr) v-=60*(1-q/cr)+20; }
    return v+4*__gauss(nr); }); };
window.__lattice=function(seed,W,H,o){ o=o||{}; const r=__rng(seed); const p1=r()*6.28,p2=r()*6.28, per=o.per||12; const nr=__rng(seed*3+9); const defects=[]; for(let q=0;q<8;q++) defects.push([r()*W,r()*H,10+20*r()]);
  return __fromF(W,H,(i,j)=>{ let v=128+40*Math.cos(2*Math.PI*i/per+p1)+40*Math.cos(2*Math.PI*(0.5*i+0.866*j)/per+p2); for(const [dx,dy,dr] of defects){ const q=Math.hypot(i-dx,j-dy); if(q<dr) v=128+(v-128)*(q/dr); } return v+(o.noise==null?20:o.noise)*__gauss(nr); }); };
window.__stamp=function(c,o){ o=o||{}; const d=document.createElement('canvas'); d.width=c.width; d.height=c.height; const x=d.getContext('2d'); x.drawImage(c,0,0);
  if(o.letterbox){ x.fillStyle='#000'; x.fillRect(0,0,d.width,o.letterbox); x.fillRect(0,d.height-o.letterbox,d.width,o.letterbox); }
  if(o.bar!==false){ x.fillStyle='#fff'; x.fillRect(d.width-90,d.height-30-(o.letterbox||0),70,6); x.font='bold 14px sans-serif'; x.fillText('10 µm',d.width-80,d.height-36-(o.letterbox||0)); }
  if(o.label){ x.fillStyle='#fff'; x.font='bold 22px sans-serif'; x.fillText(o.label,8,26+(o.letterbox||0)); }
  return d; };
window.__timelapse=(dx)=>{ const r=__rng(77); const cs=[]; for(let q=0;q<60;q++) cs.push([r()*400,r()*300,7+4*r(),(r()-0.5)*2]); const nr=__rng(1000+dx);
  return __fromF(400,300,(i,j)=>{ let v=40; for(const [cx,cy,rr,vx] of cs){ const d=(i-cx-vx*dx)**2+(j-cy-dx*0.5)**2; v+=150*Math.exp(-d/(rr*rr)); } return v+4*__gauss(nr); }); };
window.__px=(c,f)=>{ const d=document.createElement('canvas'); d.width=c.width; d.height=c.height; const x=d.getContext('2d'); x.drawImage(c,0,0); const im=x.getImageData(0,0,d.width,d.height); const r=__rng(99);
  for(let i=0;i<im.data.length;i+=4){ const o=f(im.data[i],im.data[i+1],im.data[i+2],r); im.data[i]=o[0]; im.data[i+1]=o[1]; im.data[i+2]=o[2]; } x.putImageData(im,0,0); return d; };
window.__jpeg=async(c,q)=>{ const u=c.toDataURL('image/jpeg',q); const im=new Image(); await new Promise(r=>{im.onload=r; im.src=u;}); const d=document.createElement('canvas'); d.width=c.width; d.height=c.height; d.getContext('2d').drawImage(im,0,0); return d; };
window.__blur=(c,r)=>{ const d=document.createElement('canvas'); d.width=c.width; d.height=c.height; const x=d.getContext('2d'); x.filter='blur('+r+'px)'; x.drawImage(c,0,0); return d; };
// Every re-save the true-positive benchmark puts a copy through.
window.__tpSet=async(P,other)=>{
  const sc=(c,s)=>__tf(c,0,s), g=e=>__px(P,(r,gg,b)=>[255*Math.pow(r/255,e),255*Math.pow(gg/255,e),255*Math.pow(b/255,e)]);
  const montage=(c,o)=>{ const d=document.createElement('canvas'); d.width=c.width*2+10; d.height=c.height; const x=d.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,d.width,d.height); x.drawImage(o,0,0,c.width,c.height); x.drawImage(c,c.width+10,0); return d; };
  const noise=sd=>__px(P,(r,gg,b,R)=>{ const n=sd*__gauss(R); return [r+n,gg+n,b+n]; });
  return { copy:__crop(P,0,0,P.width,P.height),
    jpeg90:await __jpeg(P,0.9), jpeg50:await __jpeg(P,0.5), jpeg20:await __jpeg(P,0.2), jpeg5:await __jpeg(P,0.05),
    gamma04:g(0.4), gamma25:g(2.5), inverted:__px(P,(r,gg,b)=>[255-r,255-gg,255-b]),
    fireLUT:__px(P,(r)=>{ const t=r/255; return [255*Math.min(1,t*3),255*Math.max(0,Math.min(1,t*3-1)),255*Math.max(0,t*3-2)]; }),
    redOnly:__px(P,(r)=>[r,0,0]), blueOnly:__px(P,(r)=>[0,0,r]),
    blur1:__blur(P,1), blur2:__blur(P,2), blur3:__blur(P,3), blur4:__blur(P,4),
    noise10:noise(10), noise25:noise(25), noise50:noise(50),
    s045:sc(P,0.45), s050:sc(P,0.5), s070:sc(P,0.7), s150:sc(P,1.5), s200:sc(P,2.0), s220:sc(P,2.2),
    k1:__tf(P,1,1), k5s06:__tf(P,5,0.6), crop10:__crop(P,150,120,158,120), crop25:__crop(P,100,80,250,190),
    mirScaleCrop:__tf(__crop(P,60,40,300,240),4,1.5), montage:montage(P,other) };
};
// One pair through the real run: the class of its finding, or of its "alike" entry, or none.
window.__classOf=async(a,b)=>{ const r=await _xdRun([{label:'A',key:'A',load:async()=>({src:a})}], __others([['B',b]]), {});
  if(r.excluded.length) return 'excluded';
  if(r.findings.length) return r.findings[0].cls;
  if(r.alike.length) return r.alike[0].cls+' (not counted)';
  return 'none'; };
`;
module.exports = { GEN, GEN_REAL };
