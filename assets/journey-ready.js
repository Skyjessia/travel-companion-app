/* Departure tasks are user-owned reminders, never booking confirmations from AI. */
(function(root){
'use strict';
const STORAGE='travelCompanionDepartureV1';
function clean(v){return String(v||'').trim();}
function hash(s){let n=2166136261;for(const c of s){n^=c.codePointAt(0);n=Math.imul(n,16777619);}return (n>>>0).toString(36);}
function contextKey(c){return hash(JSON.stringify([c.startDate||'',c.endDate||'',c.cities.map(x=>[x.name,x.country]),c.days.map(d=>[d.label,d.city]),...(c.archiveId?[c.archiveId]:[])]));}
function normalizeStore(raw){const result={profiles:{}};if(!raw||typeof raw.profiles!=='object'||!raw.profiles)return result;for(const [key,p] of Object.entries(raw.profiles).slice(-12)){if(!/^[a-z0-9]+$/.test(key)||!p||typeof p.tasks!=='object'||!p.tasks)continue;const tasks={};for(const [id,t] of Object.entries(p.tasks).slice(0,150)){if(!/^[a-z0-9-]+$/.test(id)||!t||!['todo','done','skip'].includes(t.status))continue;tasks[id]={status:t.status,note:clean(t.note).slice(0,500)};}result.profiles[key]={tasks};}return result;}
function tasksFor(c){const groups=[{title:'住宿',items:[]},{title:'跨城市交通',items:[]},{title:'行李与出发事项',items:[]}];
 const add=(g,id,title,detail)=>groups[g].items.push({id,title,detail});
 for(const city of c.cities){if(Number(city.nights)===0)continue;add(0,'hotel-'+hash(city.name+city.country),city.name+' · 确认住宿',[(city.nights?city.nights+' 晚':'晚数待确认'),'入住与退房日期、位置、退改规则和订单'].join('；'));}
 let legs=c.transport||[];if(!legs.length){legs=[];for(let i=1;i<c.days.length;i++)if(c.days[i].city!==c.days[i-1].city)legs.push({from:c.days[i-1].city,to:c.days[i].city,day_label:c.days[i].label,mode:'待定'});}
 legs.forEach((t,i)=>add(1,'leg-'+hash([i,t.from,t.to,t.day_label].join('|')),t.from+' → '+t.to,[t.day_label,t.mode||'方式待定',t.notes,'核实出行日期、班次、出发/到达站和两端接驳'].filter(Boolean).join(' · ')));
 [['documents','证件与订单','证件、住宿和交通订单，保存离线副本'],['charging','手机与充电','充电器、充电线、充电宝及常用地图'],['clothes','衣物与鞋','结合出行前天气准备衣物、舒适鞋与雨具'],['personal','日常用品','洗漱用品及个人常用物品']].forEach(t=>add(2,...t));
 for(const b of c.bookings||[])if(b.category!=='hotel'&&b.category!=='transport')add(2,'ticket-'+hash([b.title,b.day_label].join('|')),b.title,[b.day_label,b.action].filter(Boolean).join(' · '));
 for(const note of c.checks||[])add(2,'check-'+hash(note),'出发前核实',note);
 return groups;
}
function sightseeing(day){return (day?.stops||[]).map((s,i)=>({s,i})).filter(({s})=>s[0]!=='可选风味'&&s[3]?.kind!=='food'&&!s[3]?.activity&&!/休息|自由活动|转场|乘车|返程|机场接送/.test(s[1]));}
function mapLinks(name,city){const q=encodeURIComponent([name,city].filter(Boolean).join(' '));return {google:'https://www.google.com/maps/search/?api=1&query='+q,amap:'https://uri.amap.com/search?keyword='+encodeURIComponent(name)+'&city='+encodeURIComponent(city)+'&callnative=1'};}
root.JourneyReady={STORAGE,contextKey,normalizeStore,tasksFor,sightseeing,mapLinks};
if(typeof module!=='undefined'&&module.exports)module.exports=root.JourneyReady;
})(globalThis);
let departureSource='trip',journeyDay='',journeyStop='';
function departureContext(){
 if(departureSource==='plan'&&lastAiPlan)return {archiveId:typeof planArchiveId==='string'?planArchiveId:'',cities:lastAiPlan.city_sequence.map(c=>({name:c.city,country:c.country,nights:c.nights})),days:lastAiPlan.days.map(d=>({label:d.day_label,city:d.city})),transport:lastAiPlan.intercity_transport||[],bookings:planFlow?.review?.bookings||[],checks:lastAiPlan.checks||[],startDate:planBrief?.startDate,endDate:planBrief?.endDate};
 return {archiveId:trip.archiveId||'',cities:(trip.cities||[]).map(c=>({name:c.name,country:c.country,nights:/^\d+/.test(c.days)?parseInt(c.days):undefined})),days:(trip.days||[]).map(d=>({label:d.label,city:trip.cities.find(c=>c.id===d.city)?.name||''})),transport:trip.transport||[],bookings:trip.preparation||[],checks:trip.planChecks||[],...(trip.departureBrief||{})};
}
function openDeparturePreparation(source='trip'){departureSource=source;nav('departure');}
function readyNode(parent,tag,cls,text){const el=document.createElement(tag);if(cls)el.className=cls;if(text)el.textContent=text;parent.appendChild(el);return el;}
function readyButton(parent,text,action,cls='btn line'){const b=readyNode(parent,'button',cls,text);b.type='button';b.onclick=action;return b;}
function renderDeparturePreparation(){
 const host=document.getElementById('departureContent');host.replaceChildren();const c=departureContext();
 if(!c.days.length||departureSource==='trip'&&!trip.planDerived){readyNode(host,'p','notice','先完成一份行程，再来整理出发准备。');readyButton(host,'去 Plan',()=>nav('planner'));return;}
 const key=JourneyReady.contextKey(c);let store;try{store=JourneyReady.normalizeStore(JSON.parse(localStorage.getItem(JourneyReady.STORAGE)||'null'));}catch(e){store=JourneyReady.normalizeStore(null);}
 const profile=store.profiles[key]||{tasks:{}};store.profiles[key]=profile;
 const persistReady=()=>{try{store=JourneyReady.normalizeStore(store);localStorage.setItem(JourneyReady.STORAGE,JSON.stringify(store));}catch(e){toast('本机保存未成功，请导出备份后再试');}};
 const groups=JourneyReady.tasksFor(c),all=groups.flatMap(g=>g.items),done=all.filter(t=>['done','skip'].includes(profile.tasks[t.id]?.status)).length;
 const intro=readyNode(host,'div','card');readyNode(intro,'h3','',c.cities.map(x=>x.name).join(' → '));readyNode(intro,'p','tiny',c.startDate?c.startDate+(c.endDate?' — '+c.endDate:''):'出发日期未定 · 可以先准备');readyNode(intro,'p','notice','待办 '+(all.length-done)+' 项 · 已处理 '+done+' 项。所有事项都可稍后确认，不影响使用行程。');readyNode(intro,'p','tiny','你手动标记“已确认”才代表已处理；AI 的建议和已读提醒不会自动当作预订。清单保存在当前设备，可随旅行成果导出。');
 for(const group of groups){const panel=readyNode(host,'details','card ready-group');panel.open=group===groups[0];readyNode(panel,'summary','',group.title+' · '+group.items.length+' 项');if(!group.items.length)readyNode(panel,'p','tiny','本次没有跨城市路段。');
 for(const task of group.items){const row=readyNode(panel,'div','ready-task');
 if(group===groups[2]){const label=readyNode(row,'label','ready-check-row');const check=readyNode(label,'input');check.type='checkbox';check.checked=['done','skip'].includes(profile.tasks[task.id]?.status);check.setAttribute('aria-label',task.title+'已处理');readyNode(label,'strong','',task.title);readyNode(row,'p','tiny',task.detail);check.onchange=()=>{profile.tasks[task.id]={status:check.checked?'done':'todo',note:profile.tasks[task.id]?.note||''};store.profiles[key]=profile;persistReady();const processed=all.filter(t=>['done','skip'].includes(profile.tasks[t.id]?.status)).length;intro.querySelector('.notice').textContent='待办 '+(all.length-processed)+' 项 · 已处理 '+processed+' 项。所有事项都可稍后确认，不影响使用行程。';};continue;}
 readyNode(row,'strong','',task.title);readyNode(row,'p','tiny',task.detail);const controls=readyNode(row,'div','ready-controls');const select=readyNode(controls,'select');select.setAttribute('aria-label',task.title+'的状态');for(const [value,label] of [['todo','待处理'],['done','已确认 / 已准备'],['skip','不需要']]){const opt=readyNode(select,'option','',label);opt.value=value;}select.value=profile.tasks[task.id]?.status||'todo';const note=readyNode(controls,'input');note.placeholder='补充订单或接驳备注（可选）';note.setAttribute('aria-label',task.title+'的备注');note.maxLength=500;note.value=profile.tasks[task.id]?.note||'';
 const save=()=>{profile.tasks[task.id]={status:select.value,note:note.value};store.profiles[key]=profile;persistReady();};select.onchange=()=>{save();const processed=all.filter(t=>['done','skip'].includes(profile.tasks[t.id]?.status)).length;intro.querySelector('.notice').textContent='待办 '+(all.length-processed)+' 项 · 已处理 '+processed+' 项。所有事项都可稍后确认，不影响使用行程。';};note.oninput=save;
 }}
 readyButton(host,departureSource==='plan'?'返回最终方案':'返回每日行程',()=>nav(departureSource==='plan'?'planner':'trip'),'btn ready-wide');
}
function renderJourneyAssistant(){
 const host=document.getElementById('journeySpotPanel');host.replaceChildren();
 if(!trip.planDerived){document.getElementById('roadChatDay').replaceChildren();document.getElementById('roadChatContext').textContent='可以随时提问；载入行程后，会结合当天安排回答。';readyNode(host,'div','card','保存行程后，这里会按天展示景点与下一站入口。也可以在下面直接问 AI。');return;}
 const panel=readyNode(host,'div','card');readyNode(panel,'div','eyebrow','ON THE ROAD');readyNode(panel,'h3','','今天，慢慢逛');readyNode(panel,'p','tiny','看点讲解、简单拍照提示，或临时变更安排，都可以在这里问。');
 const tabs=readyNode(panel,'div','daytabs');tabs.setAttribute('aria-label','选择旅途日期');journeyDay=trip.days.some(d=>d.id===journeyDay)?journeyDay:activeDay;const day=trip.days.find(d=>d.id===journeyDay)||trip.days[0];
 for(const d of trip.days)readyButton(tabs,d.label,()=>{journeyDay=d.id;activeDay=d.id;activeCity=d.city;journeyStop='';renderJourneyAssistant();},'tab '+(d===day?'active':''));
 activeDay=day.id;activeCity=day.city;document.getElementById('assistantChatDetails').open=true;const city=trip.cities.find(c=>c.id===day.city);readyNode(panel,'p','tiny',day.label+' · '+(city?.name||'')+' · '+day.title);
 const dayHost=document.getElementById('roadChatDay');dayHost.replaceChildren();const daySelect=readyNode(dayHost,'select','road-day-select');daySelect.setAttribute('aria-label','问问这一天');for(const d of trip.days){const o=readyNode(daySelect,'option','',d.label+' · '+(trip.cities.find(c=>c.id===d.city)?.name||'')+' · '+d.title);o.value=d.id;}daySelect.value=day.id;daySelect.onchange=()=>{journeyDay=daySelect.value;journeyStop='';renderJourneyAssistant();};document.getElementById('roadChatContext').textContent='正在聊 '+day.label+' · '+(city?.name||'')+'，这天以交通或休息为主。';renderRoadHelp(panel,day);const stops=JourneyReady.sightseeing(day);if(!stops.length){readyNode(panel,'p','notice','这天以休息或转场为主，可在每日行程查看交通安排。');readyButton(panel,'查看当天安排',()=>{activeDay=day.id;activeCity=day.city;nav('trip');});return;}
 let selected=stops.find(x=>String(x.i)===journeyStop)||stops[0];journeyStop=String(selected.i);document.getElementById('roadChatContext').textContent='正在聊 '+day.label+' · '+(city?.name||'')+' · '+selected.s[1]+'。下面的问题会带上这份背景。';const label=readyNode(panel,'label','ready-label','选一个景点');label.htmlFor='journeyPlace';const choose=readyNode(panel,'select');choose.id='journeyPlace';for(const x of stops){const opt=readyNode(choose,'option','',(stops.indexOf(x)+1)+'. '+x.s[1]);opt.value=String(x.i);}choose.value=journeyStop;choose.onchange=()=>{journeyStop=choose.value;renderJourneyAssistant();};
 const card=readyNode(panel,'div','ready-spot');readyNode(card,'div','eyebrow',selected.s[0]||'时间灵活');readyNode(card,'h3','',selected.s[1]);readyNode(card,'p','tiny',selected.s[2]||'按当天节奏游览，开放和预约信息以官方渠道为准。');const actions=readyNode(card,'div','ready-actions');
 readyNode(card,'strong','','先看这里');readyNode(card,'p','tiny','从全貌、细节和现场说明牌看起；下方可让 AI 结合这个景点展开讲解。');readyNode(card,'strong','','怎么拍 · 通用提示');readyNode(card,'p','tiny',OnRoad.photo(selected.s[1]));const doneLabel=readyNode(card,'label','ready-check-row');const done=readyNode(doneLabel,'input');done.type='checkbox';done.checked=!!selected.s[3]?.journeyDone;done.setAttribute('aria-label',selected.s[1]+'这站已走完');readyNode(doneLabel,'span','','这站已走完（用于当天调整）');done.onchange=()=>{selected.s[3]={...(selected.s[3]||{}),journeyDone:done.checked};persist(true);saveActiveTripToVault();};
 const question=(topic)=>{activeDay=day.id;activeCity=day.city;document.getElementById('assistantChatDetails').open=true;ask('请针对 '+day.label+' '+(city?.country||'')+' '+(city?.name||'')+' 的具体景点「'+selected.s[1]+'」，'+topic+'。简短回答；核实地点身份，不确定的信息请说明，不要编造具体点位、开放时间或实时天气。','想了解「'+selected.s[1]+'」：'+(topic.startsWith('介绍')?'看点与背景':'拍照与光线')); document.getElementById('assistantChatDetails').scrollIntoView({behavior:'smooth',block:'start'});};
 readyButton(actions,'看点与背景',()=>question('介绍值得看的细节和文化背景'));
 readyButton(actions,'拍照与光线',()=>question('给出容易操作的构图与光线建议；未核实的机位和最佳时刻不要当作事实'));
 const next=stops[stops.indexOf(selected)+1];const target=next||selected;readyNode(panel,'p','tiny',next?'下一站 · '+next.s[1]:'当天最后一站 · 可在地图中查看这个景点的位置');const links=JourneyReady.mapLinks(target.s[1],city?.name||'');const maps=readyNode(panel,'div','ready-actions');for(const [provider,title] of (/中国|China|中国大陆/i.test(city?.country||'中国')?[['amap','在高德查看'],['google','在 Google 地图查看']]:[['google','在 Google 地图查看']])){const a=readyNode(maps,'a','btn line',title);a.href=links[provider];a.target='_blank';a.rel='noopener noreferrer';}readyNode(panel,'p','tiny','打开地图后选择导航；实际路线、耗时和交通以地图服务为准。');
 readyButton(panel,'出发准备清单 →',()=>openDeparturePreparation(),'btn light ready-wide');
}

async function shareTravelCompanion(){
 const url='https://skyjessia.github.io/travel-companion-app/';
 if(navigator.share){try{await navigator.share({title:'Travel Companion · 一起规划，轻松出发',text:'和 AI 一起规划每天怎么走，带着行程轻松出发。',url});return;}catch(error){if(error.name==='AbortError')return;}}
 try{await navigator.clipboard.writeText(url);toast('分享链接已复制，发给朋友就可以了');}catch(error){prompt('复制这个固定链接，发给朋友',url);}
}
