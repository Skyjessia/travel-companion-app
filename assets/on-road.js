/* On-road helpers use the saved itinerary; AI proposals never apply themselves. */
(function(root){
 'use strict';
 const copy=x=>JSON.parse(JSON.stringify(x));
 function photo(name){
  if(/博物|美术|展览|纪念馆/.test(name))return '先看现场摄影规定；允许拍摄时可用展厅线条构图，留意玻璃反光，不开闪光灯。';
  if(/寺|庙|教堂|清真|宫|故城|古城|古镇|楼|塔/.test(name))return '可尝试门框或建筑线条构图，先拍全貌再拍细节；人物和宗教空间先征得允许，避开通道。';
  if(/山|湖|河|海|公园|瀑布|峡谷/.test(name))return '可用步道、岸线或前景增加层次；光线柔和时更容易拍，不为取景离开安全步道。';
  return '先拍一张交代环境的全景，再找一处细节；留意光线和背景，拍人前先征得同意。';
 }
 function context(trip,day){const city=trip.cities.find(c=>c.id===day.city);return {trip_id:trip.archiveId||'',day_id:day.id,day_label:day.label,city:city?.name||'',country:city?.country||'',title:day.title,stops:day.stops.map((s,i)=>({id:String(i),time:s[0],name:s[1],description:s[2],completed:!!s[3]?.journeyDone,activity:!!s[3]?.activity,kind:s[3]?.kind||'sight'})),transport:trip.transport||[],travel_notes:day.transportNote||''};}
 function fingerprint(day){return JSON.stringify(day);}
 function proposal(text,day){
  let raw=String(text||'').trim();const fence=raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);if(fence)raw=fence[1];
  const data=JSON.parse(raw);if(!data||typeof data.summary!=='string'||!data.summary.trim()||!Array.isArray(data.options)||data.options.length!==2)throw Error('建议尚未形成两个完整选项，请重试；原行程未改变。');
  const valid=new Set(day.stops.map((_,i)=>String(i))),locked=day.stops.flatMap((s,i)=>s[3]?.journeyDone||s[3]?.activity||s[3]?.workflow_time_locked||s[0]==='可选风味'||s[3]?.kind==='food'?[String(i)]:[]);
  const options=data.options.map(o=>{if(!o||typeof o.label!=='string'||!o.label.trim()||typeof o.reason!=='string'||!Array.isArray(o.keep_ids)||!o.keep_ids.length||!o.keep_ids.every(id=>typeof id==='string'&&valid.has(id))||new Set(o.keep_ids).size!==o.keep_ids.length||locked.some(id=>!o.keep_ids.includes(id)))throw Error('建议改变了已完成或固定安排，已拦下；原行程未改变。');
   // Preserve the order of completed and fixed segments. This release only simplifies the remainder.
   const ids=[...o.keep_ids].sort((a,b)=>Number(a)-Number(b));return {label:o.label.slice(0,80),reason:o.reason.slice(0,800),keep_ids:ids};});
  return {summary:data.summary.slice(0,1000),options};
 }
 function apply(day,option,expected){if(fingerprint(day)!==expected)throw Error('当天安排已变化，请重新获取建议。');return {...copy(day),stops:option.keep_ids.map(id=>copy(day.stops[Number(id)]))};}
 root.OnRoad={photo,context,fingerprint,proposal,apply};if(typeof module!=='undefined'&&module.exports)module.exports=root.OnRoad;
})(globalThis);

