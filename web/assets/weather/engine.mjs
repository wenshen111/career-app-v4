// V4 weather scene compositor. Source artwork is retained byte-for-byte at 1440×3120.
// All drawings use the same 480×1040 logical coordinate space; only the display
// framebuffer is sized to the device. No new image encodes or cropped derivatives.
const W = 480, H = 1040, PI = Math.PI, TAU = PI * 2;
const ROOT = new URL('./', import.meta.url);
const clamp = (v,a=0,b=1) => Math.max(a,Math.min(b,v));
const mix = (a,b,t) => a+(b-a)*t;
const mod = (x,n) => ((x%n)+n)%n;
const smooth = x => {x=clamp(x);return x*x*(3-2*x);};
const rand = seed => () => {seed = (Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const configs = {};
const folders = ['sunny','night','partly_cloudy','overcast','fog','drizzle','downpour','thunderstorm','snow','blizzard','hail','freezing_rain','wind','dust','heat','cyclone'];
function url(path){return new URL(path,ROOT).href;}
function canvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
function image(path,signal){
  return new Promise((resolve,reject)=>{
    const i = new Image(); i.decoding='async';
    const cancel=()=>{i.onload=i.onerror=null;i.removeAttribute('src');reject(new DOMException('Aborted','AbortError'));};
    if(signal.aborted){cancel();return;}
    signal.addEventListener('abort',cancel,{once:true});
    const end=()=>signal.removeEventListener('abort',cancel);
    i.onload=()=>{end();resolve(i);};i.onerror=()=>{end();reject(new Error('Image unavailable: '+path));};
    i.src=url(path);
  });
}
function grad(g,x,y,r,color){const p=g.createRadialGradient(x,y,0,x,y,r);p.addColorStop(0,color);p.addColorStop(1,'rgba(255,255,255,0)');return p;}
function glow(g,x,y,r,rgb,a){
  g.fillStyle=grad(g,x,y,r,'rgba('+rgb+','+a+')');g.fillRect(x-r,y-r,r*2,r*2);
}
function veil(g,top,bottom,a=1){g.save();g.globalAlpha=a;const gr=g.createLinearGradient(0,0,0,H);gr.addColorStop(0,top);gr.addColorStop(1,bottom);g.fillStyle=gr;g.fillRect(0,0,W,H);g.restore();}
function gust(t){return .22+.78*Math.pow(.5+.5*Math.sin(t*.73+.85*Math.sin(t*.31)),3);}
function spark(g,x,y,r,alpha){g.save();g.strokeStyle='rgba(246,253,255,'+alpha+')';g.lineWidth=.8;g.beginPath();g.moveTo(x-r,y);g.lineTo(x+r,y);g.moveTo(x,y-r);g.lineTo(x,y+r);g.stroke();g.restore();}
function stroke(g,points,width,color){g.strokeStyle=color;g.lineWidth=width;g.beginPath();points.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.stroke();}
function surface(g,c1,c2,height=70){const gr=g.createLinearGradient(0,H-height,0,H);gr.addColorStop(0,'rgba(255,255,255,0)');gr.addColorStop(.45,c1);gr.addColorStop(1,c2);g.fillStyle=gr;g.fillRect(0,H-height,W,height);}
function sprite(kind){
  const c=canvas(48,48),g=c.getContext('2d');g.translate(24,24);
  if(kind==='snow'){
    const gr=g.createRadialGradient(0,0,1,0,0,22);gr.addColorStop(0,'rgba(255,255,255,1)');gr.addColorStop(.34,'rgba(240,250,255,.95)');gr.addColorStop(.58,'rgba(221,239,255,.42)');gr.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=gr;g.fillRect(-24,-24,48,48);
    g.strokeStyle='rgba(255,255,255,.86)';g.lineWidth=1.5;
    for(let k=0;k<6;k++){g.save();g.rotate(k*TAU/6);g.beginPath();g.moveTo(0,0);g.lineTo(0,-13);g.moveTo(-4,-8);g.lineTo(0,-5);g.lineTo(4,-8);g.stroke();g.restore();}
  }else{
    g.beginPath();[[-15,-7],[-7,-18],[9,-16],[18,-3],[13,13],[-3,18],[-16,7]].forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.closePath();
    const gr=g.createLinearGradient(-12,-14,14,18);gr.addColorStop(0,'#fff');gr.addColorStop(.3,'#e5f4ff');gr.addColorStop(.62,'#b2d2eb');gr.addColorStop(1,'#69859d');g.fillStyle=gr;g.fill();g.strokeStyle='#d4f0ff';g.lineWidth=1;g.stroke();
    g.fillStyle='rgba(255,255,255,.74)';g.beginPath();g.moveTo(-15,-7);g.lineTo(-7,-18);g.lineTo(5,-12);g.lineTo(-4,1);g.closePath();g.fill();
    g.fillStyle='rgba(84,125,159,.32)';g.beginPath();g.moveTo(-4,1);g.lineTo(18,-3);g.lineTo(13,13);g.lineTo(-3,18);g.closePath();g.fill();
  }
  return c;
}
function signatures(id){
  const r=rand(3269+folders.indexOf(id)*97),range=(a,b)=>mix(a,b,r());
  const snowSprite=sprite('snow'),hailSprite=sprite('hail');
  const rainMode=['drizzle','downpour','thunderstorm','freezing_rain','cyclone'].includes(id);
  const snowy=id==='snow'||id==='blizzard';
  const particles=Array.from({length: id==='downpour'?340:id==='cyclone'?240:id==='blizzard'?235:id==='drizzle'?95:id==='thunderstorm'?205:id==='freezing_rain'?145:id==='snow'?150:id==='hail'?74:id==='dust'?110:0},(_,i)=>({
    x:r()*W,y:r()*H,phase:r()*TAU,d:i%3,s:r(),a:range(.4,1),impact:range(H-42,H-12),bounce:0,v:0
  }));
  const pool=Array.from({length:30},()=>({x:0,y:0,age:99,life:0,scale:1}));
  let poolAt=0, snowDepth=0;
  function hit(x,y,scale=1){const p=pool[poolAt++%pool.length];Object.assign(p,{x,y,age:0,life:range(.4,.9),scale});}
  const snowDune=Array.from({length:33},(_,i)=>({x:i*W/32, h:range(-6,6)+7*Math.sin(i*.42)+4*Math.cos(i*.91)}));
  const grain=Array.from({length:100},()=>({x:r()*W,y:r(),r:range(.4,1.8),a:range(.12,.5)}));
  const gusts=Array.from({length:15},(_,i)=>({x:r()*W,y:range(90,H-80),len:range(100,260),v:range(100,270),p:r()*TAU,a:range(.06,.18)}));
  // Pre-authored branching frost paths (anchored to the glass edge, not floating stars).
  const frost=[];
  if(id==='freezing_rain'){
    for(let i=0;i<22;i++){
      const left=i%2===0,x=left?-4:W+4,y=range(60,H-16),dir=left?1:-1, reach=range(16,62);
      const pts=[[x,y],[x+dir*reach*.38,y-11],[x+dir*reach*.7,y-4],[x+dir*reach,y-18]];
      frost.push({pts,at:range(1,20),width:range(.7,1.6)});
      for(let j=1;j<=2;j++){const [xx,yy]=pts[j];frost.push({pts:[[xx,yy],[xx+dir*reach*.17,yy-13],[xx+dir*reach*.22,yy-21]],at:range(4,24),width:.6});}
    }
  }
  const stars=Array.from({length:28},()=>({x:range(12,W-12),y:range(20,H*.61),r:range(.45,1.35),p:r()*TAU,sp:range(.55,1.9)}));
  // Lightning is one channel with connected leaders and tapering forks, not a white screen.
  let bolt=null,boltCycle=-1;
  function makeBolt(cycle){
    const rr=rand(7733+cycle*119),path=[],branches=[];
    let x=range(95,400),y=range(88,200),end=range(510,820),target=clamp(x+range(-120,90),55,W-55);
    path.push([x,y]);
    const steps=25;
    for(let i=1;i<=steps;i++){x=mix(x,target,.12)+(rr()-.5)*39;y+= (end-y)/(steps-i+1);path.push([x,y]);}
    for(let i of [4,8,12,16,20]){
      let [xx,yy]=path[i],d=rr()>.5?1:-1;const pts=[[xx,yy]];
      for(let j=0;j<5;j++){xx+=d*(7+rr()*15);yy+=8+rr()*19;pts.push([xx,yy]);}
      branches.push(pts);
      const [bx,by]=pts[2];branches.push([[bx,by],[bx-d*7,by+17],[bx-d*16,by+31]]);
    }
    return {path,branches};
  }
  function lightning(g,t){
    const cycle=Math.floor(t/8.4),age=mod(t,8.4)-1.65;
    if(age<0||age>.85)return;
    if(cycle!==boltCycle){bolt=makeBolt(cycle);boltCycle=cycle;}
    const flash=age<.085?1:age<.18?.22:age<.26?.85:Math.max(0,.38*(1-(age-.26)/.59));
    if(flash<.015)return;
    const [x,y]=bolt.path[0];glow(g,x,y,270,'186,199,255',flash*.48);
    glow(g,x,y+180,300,'153,170,239',flash*.11);
    g.save();g.lineJoin='round';g.lineCap='round';g.globalCompositeOperation='screen';
    for(const [w,a] of [[12,.07],[6,.17],[2.9,.54],[1.35,.98]]){
      stroke(g,bolt.path,w,'rgba(213,222,255,'+(a*flash)+')');
      for(let j=0;j<bolt.branches.length;j++)stroke(g,bolt.branches[j],w*(j%2?.23:.46),'rgba(212,225,255,'+(a*flash*.78)+')');
    }
    g.restore();
  }
  function windRibbons(g,t,color,strength=1){
    let p=gust(t);
    for(const b of gusts){
      const x=mod(b.x+t*b.v*(.5+strength),W+b.len*2)-b.len;
      const y=b.y+12*Math.sin(t*.8+b.p); const l=b.len*(.8+p*.35);
      const gr=g.createLinearGradient(x,y,x+l,y-16);gr.addColorStop(0,'rgba('+color+',0)');gr.addColorStop(.38,'rgba('+color+','+(b.a*p*strength)+')');gr.addColorStop(.79,'rgba('+color+','+(b.a*p*.45*strength)+')');gr.addColorStop(1,'rgba('+color+',0)');
      g.strokeStyle=gr;g.lineWidth=.8+b.a*9;g.beginPath();g.moveTo(x,y);g.bezierCurveTo(x+l*.35,y-16,x+l*.65,y+2,x+l,y-20);g.stroke();
    }
  }
  function rain(g,t,dt){
    const heavy=id==='downpour',freezing=id==='freezing_rain',cyclone=id==='cyclone',drizzle=id==='drizzle';
    const wind=gust(t),slope=heavy?-0.52-wind*.35:cyclone?-.66-.27*wind:freezing?-.22:drizzle?-.1:-.31;
    const speed=drizzle?185:heavy?610:cyclone?570:freezing?330:480;
    for(let d=0;d<3;d++){
      g.beginPath();
      for(const p of particles){if(p.d!==d)continue;
        const v=speed*(.54+d*.35)*(.7+p.s*.65),dx=cyclone?(slope+.20*Math.sin((p.y/H)*PI+t*.65))*v:slope*v;
        p.y+=v*dt;p.x+=dx*dt;
        if(p.y>p.impact){if(d!==0&&r()<.34)hit(clamp(p.x,0,W),p.impact,.5+d*.4);p.y=-range(8,135);p.x=range(0,W+80);}
        p.x=mod(p.x+75,W+150)-75;
        const len=(drizzle?7:freezing?21:heavy?34:cyclone?30:25)*(.55+d*.38)*(.65+p.s*.5);
        g.moveTo(p.x,p.y);g.lineTo(p.x-dx/v*len,p.y-len);
      }
      g.strokeStyle='rgba('+(freezing?'218,245,255':'218,234,249')+','+(drizzle?[.14,.25,.42]:heavy?[.20,.39,.66]:[.13,.27,.5])[d]+')';
      g.lineWidth=(drizzle?[.45,.65,.9]:freezing?[.6,1,1.6]:[.6,1.05,1.7])[d];g.lineCap='round';g.stroke();
    }
    if(heavy){
      // Broad sheets of slanting rain have a gust-driven volume, in addition to individual streaks.
      for(let k=0;k<4;k++){
        const x=mod(t*(96+k*12)+k*168,1020)-520;
        const gr=g.createLinearGradient(x,400,x+145,485);gr.addColorStop(0,'rgba(174,207,231,0)');gr.addColorStop(.5,'rgba(174,207,231,'+(.035+.065*wind)+')');gr.addColorStop(1,'rgba(174,207,231,0)');
        g.fillStyle=gr;g.beginPath();g.moveTo(x+440,0);g.lineTo(x+610,0);g.lineTo(x+12,H);g.lineTo(x-158,H);g.closePath();g.fill();
      }
      surface(g,'rgba(91,131,154,.12)','rgba(28,65,95,.27)',110);windRibbons(g,t,'208,230,242',.65);
    }else if(drizzle)surface(g,'rgba(169,206,225,.04)','rgba(99,151,182,.13)',65);
    if(freezing){
      surface(g,'rgba(218,249,255,.1)','rgba(184,226,245,.42)',70);
      for(const f of frost){const a=.14+smooth((t-f.at)/9)*.61;if(a>0)stroke(g,f.pts,f.width,'rgba(232,250,255,'+a+')');}
      for(let j=0;j<13;j++){
        const x=j%2?W-5-j*.7:5+j*.7,y=mod(t*(8+j*1.2)+j*89,H);
        const gr=g.createLinearGradient(x,y-32,x,y+4);gr.addColorStop(0,'rgba(239,251,255,0)');gr.addColorStop(1,'rgba(239,251,255,.76)');g.strokeStyle=gr;g.lineWidth=1.6;g.beginPath();g.moveTo(x,y-32);g.lineTo(x,y);g.stroke();if(Math.sin(t*2+j*4)>.97)spark(g,x,y,3,.8);
      }
    }
    for(const p of pool){p.age+=dt;if(p.age>p.life)continue;const a=p.age/p.life,rad=(3+19*a)*p.scale*(drizzle?.65:1);
      g.strokeStyle='rgba(230,246,255,'+(.45*(1-a))+')';g.lineWidth=drizzle?.7:1.1;g.beginPath();g.ellipse(p.x,p.y,rad,rad*.19,0,0,TAU);g.stroke();
      if(heavy||freezing){g.fillStyle='rgba(231,249,255,'+(.65*(1-a))+')';for(let j=0;j<5;j++){
        const xx=p.x+(j-2)*a*12*p.scale,yy=p.y-26*Math.sin(PI*a)*p.scale*(1-Math.abs(j-2)*.15);g.fillRect(xx,yy,1.5,2);
      }}
    }
  }
  function snow(g,t,dt){
    const storm=id==='blizzard',wind=gust(t);
    for(let d=0;d<3;d++){
      for(const p of particles){if(p.d!==d)continue;
        const v=(storm?63:23)*(d*.48+.55)*(.8+p.s*.55);
        const vx=storm?-(125+d*85)*(wind*.9+.5):10*Math.sin(t*.75+p.phase)+4*Math.cos(t*.4+p.phase);
        p.y+=v*dt;p.x+=vx*dt;
        if(p.y>H-8){if(!storm)snowDepth=Math.min(48,snowDepth+.12);p.y=-range(3,90);p.x=r()*W;}
        p.x=mod(p.x+20,W+40)-20;
        const s=(d===0?3:d===1?6:11)*(p.s*.78+.55);
        g.globalAlpha=(d===0?.44:d===1?.73:.9)*p.a;
        if(storm){g.strokeStyle='rgba(238,250,255,.85)';g.lineWidth=s*.30;g.lineCap='round';g.beginPath();g.moveTo(p.x,p.y);g.lineTo(p.x-vx*.075,p.y-v*.075);g.stroke();}
        else g.drawImage(snowSprite,p.x-s,p.y-s,s*2,s*2);
      }
    }
    g.globalAlpha=1;
    if(storm){surface(g,'rgba(240,249,255,.16)','rgba(223,240,249,.65)',130);windRibbons(g,t,'242,251,255',1.25);veil(g,'rgba(237,247,255,.035)','rgba(236,250,255,.16)',wind);}
    // Settled flakes accumulate along a soft undulating snow edge; never reset mid-loop.
    const dep=storm?30+Math.min(28,t*1.3):Math.min(56,5+t*1.75+snowDepth*.28);
    const ridge=H-dep;
    const gr=g.createLinearGradient(0,ridge-18,0,H);gr.addColorStop(0,'#f4fbff');gr.addColorStop(.45,'#e3eff6');gr.addColorStop(1,'#c6dce9');
    g.fillStyle=gr;g.beginPath();g.moveTo(0,H);snowDune.forEach(p=>g.lineTo(p.x,ridge+p.h*Math.min(1,dep/19)));g.lineTo(W,H);g.closePath();g.fill();
    for(const p of grain){g.fillStyle='rgba(255,255,255,'+p.a+')';g.beginPath();g.arc(p.x,ridge+12+p.y*Math.max(0,dep-13),p.r,0,TAU);g.fill();}
  }
  function hail(g,t,dt){
    surface(g,'rgba(204,229,243,.05)','rgba(108,151,181,.24)',70);
    for(const p of particles){
      const size=(p.d+1)*2.1+2*p.s,ground=p.impact;
      if(p.bounce===0){p.y+= (250+p.d*160)*dt;p.x-=34*dt;
        if(p.y>=ground){p.y=ground;p.bounce=1;p.v=-(90+p.s*145);hit(p.x,ground,.6);}}
      else{p.v+=520*dt;p.y+=p.v*dt;p.x+=(p.phase>PI?-1:1)*(28+p.s*25)*dt;
        if(p.y>=ground&&p.v>0){if(p.bounce<3&&p.v>55){p.v*=-.48;p.y=ground;p.bounce++;}
        else{p.bounce=0;p.y=-range(10,180);p.x=range(0,W);}}}
      p.x=mod(p.x,W);
      if(!p.bounce){g.strokeStyle='rgba(218,237,252,.25)';g.lineWidth=size*.5;g.beginPath();g.moveTo(p.x,p.y);g.lineTo(p.x+3,p.y-15-p.d*4);g.stroke();}
      else{g.fillStyle='rgba(44,72,100,.16)';g.beginPath();g.ellipse(p.x,ground+2,size*.8,size*.28,0,0,TAU);g.fill();}
      g.save();g.translate(p.x,p.y);g.rotate(p.phase+t*(.6+p.s));g.globalAlpha=.55+p.d*.2;g.drawImage(hailSprite,-size,-size,size*2,size*2);g.restore();
    }
    for(const p of pool){p.age+=dt;if(p.age>p.life)continue;const a=p.age/p.life;spark(g,p.x,p.y,6*a,.65*(1-a));}
  }
  function meteors(g,t){
    for(const s of stars){const a=.2+.65*Math.pow(.5+.5*Math.sin(t*s.sp+s.p),2);glow(g,s.x,s.y,s.r*2.5,'224,238,255',a*.55);g.fillStyle='rgba(233,243,255,'+a+')';g.fillRect(s.x,s.y,s.r,s.r);if(a>.8&&s.r>1.12)spark(g,s.x,s.y,2.7,a*.8);}
    const cycle=Math.floor(t/12),age=mod(t,12)-1.8;
    if(age>0&&age<1.35){const p=age/1.35,fade=Math.sin(PI*p),x=460-p*415,y=80+(cycle%3)*85+p*195,tail=85+45*fade;
      const gr=g.createLinearGradient(x,y,x+tail,y-tail*.48);gr.addColorStop(0,'rgba(251,252,255,'+fade+')');gr.addColorStop(.23,'rgba(197,224,255,'+fade*.74+')');gr.addColorStop(1,'rgba(175,215,255,0)');
      g.strokeStyle=gr;g.lineWidth=2.1;g.beginPath();g.moveTo(x,y);g.lineTo(x+tail,y-tail*.48);g.stroke();glow(g,x,y,10,'220,238,255',fade*.55);
    }
  }
  function solar(g,t,partial){
    const x=64,y=58,phase=.5+.5*Math.sin(t*.8);
    glow(g,x,y,125,'255,244,202',.12+.10*phase);
    const spread=partial?.07:.12;
    g.save();g.translate(x,y);g.rotate(.026*Math.sin(t*.38));g.globalCompositeOperation='screen';
    for(let i=0;i<6;i++){const a=.35+i*.14,L=490-i*36,ww=9+i*1.2;const gr=g.createLinearGradient(0,0,Math.cos(a)*L,Math.sin(a)*L);gr.addColorStop(0,'rgba(255,244,205,'+(spread*(.7+.3*phase))+')');gr.addColorStop(1,'rgba(255,244,205,0)');g.fillStyle=gr;g.beginPath();g.moveTo(0,0);g.lineTo(Math.cos(a-.025)*L,Math.sin(a-.025)*L-ww);g.lineTo(Math.cos(a+.025)*L,Math.sin(a+.025)*L+ww);g.closePath();g.fill();}
    g.restore();
    if(!partial){for(const [f,rr,a] of [[.30,23,.09],[.54,11,.16],[.79,43,.065]])glow(g,x+(W/2-x)*f,y+(H*.68-y)*f,rr,'255,239,189',a*(.6+.4*phase));}
  }
  function dust(g,t,dt){
    const wind=gust(t);veil(g,'rgba(175,114,57,.08)','rgba(218,162,97,.29)',wind);
    for(let d=0;d<3;d++){g.beginPath();for(const p of particles){if(p.d!==d)continue;const v=(85+d*70)*(1+wind);p.x=mod(p.x-v*dt,W);p.y=mod(p.y+Math.sin(t+p.phase)*14*dt,H);g.moveTo(p.x,p.y);g.lineTo(p.x+2+d*3,p.y+Math.sin(p.phase)*2);}g.strokeStyle='rgba(245,202,144,'+[.15,.31,.52][d]+')';g.lineWidth=.7+d*.65;g.stroke();}
    windRibbons(g,t,'255,218,164',.8);surface(g,'rgba(202,145,84,.07)','rgba(177,115,62,.32)',185);
  }
  return {draw(g,t,dt,paused){
    if(paused){t=0;dt=0;}
    switch(id){
      case 'sunny': if(!paused)solar(g,t,false);break;
      case 'night': if(!paused)meteors(g,t);break;
      case 'partly_cloudy': if(!paused){solar(g,t,true);const q=.5+.5*Math.sin(t*.47);veil(g,'rgba(36,67,99,.10)','rgba(41,86,126,.08)',q);}break;
      case 'overcast': if(!paused){const q=.5+.5*Math.sin(t*.3);veil(g,'rgba(33,53,74,.22)','rgba(53,82,103,.07)',q);}break;
      case 'fog': if(!paused){const q=.5+.5*Math.sin(t*.55);veil(g,'rgba(218,233,242,.07)','rgba(230,241,247,.29)',q);const x=mod(t*37,850)-200;glow(g,x,H*.69,300,'227,239,244',.15+.10*q);}break;
      case 'thunderstorm': if(!paused)lightning(g,t);break;
      case 'wind': if(!paused)windRibbons(g,t,'237,249,255',1.35);break;
      case 'dust': if(!paused)dust(g,t,dt);break;
      case 'heat': if(!paused){const q=.5+.5*Math.sin(t*1.3);glow(g,380,95,205,'255,229,157',.14+.07*q);surface(g,'rgba(255,230,179,.04)','rgba(248,216,166,.19)',300);}break;
      case 'cyclone': if(!paused){windRibbons(g,t,'208,235,250',.75);veil(g,'rgba(30,53,86,.08)','rgba(65,104,134,.13)',gust(t));}break;
    }
    if(rainMode)rain(g,t,dt);
    if(snowy)snow(g,t,dt);
    if(id==='hail')hail(g,t,dt);
  }};
}

// Single compositor, one animation clock. Aborted switch loads never replace a
// newer scene. The old frame remains visible until the new artwork is ready.
export function applyWeather(container,id,{motion='auto'}={}){
  const index=Math.max(0,folders.indexOf(id));id=folders[index];
  const folder=String(index+1).padStart(2,'0')+'_'+id+'/';
  const ctrl=new AbortController(),signal=ctrl.signal;
  if(container.__weatherPending)container.__weatherPending.destroy();
  const reducedMotion=!!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let paused=motion==='off'||(motion==='auto'&&reducedMotion),dead=false,started=false,raf=0,last=0,t=0;
  let layerList=[],bitmaps=[],fx=null,resize=null,heatBuffer=null,quality=1,slowFrames=0;
  const root=document.createElement('div');root.className='weather-v4-scene';root.dataset.state=id;
  Object.assign(root.style,{position:'absolute',inset:'0',overflow:'hidden',display:'grid',placeItems:'center',pointerEvents:'none',opacity:'0',transition:'opacity 280ms ease'});
  const cv=canvas(1,1),g=cv.getContext('2d',{alpha:false,desynchronized:true});
  Object.assign(cv.style,{display:'block',position:'absolute',inset:'0',margin:'auto',height:'100%',width:'100%',maxWidth:'min(100%, 54dvh)',objectFit:'fill'});
  root.append(cv);
  const staticCache=canvas(720,1560),sg=staticCache.getContext('2d');
  const handle={reducedMotion,ready:null,setPaused(value){if(paused===!!value)return;paused=!!value;last=0;if(started){cancelAnimationFrame(raf);raf=0;draw(paused?0:t,0,paused);if(!paused&&!document.hidden)raf=requestAnimationFrame(loop);}},destroy(){
    if(dead)return;dead=true;ctrl.abort();cancelAnimationFrame(raf);resize?.disconnect();document.removeEventListener('visibilitychange',visibility);root.remove();cv.width=cv.height=1;staticCache.width=staticCache.height=1; if(heatBuffer)heatBuffer.width=heatBuffer.height=1;
    for(const bitmap of bitmaps){if(bitmap instanceof HTMLImageElement)bitmap.removeAttribute('src');else if(bitmap instanceof HTMLCanvasElement){bitmap.width=bitmap.height=1;}else bitmap.close?.();}
    bitmaps=[];layerList=[];if(container.__weatherPending===handle)container.__weatherPending=null;if(container.__weatherActive===handle)container.__weatherActive=null;
  }};
  container.__weatherPending=handle;
  function layout(){
    if(dead)return;
    // Native images stay untouched. Phone-sized rasterisation limits GPU memory;
    // the complete source rectangle is mapped to the screen, never cover-cropped.
    const b=cv.getBoundingClientRect();const d=Math.min(1.65,window.devicePixelRatio||1)*quality;
    const k=Math.min(d,Math.sqrt(1100000/Math.max(1,b.width*b.height)));
    cv.width=Math.max(1,Math.round(b.width*k));cv.height=Math.max(1,Math.round(b.height*k));
    if(id==='heat'){heatBuffer ||= canvas(1,1);heatBuffer.width=cv.width;heatBuffer.height=cv.height;}
  }
  function layer(g,l,t,rest){
    const m=l.motion||{},p=l.placement;
    g.save();
    if(!p){
      if(!rest&&m.type==='breathe')g.globalAlpha=mix(m.minOpacity??.65,1,.5+.5*Math.sin(t*TAU/(id==='sunny'?7:m.periodSeconds||14)));
      if(!rest&&m.type==='twinkle')g.globalAlpha=.82+.18*Math.sin(t*.72);
      g.drawImage(l.img,0,0,W,H);g.restore();return;
    }
    const x=p.x/3,y=p.y/3,w=p.width/3,h=p.height/3;
    let dx=0,dy=0;
    const phase=m.phase||0;
    if(!rest){
      const speed=id==='wind'?4.8:id==='dust'?3.1:id==='fog'?2.8:id==='overcast'?2.6:id==='downpour'||id==='blizzard'?2.3:id==='partly_cloudy'?2.9:1.45;
      const amp=id==='wind'?2.2:id==='dust'?1.8:id==='fog'?2.0:1.4;
      const a=t*TAU/(m.periodSeconds||90)*speed+phase;
      dx=(m.dxPx||0)/3*amp*(Math.sin(a)-Math.sin(phase));
      dy=(m.dyPx||0)/3*(Math.sin(a*.8)-Math.sin(phase));
      if(id==='wind'||id==='blizzard'||id==='downpour')dx-=gust(t)*13;
      if(id==='fog'&&l.z>=43)g.globalAlpha=(.8+.2*Math.sin(a*.87));
    }
    g.globalAlpha*=p.opacity??1;
    if(id==='cyclone'&&l.component==='cyclone_spiral_mid'&&!rest){
      // Native painted eye (70%,40%) is the rotation pivot, so spiral arms
      // actually turn around a fixed eye instead of swinging a rectangle.
      const ex=x+w*.70,ey=y+h*.40;g.translate(ex,ey);g.rotate(t*.115);g.translate(-ex,-ey);
    }
    g.translate(x+w/2+dx,y+h/2+dy);g.rotate((p.rotationDegrees||0)*PI/180);g.scale(p.mirror?-1:1,1);
    g.drawImage(l.img,-w/2,-h/2,w,h);g.restore();
  }
  function draw(time,dt,rest){
    if(dead||!started)return;
    const ctx=id==='heat'&&!rest?heatBuffer.getContext('2d',{alpha:false}):g;
    ctx.setTransform(cv.width/W,0,0,cv.height/H,0,0);
    ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.drawImage(staticCache,0,0,W,H);
    for(const l of layerList)layer(ctx,l,time,rest);
    fx.draw(ctx,time,dt,rest);
    if(ctx!==g){
      // Real scene refraction, performed on a bounded display-resolution
      // buffer. No full-screen SVG turbulence and no UI distortion.
      g.setTransform(1,0,0,1,0,0);g.drawImage(heatBuffer,0,0);
      const height=cv.height,width=cv.width,strip=Math.max(2,Math.floor(height/155));
      for(let yy=0;yy<height;yy+=strip){
        const n=yy/height,ampl=(.8+5.7*smooth((n-.23)/.7))*width/W;
        const shift=(Math.sin(n*100-time*5.8)+.48*Math.sin(n*169+time*4.2))*ampl;
        g.drawImage(heatBuffer,0,yy,width,Math.min(strip,height-yy),shift,yy,width,Math.min(strip,height-yy));
      }
    }
  }
  function loop(now){
    if(dead||paused||document.hidden)return;
    if(!last)last=now;
    const elapsed=now-last;
    // Cap animation at ~40fps (30 for heat and storm-heavy scenes) and
    // lower only framebuffer pixel ratio if sustained device cost is high.
    const interval=['downpour','thunderstorm','snow','blizzard','hail','cyclone','heat','freezing_rain'].includes(id)||quality<.9?32:16;
    if(elapsed>=interval-2){
      const dt=Math.min(.09,elapsed/1000);last=now;t+=dt;
      const before=performance.now();draw(t,dt,false);
      if(performance.now()-before>22||elapsed>interval+24)slowFrames++;else slowFrames=Math.max(0,slowFrames-1);
      if(slowFrames>18&&quality>.68){quality*=.82;slowFrames=0;layout();}
    }
    raf=requestAnimationFrame(loop);
  }
  function visibility(){cancelAnimationFrame(raf);raf=0;last=0;if(!paused&&!document.hidden&&started)raf=requestAnimationFrame(loop);}
  handle.ready=(async()=>{
    try{
      const config=configs[id]||await fetch(url(folder+'layer_config.json'),{signal}).then(r=>{if(!r.ok)throw Error('Weather config '+r.status);return r.json();});
      configs[id]=config;const textureCache=new Map();
      // Fetch/decode serially to avoid a surge of 4.5-megapixel RGBA layers.
      // Original opaque base and atmospheric scatter are flattened only in RAM.
      for(const l of config.layers){
        if(signal.aborted)throw new DOMException('Aborted','AbortError');
        if(l.defaultVisible===false||!l.pngFile||['particles','lightning','heat'].includes(l.motion?.type))continue;
        if(l.placement&&l.texture){
          const path='textures/'+l.texture.split('/').pop();
          if(!textureCache.has(path)){const i=await image(path,signal);if(dead){i.removeAttribute('src');throw new DOMException('Aborted','AbortError');}textureCache.set(path,i);bitmaps.push(i);}
          layerList.push({...l,img:textureCache.get(path)});
        }else{
          const i=await image(folder+l.pngFile,signal);
          if(dead){i.removeAttribute('src');throw new DOMException('Aborted','AbortError');}
          if(l.z<=5){sg.drawImage(i,0,0,staticCache.width,staticCache.height);}
          else{const c=canvas(720,1560);c.getContext('2d').drawImage(i,0,0,c.width,c.height);layerList.push({...l,img:c});bitmaps.push(c);}
          i.removeAttribute('src');
        }
      }
      if(dead||container.__weatherPending!==handle)throw new DOMException('Aborted','AbortError');
      fx=signatures(id);const old=container.__weatherActive;
      container.append(root);container.__weatherActive=handle;container.__weatherPending=null;
      started=true;layout();draw(0,0,paused);
      root.style.opacity='1';old?.destroy();root.style.transition='none';
      // Match the side field on desktop preview, avoiding a crop of portrait artwork.
      const px=sg.getImageData(360,0,1,1).data,py=sg.getImageData(360,1559,1,1).data;
      container.style.background='linear-gradient(rgb('+[...px].slice(0,3)+'),rgb('+[...py].slice(0,3)+'))';
      resize=new ResizeObserver(()=>{layout();draw(t,0,paused);});resize.observe(container);
      document.addEventListener('visibilitychange',visibility);
      if(!paused&&!document.hidden)raf=requestAnimationFrame(loop);
      return handle;
    }catch(e){handle.destroy();throw e;}
  })();
  return handle;
}
