/* ===== Moteur (aucun accès au DOM) ===== */
const H=s=>{let h=2166136261;for(const c of s){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0};
const RNG=a=>()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
const pick=(r,a)=>a[Math.floor(r()*a.length)];
const wpick=(r,items)=>{let t=items.reduce((s,x)=>s+x.w,0)*r();for(const x of items){t-=x.w;if(t<0)return x}return items[items.length-1]};
const STATS={force:'Force',agilite:'Agilité',rapidite:'Rapidité',endurance:'Endurance'};
const STATD={force:'Plus de dégâts.',agilite:'Esquive plus souvent.',rapidite:'Frappe plus souvent.',endurance:'+6 PV par point.'};
/* Armes : dmg = dégâts de base, tempo = lenteur (1 = normal), odds = rareté au tirage */
const W={
 poele:{dmg:11,tempo:1,odds:30,toss:12,desc:'Polyvalente.'},
 gourdin:{dmg:14,tempo:1.25,odds:25,toss:10,desc:'Lent mais lourd.'},
 dague:{dmg:8,tempo:.75,odds:30,toss:15,desc:'Très rapide, +10 % de critiques.'},
 fouet:{dmg:11,tempo:1.05,odds:15,toss:10,desc:'Frappe de loin : impossible à contrer.'},
 marteau:{dmg:19,tempo:1.7,odds:8,toss:6,desc:'Dévastateur mais très lent.'},
 trident:{dmg:13,tempo:1.1,odds:15,toss:10,desc:'Solide en toutes circonstances.'},
 parapluie:{dmg:9,tempo:.9,odds:20,toss:10,desc:'Bloque 15 % des coups.'},
 os:{dmg:15,tempo:1.4,odds:12,toss:8,desc:'Lourd et efficace.'}};
const FISTS={dmg:6,tempo:1},NO_TOSS=10,THROW=.12,DISARM=.05;
const SK={
 peau:{odds:20,desc:'−20 % de dégâts subis.'},
 contre:{odds:15,desc:'25 % de chances de riposter.'},
 frenesie:{odds:15,desc:'25 % de chances de frapper deux fois.'},
 esquive:{odds:20,desc:'+15 % d’esquive.'},
 souffle:{odds:12,desc:'Récupère 25 % des PV une fois, sous 30 %.'},
 costaud:{odds:15,desc:'+25 % de PV max.'},
 lynx:{odds:15,desc:'+20 % de coups critiques.'},
 bouclier:{odds:12,desc:'20 % de chances de bloquer.'}};
/* Animaux : stats de base + part des stats du maître */
const P={
 chien:{hp:10,str:2,agi:5,spd:6,dmg:2,hs:.04,ss:0,odds:30,max:3,lvl:1},
 loup:{hp:14,str:3,agi:5,spd:5,dmg:3,hs:.05,ss:.1,odds:12,max:1,lvl:3},
 ours:{hp:26,str:5,agi:1,spd:2,dmg:6,hs:.09,ss:.15,odds:4,max:1,lvl:6}};
/* Noms selon l'univers : classique, manifestants, forces de l'ordre */
const NAMES={
 classic:{w:{poele:'Poêle en fonte',gourdin:'Gourdin',dague:'Dague',fouet:'Fouet',marteau:'Marteau de forge',trident:'Trident',parapluie:'Parapluie',os:'Os de mammouth'},
  sk:{peau:'Peau de cuir',contre:'Contre-attaque',frenesie:'Frénésie',esquive:'Jambes de gazelle',souffle:'Second souffle',costaud:'Costaud',lynx:'Œil de lynx',bouclier:'Bouclier'},
  p:{chien:'Chien',loup:'Loup',ours:'Ours'},ko:'est K.O.',camp:'Cogneur'},
 manif:{w:{poele:'Casserole',gourdin:'Pancarte',dague:'Baguette',fouet:'Banderole',marteau:'Poubelle',trident:'Trottinette',parapluie:'Parapluie',os:'Enceinte portable'},
  sk:{peau:'Doudoune épaisse',contre:'Contre-attaque',frenesie:'Slogan déchaîné',esquive:'Baskets neuves',souffle:'Pause merguez',costaud:'Costaud',lynx:'Œil de lynx',bouclier:'Pancarte-bouclier'},
  p:{chien:'Chien à punk',loup:'Pigeon',ours:'Saint-Bernard'},ko:'est K.O. et rentre en métro.',camp:'Manifestant·e'},
 police:{w:{poele:'Talkie-walkie',gourdin:'Matraque',dague:'Sifflet',fouet:'Rubalise',marteau:'Extincteur',trident:'Mégaphone',parapluie:'Bouclier en plexi',os:'Barrière Vauban'},
  sk:{peau:'Gilet rembourré',contre:'Contre-attaque',frenesie:'Excès de zèle',esquive:'Rangers légères',souffle:'Pause sandwich',costaud:'Costaud',lynx:'Œil de lynx',bouclier:'Formation tortue'},
  p:{chien:'Chien policier',loup:'Malinois',ours:'Cheval'},ko:'est K.O. et retourne au fourgon.',camp:'Forces de l’ordre'}};
const T=b=>NAMES[b.camp||'classic'];
const SKIN=['#f3c9a0','#e0a877','#c68652','#8d5a3b','#5e3a24','#f6d7b8'],HAIR=['#2b1a10','#5a3216','#c9912e','#e8d36a','#a33b1f','#d9d4cc','#1b1b1b'],SHIRT=['#e23d28','#1f6f78','#3d5a99','#6b8e23','#7b3f99','#e07a1f','#2f2f2f','#c2185b'],PANTS=['#3b2f2a','#2d3a4f','#5b4a2e','#1f3b2c','#4a2e2e'];
const FPD=6,need=l=>Math.floor(1.2*l+3);
const xpGain=(me,opp,won)=>won?(me-opp>2?1:2):1;
const maxHp=b=>Math.round((50+b.stats.endurance*6+b.level*2)*(b.skills.includes('costaud')?1.25:1));

function perks(b){const out=[];
 for(const k in W)if(!b.weapons.includes(k))out.push({k:'weapon',id:k,w:W[k].odds});
 for(const k in SK)if(!b.skills.includes(k))out.push({k:'skill',id:k,w:SK[k].odds});
 for(const k in P)if(b.level>=P[k].lvl&&b.pets.filter(p=>p===k).length<P[k].max)out.push({k:'pet',id:k,w:P[k].odds});
 return out}
function base(name,camp='classic'){const r=RNG(H(name.trim().toLowerCase()));
 const look={skin:pick(r,SKIN),hair:pick(r,HAIR),shirt:pick(r,SHIRT),pants:pick(r,PANTS),hs:Math.floor(r()*5),beard:r()<.35,bulk:Math.floor(r()*3),mouth:Math.floor(r()*3),acc:Math.floor(r()*3)};
 /* 11 points comme LaBrute : endurance 2-5, force 2-5, agilité 2-5, le reste en rapidité */
 let pts=11;const rb=(a,z)=>a+Math.floor(r()*(z-a+1));
 const endurance=rb(2,5);pts-=endurance;const force=Math.min(rb(2,5),pts-4);pts-=force;const agilite=Math.min(rb(2,5),pts-2);pts-=agilite;
 const b={name:name.trim(),camp,level:1,xp:0,stats:{force,agilite,rapidite:pts,endurance},weapons:[],skills:[],pets:[],look,wins:0,losses:0};
 const p=wpick(r,perks(b));apply(b,p);return b}
function choices(b,r){const ks=Object.keys(STATS),plus2={k:'stat',s:pick(r,ks),n:2},pool=perks(b);
 if(pool.length)return[wpick(r,pool),plus2];
 const a=pick(r,ks);let s2=pick(r,ks);while(s2===a)s2=pick(r,ks);return[plus2,{k:'stat2',s:a,s2}]}
function apply(b,o){if(o.k==='stat')b.stats[o.s]+=o.n;else if(o.k==='stat2'){b.stats[o.s]++;b.stats[o.s2]++}else if(o.k==='weapon')b.weapons.push(o.id);else if(o.k==='skill')b.skills.push(o.id);else b.pets.push(o.id)}
function describe(o,b){const t=T(b);return o.k==='stat'?[`+${o.n} ${STATS[o.s]}`,STATD[o.s]]:o.k==='stat2'?[`+1 ${STATS[o.s]} et +1 ${STATS[o.s2]}`,'Un peu de tout.']:o.k==='weapon'?[t.w[o.id],'Arme · '+W[o.id].desc]:o.k==='skill'?[t.sk[o.id],'Compétence · '+SK[o.id].desc]:[t.p[o.id],'Animal · se bat à tes côtés.']}
function npc(name,level,camp='classic'){const b=base(name,camp),r=RNG(H(name+'*npc'));for(let l=2;l<=level;l++){b.level=l;const c=choices(b,r);apply(b,c[r()<.5?0:1])}return b}

function fighters(b,side){const out=[{side,kind:'brute',b,name:b.name,max:maxHp(b),str:b.stats.force,agi:b.stats.agilite,spd:b.stats.rapidite,sk:b.skills,weapons:b.weapons,pool:[...b.weapons],keep:.5,weapon:null,x:30}],px=[15,22,7];
 b.pets.forEach((p,j)=>{const d=P[p];out.push({side,kind:'pet',pet:p,b,name:T(b).p[p],owner:b.name,max:Math.round(d.hp+d.hs*maxHp(b)),str:d.str+Math.ceil(d.ss*b.stats.force),agi:d.agi,spd:d.spd,dmg:d.dmg,sk:[],weapons:[],weapon:null,x:px[j%3]})});
 out.forEach(f=>{if(side)f.x=100-f.x});return out}
function simulate(A,B,r=Math.random){const F=[...fighters(A,0),...fighters(B,1)],ev=[],has=(f,s)=>f.sk.includes(s);
 F.forEach((f,i)=>{f.i=i;f.hp=f.max});
 const wp=f=>f.weapon?W[f.weapon]:FISTS;
 const iv=f=>(.1+18/(10+1.5*f.spd))*(f.kind==='brute'?wp(f).tempo:1);
 /* Tirage d'arme façon LaBrute : chaque arme ne sert qu'une fois, l'ancienne est jetée */
 const draw=f=>{if(f.kind!=='brute'||!f.pool.length)return;
  if(f.weapon&&r()<1/(f.pool.length*2+1))return;
  let t=r()*(f.pool.reduce((s,k)=>s+W[k].toss,0)+NO_TOSS),w=null;for(const k of f.pool){t-=W[k].toss;if(t<0){w=k;break}}
  if(f.weapon&&r()<f.keep){f.keep*=.5;return}
  if(!w)return;const old=f.weapon;f.weapon=w;f.keep=.5;f.pool=f.pool.filter(k=>k!==w);ev.push({t:'weapon',a:f.i,w,old})};
 F.forEach(f=>{draw(f);f.next=r()*iv(f)});
 const hit=(a,b,counter)=>{
  const dodge=Math.min(.5,Math.max(.02,.05+.03*(b.agi-a.agi)+(has(b,'esquive')?.15:0)));
  if(r()<dodge)ev.push({t:'dodge',a:a.i,b:b.i});
  else if(r()<(has(b,'bouclier')?.2:0)+(b.weapon==='parapluie'?.15:0))ev.push({t:'block',a:a.i,b:b.i});
  else{const bd=a.kind==='brute'?wp(a).dmg:a.dmg,crit=r()<.05+(has(a,'lynx')?.2:0)+(a.weapon==='dague'?.1:0);
   const dmg=Math.max(1,Math.floor((bd+a.str*(.2+bd*.05))*(.8+r()*.4)*(crit?2:1)*(has(b,'peau')?.8:1)));
   b.hp=Math.max(0,b.hp-dmg);ev.push({t:'hit',a:a.i,b:b.i,dmg,crit,hp:b.hp,w:a.weapon});
   if(b.hp<=0){ev.push({t:'ko',a:b.i});return}
   if(b.weapon&&a.kind==='brute'&&r()<DISARM){ev.push({t:'disarm',a:a.i,b:b.i,w:b.weapon});b.weapon=null}
   if(has(b,'souffle')&&!b.used&&b.hp<b.max*.3){b.used=true;const h=Math.round(b.max*.25);b.hp=Math.min(b.max,b.hp+h);ev.push({t:'heal',a:b.i,amt:h,hp:b.hp})}}
  if(!counter&&a.hp>0&&b.hp>0&&has(b,'contre')&&a.weapon!=='fouet'&&r()<.25){ev.push({t:'counter',a:b.i});hit(b,a,true)}};
 /* Lancer : dégâts à distance, l'arme est perdue, impossible à contrer */
 const toss=(a,b)=>{const w=a.weapon;a.weapon=null;
  if(r()<Math.min(.5,Math.max(.02,.05+.03*(b.agi-a.agi)+(has(b,'esquive')?.15:0)))){ev.push({t:'throw',a:a.i,b:b.i,w,miss:true});return}
  const dmg=Math.max(1,Math.floor((W[w].dmg+a.str*.1+a.agi*.15)*(1+r()*.5)*(has(b,'peau')?.8:1)));b.hp=Math.max(0,b.hp-dmg);
  ev.push({t:'throw',a:a.i,b:b.i,w,dmg,hp:b.hp});if(b.hp<=0)ev.push({t:'ko',a:b.i})};
 let win=-1,n=0;
 for(;n<800&&win<0;n++){const al=F.filter(f=>f.hp>0),f=al.reduce((m,x)=>x.next<m.next?x:m);f.next+=iv(f)*(.9+r()*.2);
  draw(f);
  const en=al.filter(x=>x.side!==f.side),eb=en.find(x=>x.kind==='brute'),t=r()<.8?eb:pick(r,en);if(f.weapon&&r()<THROW)toss(f,t);else hit(f,t,false);
  if(has(f,'frenesie')&&t.hp>0&&f.hp>0&&r()<.25){ev.push({t:'frenzy',a:f.i});hit(f,t,false)}
  const dead=F.find(x=>x.kind==='brute'&&x.hp<=0);if(dead)win=1-dead.side}
 if(win<0){const[a,b]=F.filter(x=>x.kind==='brute');win=a.hp/a.max>=b.hp/b.max?0:1}
 ev.push({t:'end',win});F.forEach(f=>{f.hp=f.max;f.weapon=null;f.pool=[...f.weapons];f.keep=.5});return{F,ev,win,turns:n}}

/* Partagé avec le serveur (Node) */
if(typeof module!=='undefined')module.exports={H,RNG,pick,STATS,W,SK,P,NAMES,T,FPD,need,xpGain,maxHp,perks,base,choices,apply,describe,npc,fighters,simulate};