let roadBusy=false;
function openJourneyDay(dayId,stopIndex){journeyDay=dayId||activeDay;journeyStop=stopIndex===undefined?'':String(stopIndex);activeDay=journeyDay;const d=trip.days.find(d=>d.id===journeyDay);if(d)activeCity=d.city;nav('assistant');}
function roadQuestion(topic,display){const d=trip.days.find(d=>d.id===journeyDay)||trip.days.find(d=>d.id===activeDay);if(d){activeDay=d.id;activeCity=d.city;}const c=d?OnRoad.context(trip,d):null;if(c)c.selected_stop=c.stops.find(s=>s.id===journeyStop)||null;ask('针对下面这份当天已保存的行程回答：'+JSON.stringify(c)+'。用户问题：'+topic+'。先给一句建议，再给最多两个具体选择；不重复询问已有背景，不声称有实时天气、当前位置、营业或导航数据。未核实的信息说明待核实；不要自动修改行程。',display||topic);document.getElementById('assistantChatDetails').scrollIntoView({behavior:'smooth',block:'start'});}
function renderRoadHelp(host,day){
 const box=readyNode(host,'div','road-help');readyNode(box,'h3','','计划有变化？我来帮你');readyNode(box,'p','tiny','点一个情况，结合这天的安排给建议。不会自动修改，也不会把勾选当作实际足迹。');
 const actions=readyNode(box,'div','road-quick');for(const [label,topic] of [['下雨了','我遇到下雨，请优先建议避雨和室内安排'],['有点累','我有点累，希望减少接下来的游览负担'],['晚出发了','我今天晚出发了，希望保留重点并减少一站']])readyButton(actions,label,()=>requestRoadChange(day.id,topic),'btn light');
 for(const [label,topic] of [['想换个地方','请建议一个替代当前未完成景点的具体地点，说明取舍；坐标、交通、开放和预约待核实。先给建议，不改行程'],['附近吃什么','请结合当天游览区域推荐两种当地风味或具体餐饮选择；没有用户位置，不要声称距离最近，不编营业和价格']])readyButton(actions,label,()=>roadQuestion(topic,label),'btn line');
 const result=readyNode(box,'div','road-result');result.id='roadChangeResult';result.setAttribute('aria-live','polite');
}
async function requestRoadChange(dayId,topic){
 if(roadBusy){toast('正在整理建议，请稍等。');return;}const day=trip.days.find(d=>d.id===dayId);if(!day)return;const sourceId=trip.archiveId||'',expected=OnRoad.fingerprint(day),context=OnRoad.context(trip,day);roadBusy=true;
 const buttons=[...document.querySelectorAll('.road-quick button')];buttons.forEach(b=>b.disabled=true);const result=document.getElementById('roadChangeResult');result.replaceChildren();const status=readyNode(result,'p','notice','正在查看当天安排，给你两个选择…');status.setAttribute('role','status');const started=Date.now(),timer=setInterval(()=>status.textContent='正在整理建议 · 已等待 '+Math.floor((Date.now()-started)/1000)+' 秒，原行程保留。',1000);
 try{
  const response=await apiRequest({task:'chat',message:'你是当天行程调整助手。情况：'+topic+'。仅给两个能直接选择的方案，优先减少未完成景点，不新增、不改名、不移日、不编营业或交通。已完成、activity、餐饮与时间锁定的项目必须保留；保持原顺序。本轮只能精简，确需替换的地点请在说明中建议另行核实。不改变任何时段。只返回完整JSON，无其他文字：{"summary":"简短建议及待核实项","options":[{"label":"轻松一点","reason":"具体取舍","keep_ids":["0"]},{"label":"保留原安排","reason":"具体取舍","keep_ids":["0"]}]}。keep_ids填当天stops的id，必须保留固定项目。当天数据：'+JSON.stringify(context),context:{...collectTripContext(),on_road:context}});
  const current=trip.days.find(d=>d.id===dayId);if((trip.archiveId||'')!==sourceId||!current||OnRoad.fingerprint(current)!==expected)throw Error('你已切换或修改行程，本次建议未应用。请在当前日期重试。');const parsed=OnRoad.proposal(response.text,current);result.replaceChildren();readyNode(result,'p','',parsed.summary);readyNode(result,'p','tiny','仅调整未完成安排；时段沿用原计划，实际可行性仍需核实。');
  parsed.options.forEach((option,i)=>{const card=readyNode(result,'div','road-option');readyNode(card,'strong','',(i?'B':'A')+' · '+option.label);readyNode(card,'p','tiny',option.reason);readyNode(card,'p','',option.keep_ids.map(id=>day.stops[Number(id)][1]).join(' → '));const removed=day.stops.filter((_,n)=>!option.keep_ids.includes(String(n)));if(removed.length)readyNode(card,'p','tiny','这次先不去：'+removed.map(s=>s[1]).join('、'));readyButton(card,'采用'+(i?' B':' A'),()=>{try{const d=trip.days.find(d=>d.id===dayId);if((trip.archiveId||'')!==sourceId||!d)throw Error('已切换旅行，请重新获取建议。');const updated=OnRoad.apply(d,option,expected);if(!removed.length){toast('已保留原安排。');return;}const before=JSON.parse(JSON.stringify(d));trip.days[trip.days.indexOf(d)]=updated;trip.journeyAdjusted=true;trip.journeyRevision=(trip.journeyRevision||0)+1;persist(true);saveActiveTripToVault();renderJourneyAssistant();const target=document.getElementById('roadChangeResult');readyNode(target,'p','notice','已更新当天安排，其他日期未改变。');readyButton(target,'撤销这次调整',()=>{const now=trip.days.find(x=>x.id===dayId);if((trip.archiveId||'')!==sourceId||!now||OnRoad.fingerprint(now)!==OnRoad.fingerprint(updated)){toast('之后已有新修改，可从旅行卡片查看历史版本。');return;}trip.days[trip.days.indexOf(now)]=before;trip.journeyRevision=(trip.journeyRevision||0)+1;persist(true);saveActiveTripToVault();renderJourneyAssistant();toast('已恢复调整前的当天安排。');},'btn line');}catch(e){toast(e.message);}},'btn');});
  appendSources(result,response.sources);
 }catch(e){result.replaceChildren();readyNode(result,'p','notice','这次建议未完成：'+e.message+' 原行程没有改变。');readyButton(result,'重试',()=>requestRoadChange(dayId,topic),'btn line');readyButton(result,'先查看原行程',()=>{activeDay=dayId;nav('trip');},'btn line');}
 finally{clearInterval(timer);roadBusy=false;buttons.forEach(b=>b.disabled=false);}
}
