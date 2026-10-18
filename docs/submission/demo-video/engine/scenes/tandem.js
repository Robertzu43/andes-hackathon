/* Tándem visual-first concept film. Actual huashu SCENES API; no live data. */
(() => {
 'use strict';
 const C={paper:'#F7F5F0',ink:'#132C3A',teal:'#087F8C',action:'#086F79',muted:'#536570',danger:'#B42332',pale:'#E7ECEC',light:'#D1E2E1',white:'#FFFFFF',border:'#73818A'};
 const ease=(t,a,d)=>MO.anim(t,a,d,MO.smooth), mix=(a,b,p)=>U.lerp(a,b,p), clamp=p=>U.clamp(p), cache=new Map();
 function box(c,x,y,w,h,r,fill,stroke,lw=2){c.beginPath();c.roundRect(x,y,w,h,r);if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=lw;c.stroke();}}
 function path(c,pts,col=C.ink,w=3,dash=[]){c.save();c.strokeStyle=col;c.lineWidth=w;c.lineCap='round';c.lineJoin='round';c.setLineDash(dash);c.beginPath();pts.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.stroke();c.restore();}
 function txt(c,s,x,y,size=28,col=C.ink,weight=650,align='center'){c.save();c.font=`${weight} ${size}px Manrope`;c.fillStyle=col;c.textAlign=align;c.textBaseline='middle';c.fillText(s,x,y);c.restore();}
 function dot(c,x,y,r,fill,stroke,w=3){c.beginPath();c.arc(x,y,r,0,Math.PI*2);if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=w;c.stroke();}}
 function image(c,key,x,y,w,h){const im=cache.get(key);if(!im)throw Error(`Missing asset ${key}`);c.drawImage(im,x,y,w,h);}
 function init(IMG){if(cache.size)return;for(const key of TANDEM_ASSETS){const im=IMG[key];if(!im)throw Error(key);const cv=document.createElement('canvas');cv.width=im.naturalWidth*2;cv.height=im.naturalHeight*2;cv.getContext('2d').drawImage(im,0,0,cv.width,cv.height);cache.set(key,cv);}}
 function icon(c,type,x,y,s=32,col=C.ink){c.save();c.translate(x,y);c.scale(s/32,s/32);c.strokeStyle=col;c.fillStyle=col;c.lineWidth=2.3;c.lineCap='round';c.lineJoin='round';c.beginPath();
  if(type==='check'){c.moveTo(-12,0);c.lineTo(-3,9);c.lineTo(14,-11);}
  else if(type==='person'){c.arc(0,-8,6,0,Math.PI*2);c.moveTo(-12,15);c.bezierCurveTo(-12,-1,12,-1,12,15);}
  else if(type==='truck'){c.rect(-15,-9,20,18);c.moveTo(5,-5);c.lineTo(12,-5);c.lineTo(17,2);c.lineTo(17,9);c.lineTo(5,9);c.moveTo(-4,10);c.arc(-7,10,3,0,Math.PI*2);c.moveTo(14,10);c.arc(11,10,3,0,Math.PI*2);}
  else if(type==='pin'){c.moveTo(0,17);c.bezierCurveTo(-22,-7,-7,-22,6,-13);c.bezierCurveTo(17,-6,8,8,0,17);c.moveTo(4,-5);c.arc(0,-5,4,0,Math.PI*2);}
  else if(type==='play'){c.moveTo(-7,-13);c.lineTo(13,0);c.lineTo(-7,13);c.closePath();}
  else if(type==='pause'){c.moveTo(-6,-12);c.lineTo(-6,12);c.moveTo(6,-12);c.lineTo(6,12);}
  else if(type==='fuel'){c.rect(-11,-13,17,28);c.rect(-8,-9,11,8);c.moveTo(6,-5);c.bezierCurveTo(20,-8,10,16,20,11);c.lineTo(20,-8);c.lineTo(14,-14);c.moveTo(-15,16);c.lineTo(10,16);}
  else if(type==='food'){c.moveTo(-10,-14);c.lineTo(-10,14);c.moveTo(-15,-14);c.lineTo(-15,-4);c.lineTo(-5,-4);c.lineTo(-5,-14);c.moveTo(10,-14);c.lineTo(10,14);c.moveTo(10,-14);c.bezierCurveTo(22,-8,19,0,10,0);}
  else if(type==='clock'){c.arc(0,0,15,0,Math.PI*2);c.moveTo(0,-8);c.lineTo(0,0);c.lineTo(7,4);}
  else if(type==='hourglass'){c.moveTo(-10,-14);c.lineTo(10,-14);c.moveTo(-10,14);c.lineTo(10,14);c.moveTo(-8,-14);c.bezierCurveTo(-8,-5,8,5,8,14);c.moveTo(8,-14);c.bezierCurveTo(8,-5,-8,5,-8,14);}
  else if(type==='eye'){c.moveTo(-17,0);c.quadraticCurveTo(0,-21,17,0);c.quadraticCurveTo(0,21,-17,0);c.moveTo(6,0);c.arc(0,0,6,0,Math.PI*2);}
  else if(type==='link'){c.moveTo(-3,-9);c.bezierCurveTo(7,-22,23,-5,9,4);c.lineTo(4,9);c.moveTo(3,9);c.bezierCurveTo(-7,22,-23,5,-9,-4);c.lineTo(-4,-9);c.moveTo(-5,5);c.lineTo(5,-5);}
  else if(type==='lock'){c.rect(-10,-2,20,17);c.moveTo(-6,-2);c.lineTo(-6,-9);c.bezierCurveTo(-6,-18,6,-18,6,-9);c.lineTo(6,-2);}
  c.stroke();c.restore();
 }
 function wheel(c,x,y,r,rot){dot(c,x,y,r,C.ink);dot(c,x,y,r*.6,C.border);c.save();c.translate(x,y);c.rotate(rot);for(let i=0;i<6;i++){c.rotate(Math.PI/3);path(c,[[r*.15,0],[r*.45,0]],C.pale,3);}dot(c,0,0,r*.16,C.ink);c.restore();}
 function truck(c,x,y,s=1,travel=0){c.save();c.translate(x,y);c.scale(s,s);c.fillStyle='rgba(19,44,58,.12)';c.beginPath();c.ellipse(390,318,372,19,0,0,Math.PI*2);c.fill();image(c,'assets/demo-truck.svg',0,0,800,350);[91,200,650].forEach(xx=>wheel(c,xx,273,42,travel/42));image(c,'assets/tandem-mark-ink.svg',305,108,88,96);c.restore();}
 function world(c,t,{travel=0,station=false,road=true}={}){
  c.fillStyle=C.paper;c.fillRect(0,0,1920,1080);
  c.save();c.globalAlpha=.42;c.strokeStyle=C.light;c.lineWidth=1.6;for(let i=0;i<5;i++){c.beginPath();c.moveTo(-100,530+i*39);c.bezierCurveTo(410,250+i*45,735,835-i*16,1330,495+i*32);c.bezierCurveTo(1610,310+i*45,1790,510+i*27,2050,387+i*40);c.stroke();}c.restore();
  c.fillStyle=C.pale;c.beginPath();c.moveTo(0,800);c.bezierCurveTo(550,630,800,865,1190,746);c.bezierCurveTo(1520,650,1810,746,1920,681);c.lineTo(1920,1080);c.lineTo(0,1080);c.fill();
  if(road){c.fillStyle=C.ink;c.beginPath();c.moveTo(0,936);c.bezierCurveTo(700,893,1150,998,1920,911);c.lineTo(1920,1080);c.lineTo(0,1080);c.fill();path(c,[[0,956],[450,943],[960,967],[1450,964],[1920,931]],C.paper,3);c.save();c.strokeStyle=C.border;c.lineWidth=5;c.setLineDash([72,56]);c.lineDashOffset=-travel;c.beginPath();c.moveTo(-150,1047);c.bezierCurveTo(600,980,1250,1110,2080,1000);c.stroke();c.restore();}
  if(station)image(c,'assets/demo-station.svg',665,388,710,433);
 }
 function parked(c,x,y){path(c,[[x,y],[x,y+107]],C.border,5);box(c,x-29,y-40,58,58,10,C.action);txt(c,'P',x,y-10,35,C.paper,750);}
 function map(c,x,y,w,h,{incident=false}={}){
  c.save();c.beginPath();c.roundRect(x,y,w,h,20);c.clip();c.fillStyle=C.pale;c.fillRect(x,y,w,h);
  c.strokeStyle=C.white;c.lineWidth=15;for(let j=0;j<4;j++){c.beginPath();c.moveTo(x-20,y+30+j*68);c.bezierCurveTo(x+w*.45,y-30+j*68,x+w*.5,y+100+j*68,x+w+20,y+45+j*68);c.stroke();}
  c.strokeStyle=C.light;c.lineWidth=18;c.beginPath();c.moveTo(x+w*.22,y-20);c.bezierCurveTo(x+w*.9,y+h*.35,x+w*.05,y+h*.5,x+w*.9,y+h+20);c.stroke();
  c.strokeStyle=incident?C.danger:C.teal;c.lineWidth=5;c.setLineDash([7,8]);c.beginPath();c.moveTo(x+52,y+h-48);c.bezierCurveTo(x+45,y+h*.3,x+w-50,y+h*.8,x+w-65,y+65);c.stroke();c.setLineDash([]);dot(c,x+52,y+h-48,9,C.white,incident?C.danger:C.teal,4);dot(c,x+w-65,y+65,22,C.white);icon(c,incident?'pin':'truck',x+w-65,y+65,23,incident?C.danger:C.teal);c.restore();
 }
 function button(c,x,y,w,h,label,type,{danger=false,outline=false}={}){const col=danger?C.danger:C.action;box(c,x,y,w,h,17,outline?C.white:col,outline?col:null,2);if(type)icon(c,type,x+(label?48:w/2),y+h/2,28,outline?col:C.white);if(label)txt(c,label,x+w/2+(type?15:0),y+h/2,27,outline?col:C.white,700);}
 function status(c,type,x,y,{red=false,filled=true,size=42}={}){const col=red?C.danger:C.action;dot(c,x,y,size,filled?col:C.white,col,2);icon(c,type,x,y,size*.9,filled?C.white:col);}
 function head(c,role){image(c,'assets/tandem-mark-ink.svg',170,66,47,51);dot(c,62,91,24,C.pale);icon(c,role==='driver'?'truck':'person',62,91,25,C.ink);txt(c,'14:46',40,28,15,C.ink,700,'left');path(c,[[319,29],[325,21],[331,29]],C.ink,2);box(c,343,21,20,10,3,null,C.ink,1.5);box(c,346,24,14,4,1,C.ink);}
 function screen(c,mode,t,role='driver'){
  c.fillStyle=C.paper;c.fillRect(0,0,390,780);head(c,role);
  if(mode==='invite'){
   map(c,24,143,342,270);status(c,'truck',112,492,{size:42});status(c,'person',278,492,{filled:false,size:42});path(c,[[165,492],[220,492]],C.border,3,[5,8]);icon(c,'link',195,575,32,C.muted);button(c,24,646,342,78,'Invitar','person');
  }else if(mode==='accept'){
   status(c,'truck',195,242,{filled:false,size:70});icon(c,'link',195,375,40,C.teal);status(c,'person',195,497,{filled:false,size:70});button(c,24,646,342,78,'Aceptar','check');
  }else if(mode==='accepted'){
   status(c,'check',195,310,{size:88});txt(c,'Aceptado',195,452,31,C.action,700);map(c,24,514,342,210);
  }else if(mode==='ready'||mode==='readyOff'){
   map(c,24,143,342,270);dot(c,60,458,24,C.pale);icon(c,'person',60,458,25,C.ink);icon(c,'check',326,458,24,C.teal);box(c,24,512,342,82,18,C.white,C.light);icon(c,'pin',60,553,27,C.action);txt(c,'Ubicación',162,553,24,C.ink,650);box(c,286,537,54,32,16,mode==='readyOff'?C.border:C.action);dot(c,mode==='readyOff'?302:323,553,12,C.white);button(c,24,646,342,78,'Iniciar','play');
  }else if(mode==='active'||mode==='ok'||mode==='contactOK'||mode==='waiting'){
   map(c,24,143,342,270);if(mode==='waiting'){icon(c,'clock',195,520,48,C.muted);}else if(mode==='active')button(c,24,450,342,116,'OK','check');else{status(c,'check',195,508,{size:56});txt(c,'OK',195,589,28,C.action,750);}
   if(role==='driver'){button(c,24,646,156,78,'','pause',{outline:true});button(c,204,646,162,78,'SOS',null,{danger:true,outline:true});}
   else {icon(c,'clock',145,676,22,C.muted);txt(c,'Ahora',207,676,22,C.muted,550);}
  }else if(mode==='pauseMenu'){
   map(c,24,143,342,240);button(c,24,430,156,120,'','fuel',{outline:true});button(c,210,430,156,120,'','food',{outline:true});button(c,24,574,342,72,'Pausa','pause');button(c,24,676,342,56,'SOS',null,{danger:true,outline:true});
  }else if(mode==='pause'){
   status(c,'fuel',195,275,{filled:false,size:80});icon(c,'pause',195,445,43,C.action);txt(c,'Pausa',195,510,32,C.action,700);button(c,24,646,156,78,'OK','check',{outline:true});button(c,204,646,162,78,'SOS',null,{danger:true,outline:true});
  }else if(mode==='sosAction'){
   map(c,24,143,342,240);dot(c,195,526,100,C.danger);txt(c,'SOS',195,526,52,C.white,800);icon(c,'person',195,699,31,C.muted);
  }else if(mode==='sos'||mode==='incident'||mode==='read'){
   box(c,24,143,342,86,20,C.danger);txt(c,'SOS',195,186,42,C.white,800);map(c,24,253,342,235,{incident:true});icon(c,'clock',114,518,19,C.muted);txt(c,'14:32',213,518,23,C.muted,600);
   if(mode==='sos'){icon(c,'check',62,584,26,C.danger);txt(c,'Registrado',205,584,27,C.danger,700);icon(c,'hourglass',62,666,27,C.muted);txt(c,'Aviso pendiente',215,666,23,C.muted,550);}
   else if(mode==='incident')button(c,24,623,342,92,'Leído','eye',{outline:true,danger:true});
   else{icon(c,'eye',195,604,41,C.danger);txt(c,'Leído',195,672,28,C.danger,700);}
  }else if(mode==='locked'){
   txt(c,'14:32',195,240,69,C.ink,500);icon(c,'lock',195,355,30,C.muted);image(c,'assets/tandem-mark-ink.svg',149,526,92,100);
  }
 }
 function phone(c,x,y,w,mode,t,{role='driver',angle=0}={}){const s=w/390,h=w*2;c.save();c.translate(x+w/2,y+h/2);c.rotate(angle);c.scale(s,s);c.translate(-195,-390);box(c,-8,1,414,799,47,'rgba(19,44,58,.13)');box(c,-14,-14,418,808,45,C.ink);box(c,-7,-7,404,794,39,C.border);c.save();c.beginPath();c.roundRect(0,0,390,780,31);c.clip();screen(c,mode,t,role);c.restore();box(c,141,9,108,18,10,C.ink);path(c,[[150,759],[240,759]],C.ink,4);c.restore();return{x,y,w,s};}
 function hand(c,ph,x,y,t,at,col=C.action){const enter=ease(t,at-.55,.4),exit=ease(t,at+.32,.42),p=enter*(1-exit);if(p<=0)return;const xx=ph.x+x*ph.s+mix(50,0,enter),yy=ph.y+y*ph.s+mix(80,0,enter);c.save();c.globalAlpha=p;c.translate(xx,yy);c.scale(1.1,1.1);if(t>=at){const q=clamp((t-at)/.6);c.save();c.globalAlpha=1-q;dot(c,0,0,18+q*28,null,col,3);c.restore();}c.translate(0,4);c.beginPath();c.moveTo(-7,40);c.lineTo(-7,6);c.bezierCurveTo(-7,-5,7,-5,7,6);c.lineTo(7,27);c.bezierCurveTo(25,22,39,36,35,53);c.lineTo(29,73);c.lineTo(2,73);c.lineTo(-19,51);c.bezierCurveTo(-27,40,-16,32,-7,40);c.closePath();c.fillStyle=C.white;c.fill();c.strokeStyle=C.ink;c.lineWidth=2.5;c.stroke();c.restore();}
 function exchange(c,t,at,dur,{back=false,kind='check',red=false,pending=false}={}){const p=clamp((t-at)/dur);if(t<at||p>=1)return;const col=red?C.danger:C.teal;const x=mix(back?1232:710,back?710:1232,p),y=510-Math.sin(p*Math.PI)*110;c.save();c.globalAlpha=Math.min(1,p*8,(1-p)*8);path(c,[[710,510],[820,455],[1115,455],[1232,510]],col,2,pending?[5,11]:[]);status(c,kind,x,y,{size:40,red});c.restore();}
 function corner(c,logo=false){if(logo)image(c,'assets/tandem-logo-ink.svg',76,62,164,39.16);box(c,1660,64,194,36,8,C.paper);txt(c,'Demo conceptual',1840,82,19,C.muted,550,'right');}
 function pair(c,left,right,t,{end=false}={}){const s=end?.84:1,w=330*s,y=end?302:142,x1=end?285:370,x2=end?1358:1250;const a=phone(c,x1,y,w,left,t);const b=phone(c,x2,y,w,right,t,{role:'contact'});return[a,b];}
 const S={
  tandem_01_road(c,lt,t){world(c,t);const p=ease(lt,.15,1.35);truck(c,mix(345,390,p),506,1.32);parked(c,1520,722);const ph=phone(c,mix(2010,1430,ease(lt,1.3,1.1)),188,285,'invite',lt);hand(c,ph,195,685,lt,3.1);},
  tandem_02_accept(c,lt,t){world(c,t);truck(c,768,784,.49);parked(c,1192,873);const accepted=lt>=3.65;const [a,b]=pair(c,lt>=4.4?'readyOff':'invite',accepted?'accepted':'accept',lt);hand(c,b,195,685,lt,3.3);exchange(c,lt,3.5,.9,{back:true});},
  tandem_03_start(c,lt,t){const start=ease(lt,2.45,2.55),travel=lt>2.45?(lt-2.45)*190:0;world(c,t,{travel});truck(c,100+start*130,620,1.06,travel);if(lt<2.45)parked(c,1000,775);const ph=phone(c,1190,124,390,lt<.95?'readyOff':lt<2.4?'ready':'active',lt);hand(c,ph,315,553,lt,.85);hand(c,ph,195,685,lt,2.1);},
  tandem_04_drive(c,lt,t){const travel=lt*205;world(c,t,{travel});truck(c,240+ease(lt,0,5)*235,506,1.32,travel);phone(c,1500,171,280,'locked',lt);},
  tandem_05_pause(c,lt,t){const arriving=1-ease(lt,0,1.2),travel=Math.max(0,1.2-lt)*135;world(c,t,{station:true});truck(c,420-arriving*310,652,1.01,travel);if(lt>1.2)parked(c,1215,810);const y=mix(1120,128,ease(lt,1.15,1));const ph=phone(c,1380,y,365,lt<3.4?'pauseMenu':'pause',lt);hand(c,ph,101,490,lt,3.1);},
  tandem_06_ok(c,lt,t){world(c,t);truck(c,768,784,.49);parked(c,1192,873);const [a]=pair(c,lt<2.4?'pause':'ok',lt<3.3?'waiting':'contactOK',lt);hand(c,a,102,685,lt,2.1);exchange(c,lt,2.4,.9);},
  tandem_07_sos(c,lt,t){world(c,t);truck(c,1160,711,.70);parked(c,1135,861);const ph=phone(c,560,128,390,lt<2.4?'sosAction':'sos',lt);hand(c,ph,195,526,lt,1.5,C.danger);if(lt>=1.5&&lt<2.4){const p=clamp((lt-1.5)/.9);c.save();c.strokeStyle=C.paper;c.lineWidth=7;c.beginPath();c.arc(ph.x+195,ph.y+526,90,-Math.PI/2,-Math.PI/2+2*Math.PI*p);c.stroke();c.restore();}},
  tandem_08_read(c,lt,t){world(c,t);truck(c,768,784,.49);parked(c,1192,873);const [a,b]=pair(c,'sos',lt<2.9?'incident':'read',lt);hand(c,b,195,669,lt,2.5,C.danger);exchange(c,lt,2.8,.9,{back:true,kind:'eye',red:true});},
  tandem_09_end(c,lt,t){world(c,t);const p=ease(lt,0,2);truck(c,640,666,.80);parked(c,1308,806);pair(c,'sos','read',lt,{end:true});const w=mix(320,390,p);image(c,'assets/tandem-logo-ink.svg',960-w/2,146,w,w*96/402);c.save();c.globalAlpha=.55;path(c,[[560,628],[760,540],[1160,540],[1350,628]],C.teal,3,[5,12]);c.restore();}
 };
 function camera(id,t){let z=1,x=960,y=540;
  if(id==='tandem_01_road'){const p=1-ease(t,.1,1.5);z=mix(1,1.42,p);x=mix(960,900,p);y=mix(540,689,p);}
  if(id==='tandem_02_accept'){const p=ease(t,1.9,.9)*(1-ease(t,4.4,1.4));z=mix(1,1.26,p);x=mix(960,1270,p);y=mix(540,560,p);}
  if(id==='tandem_03_start'){const p=ease(t,.25,.9)*(1-ease(t,3.2,1.5));z=mix(1,1.40,p);x=mix(960,1350,p);y=mix(540,650,p);}
  // Driving stays wide: the truck and road provide the motion.
  // Arrival and phone entry carry the pause shot without a camera push.
  if(id==='tandem_06_ok'){const p=ease(t,.3,1)*(1-ease(t,4.4,1.3));z=mix(1,1.20,p);x=mix(960,mix(630,1210,ease(t,2.3,1.6)),p);y=mix(540,535,p);}
  if(id==='tandem_07_sos'){const p=ease(t,.15,1)*(1-ease(t,3.5,1.3));z=mix(1,1.45,p);x=mix(960,768,p);y=mix(540,580,p);}
  // Keep both red SOS states fully visible while the contact reads.
  x=U.clamp(x,960/z,1920-960/z);y=U.clamp(y,540/z,1080-540/z);return{z,x,y};
 }
 for(const[id,draw]of Object.entries(S))SCENES[id]={init,draw(c,lt,t){lt=Math.max(0,lt);const q=camera(id,lt);c.save();c.translate(960,540);c.scale(q.z,q.z);c.translate(-q.x,-q.y);draw(c,lt,t);c.restore();corner(c,id==='tandem_01_road');}};
})();
