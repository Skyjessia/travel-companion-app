/* Discovery requests and novelty checks. Only source-provided POIs can be offered. */
(function(root){
'use strict';
const directions=[
 {key:'local',label:'当地生活',preference:'更多当地生活',interests:['地方生活','小众探索'],angles:['街市与老街','手作与地方文化空间','城市里的日常生活街区']},
 {key:'nature',label:'自然风景',preference:'更多自然风景',interests:['自然风光'],angles:['湖泊与湿地','山林与自然步道','地质与山水景观']},
 {key:'culture',label:'历史文化',preference:'更多历史文化',interests:['历史文化','古建筑'],angles:['遗址与古建筑','地方历史专题场馆','历史街区与传统建筑']},
 {key:'easy',label:'轻松少走路',preference:'更轻松，少走路',interests:['历史文化','地方生活'],angles:['室内场馆与紧凑街区','平坦的公园和城市空间','集中游览且少爬坡的地点']},
 {key:'nearby',label:'周边一日游',preference:'周边一日游',interests:['自然风光','古建筑'],angles:['城郊古镇与传统村落','郊区自然景区','周边乡村与山水体验']},
 {key:'food',label:'特色美食',preference:'特色美食',interests:['特色美食'],angles:['本地传统菜馆','地方小吃与早餐','与上一批不同的餐饮体验']}
];
const nameKey=s=>String(s||'').normalize('NFKC').replace(/[\s·•（）()]/g,'').toLowerCase();
function directionFor(value){return directions.find(d=>d.key===value||d.preference===value)||null;}
function rememberSeen(previous,items){const seen=new Map();for(const p of [...(Array.isArray(previous)?previous:[]),...items])if(p&&p.name){const id=String(p.id||''),name=String(p.name);seen.set(id?'id:'+id:'name:'+nameKey(name),{id,name});}return [...seen.values()].slice(-120);}
function buildRequest({city,country,brief={},previous={},plan={},choices={},direction='',center=null}){
 const d=directionFor(direction),prior=previous.discovery||{},turn=Number(prior.turn||0)+1;
 const used=(plan.days||[]).flatMap(day=>[...(day.stops||[]),...(day.local_food||[])].filter(s=>day.city===city||s.candidate_id).map(s=>({id:s.candidate_id||'',name:day.city===city?(s.location_name||s.name):''})));
 const rejected=(previous.pois||[]).filter(p=>choices[p.id]==='excluded');
 const excluded=rememberSeen(prior.seen||[],[...used,...rejected]);
 // ID-only exclusions also cover equal IDs whose labels changed across provider responses.
 const excludedIds=new Set([...used.map(x=>x.id),...rejected.map(x=>x.id),...excluded.map(x=>x.id)].filter(Boolean));
 const excludedNames=new Set(excluded.map(p=>nameKey(p.name)).filter(Boolean));
 const interests=d?d.interests:(brief.interests?.length?brief.interests:['历史文化','地方生活']);
 const angle=d?d.angles[(turn-1)%d.angles.length]:['不同类型的游览体验','之前未展示的具体地点','代表性之外的小众选择'][(turn-1)%3];
 const nearby=d?.key==='nearby';
 const preferences=[d?'本轮选择方向：'+d.preference:'本轮按原兴趣寻找新的选择','本轮希望看的内容：'+angle,nearby?'以 '+city+' 为住宿与出发基地的城郊/周边候选；优先适合一日往返的具体游览点，不扩大为全省或长途跨城路线。往返交通、停留时间与开放条件尚待核实。':'本轮候选为不同地点，同一景区的入口、停车场、售票处及同质分店不视为新的游览选择。',d&&d.key!=='food'?'本轮以游览景点为主，餐馆不能替代游览体验。':'游览与餐饮分别标明。','原有明确约束仍保留：'+String(brief.preferences||'无补充').slice(0,400),excluded.length?'已看过、已安排或不感兴趣的地点，期待避开：'+excluded.slice(-24).map(x=>x.name).join('、'):''].filter(Boolean).join('；').slice(0,1450);
 return {payload:{city,country,interests:[...interests].slice(0,3),preferences},excludedIds,excludedNames,direction:d?.key||'',turn,center,seen:prior.seen||[],nearby};
}
function distanceKm(a,b){const rad=x=>x*Math.PI/180;const x=rad(b[1]-a[1]),y=rad(b[0]-a[0]);const s=Math.sin(x/2)**2+Math.cos(rad(a[1]))*Math.cos(rad(b[1]))*Math.sin(y/2)**2;return 6371*2*Math.asin(Math.min(1,Math.sqrt(s)));}
function coordinate(value){if(typeof value!=='string')return null;const p=value.split(',').map(Number);return p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90?p:null;}
function freshRecommendations(data,request){const pois=new Map((data.pois||[]).map(p=>[p.id,p])),seenIds=new Set(),seenNames=new Set();let repeated=0,remote=0;
 const recommendations=[];
 for(const r of data.recommendations||[]){const p=pois.get(r.id);if(!p||seenIds.has(p.id)||seenNames.has(nameKey(p.name)))continue;seenIds.add(p.id);seenNames.add(nameKey(p.name));
  if(request.excludedIds.has(p.id)||request.excludedNames.has(nameKey(p.name))){repeated++;continue;}
  if(request.direction&&request.direction!=='food'&&r.role==='food')continue;
  const point=coordinate(p.location),center=coordinate(request.center);
  // Only a rough exclusion of clearly distant places, never proof of road feasibility.
  if(request.nearby&&point&&center&&distanceKm(center,point)>120){remote++;continue;}
  recommendations.push(request.nearby?{...r,reason:r.reason+'；周边方向候选，是否适合一日往返需核实'}:{...r});
 }
 return {recommendations,repeated,remote};
}
function visibleRanks(pool,plan,choices,city){const usedIds=new Set(),usedNames=new Set();for(const d of plan.days||[])for(const s of [...(d.stops||[]),...(d.local_food||[])]){if(s.candidate_id)usedIds.add(s.candidate_id);if(d.city===city){usedNames.add(nameKey(s.name));if(s.location_name)usedNames.add(nameKey(s.location_name));}}
 const pois=new Map((pool.pois||[]).map(p=>[p.id,p]));return (pool.recommendations||[]).filter(r=>{const p=pois.get(r.id);return p&&!usedIds.has(r.id)&&!usedNames.has(nameKey(p.name))&&choices[r.id]!=='excluded';});}
root.CandidateDiscovery={directions,directionFor,nameKey,rememberSeen,buildRequest,freshRecommendations,visibleRanks,distanceKm};
if(typeof module!=='undefined'&&module.exports)module.exports=root.CandidateDiscovery;
})(globalThis);
