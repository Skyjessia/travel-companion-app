import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import worker,{planPoiQueries,rankPoiCandidates,validatePoolPlan,isPlaceholderStop,resolveMapItem,recommendInternationalCandidates} from '../worker/travel-companion.mjs';
const realFetch=globalThis.fetch;
const json=x=>new Response(JSON.stringify(x),{headers:{'Content-Type':'application/json'}});
const candidate={id:'p1',name:'测试博物馆',type:'博物馆',location:'106.7,26.5'};
const context={candidate_pools:[{city:'贵阳',candidates:[candidate]}],candidate_choices:{p1:'locked'}};
const plan=()=>({summary:'测试',city_sequence:[{city:'贵阳'}],days:[{city:'贵阳',stops:[{candidate_id:'p1',name:'模型改名'}]}]});
test('query planning receives preferences and produces distinct searches for interests',async()=>{
 try{
  const captured=[];globalThis.fetch=async(url,opts)=>{const body=JSON.parse(opts.body);assert.match(body.messages[0].content,/json/i);const input=JSON.parse(body.messages[1].content);captured.push(input);return json({choices:[{message:{content:JSON.stringify({queries:[{interest:input.interests[0],keyword:input.interests[0]==='历史文化'?'博物馆':'菜市场'}]})}}]});};
  const a=await planPoiQueries({DEEPSEEK_API_KEY:'test'},'贵阳',['历史文化'],'不喜欢商业化');
  const b=await planPoiQueries({DEEPSEEK_API_KEY:'test'},'贵阳',['地方生活'],'想看当地生活');
  assert.equal(captured[0].preferences,'不喜欢商业化');assert.notEqual(a.queries[0].keyword,b.queries[0].keyword);
 }finally{globalThis.fetch=realFetch;}
});
test('upstream failure falls back to concrete, balanced category queries',async()=>{
 try{globalThis.fetch=async()=>{throw new Error('unavailable')};const r=await planPoiQueries({DEEPSEEK_API_KEY:'test'},'贵阳',['历史文化','地方生活'],'');assert.equal(r.queries.length,6);assert.deepEqual(r.queries.slice(0,2).map(x=>x.interest),['历史文化','地方生活']);assert.ok(r.warning);assert.ok(!r.queries.some(q=>q.keyword==='历史文化景点'));}finally{globalThis.fetch=realFetch;}
});
test('stable candidate identity canonicalizes model name but does not verify opening hours',()=>{
 const p=plan();assert.equal(validatePoolPlan(p,context),'');assert.equal(p.days[0].stops[0].name,candidate.name);assert.match(p.days[0].stops[0].verification,/待核验/);
});
test('reject invented, repeated, excluded, missing locked and missing city candidates',()=>{
 let p=plan();p.days[0].stops[0].candidate_id='invented';assert.ok(validatePoolPlan(p,context));
 p=plan();p.days[0].stops.push({...p.days[0].stops[0]});assert.ok(validatePoolPlan(p,context));
 assert.ok(validatePoolPlan(plan(),{...context,candidate_choices:{p1:'excluded'}}));
 p=plan();p.days[0].stops=[];assert.ok(validatePoolPlan(p,context));
 p=plan();p.days=[];assert.ok(validatePoolPlan(p,context));
});
test('POI endpoint deduplicates IDs and preserves search provenance without matching labels',async()=>{
 try{
  globalThis.fetch=async(url,opts)=>{
   if(String(url).includes('deepseek'))return json({choices:[{message:{content:JSON.stringify({queries:[{interest:'历史文化',keyword:'博物馆'},{interest:'地方生活',keyword:'老街'}]})}}]});
   return json({status:'1',count:'1',pois:[candidate]});
  };
  const response=await worker.fetch(new Request('https://example.test/api/poi/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({city:'贵阳',interests:['历史文化','地方生活'],preferences:'慢游'})}),{DEEPSEEK_API_KEY:'test',AMAP_WEB_KEY:'test'});
  const data=await response.json();assert.equal(response.status,200);assert.equal(data.contractVersion,3);assert.equal(data.pois.length,1);assert.equal(data.pois[0].search_provenance.length,2);assert.deepEqual(data.pois[0].interests,[]);
 }finally{globalThis.fetch=realFetch;}
});
test('assistant endpoint rejects a model response that drops locked candidate',async()=>{
 try{
  globalThis.fetch=async()=>json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({...plan(),days:[{city:'贵阳',stops:[]}]})}}]});
  const response=await worker.fetch(new Request('https://example.test/api/assistant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({task:'plan',message:'安排',context})}),{DEEPSEEK_API_KEY:'test'});
  assert.equal(response.status,502);assert.equal((await response.json()).code,'CANDIDATE_CONSTRAINT_FAILED');
 }finally{globalThis.fetch=realFetch;}
});
function frontend(){
 const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const snippet=source.slice(source.indexOf('function poolSelectedIds(){'),source.indexOf('const POI_INTEREST_LIMIT = 3;'));
 const poolFn=source.slice(source.indexOf('function poolContext(){'),source.indexOf('const POI_INTEREST_LIMIT = 3;'));
 const sandbox={Set,Map,Error,isMapActivity:s=>["transport","rest"].includes(s.activity_kind)||/转场|自由活动|返回.*休息/.test(s.name||""),candidatePools:{贵阳:{city:'贵阳',pois:[candidate],rankingStatus:'ranked',recommendations:[{id:'p1',reason:'兴趣匹配',role:'sight'}],queries:[]}},candidateChoices:{},candidatePoolBusy:false,candidateExplorerCity:'',planDiscussionBusy:false,lastAiPlan:plan(),planHasStructuredData:p=>!!p?.days?.length,savePlanSession:()=>{},renderPlanResult:()=>{},toast:()=>{}};
 vm.createContext(sandbox);vm.runInContext(snippet,sandbox);return sandbox;
}
test('model context uses AI shortlist and always retains explicit choices',()=>{
 const f=frontend();f.lastAiPlan={days:[]};const pois=Array.from({length:98},(_,i)=>({...candidate,id:'p'+i}));
 f.candidatePools={贵阳:{city:'贵阳',pois,rankingStatus:'ranked',recommendations:[{id:'p40',reason:'更符合兴趣',role:'sight'},{id:'p2',reason:'互补体验',role:'sight'}],queries:[]}};f.candidateChoices={p97:'locked'};
 const result=f.poolContext().candidate_pools[0].candidates;assert.deepEqual(Array.from(result,p=>p.id),['p97','p40','p2']);
});
test('ranking validates identities, removes duplicates, and limits the shortlist',async()=>{
 try{
  const pois=Array.from({length:98},(_,i)=>({...candidate,id:'p'+i}));
  globalThis.fetch=async(url,options)=>{const request=JSON.parse(options.body);assert.equal(request.thinking.type,'disabled');return json({choices:[{message:{content:JSON.stringify({recommendations:[{id:'invented',role:'sight',reason:'假的'},...pois.slice(0,16).map(p=>({id:p.id,role:'sight',reason:'名称类别与兴趣匹配',matched_interests:['历史文化','假的']})),{id:'p0',role:'sight',reason:'重复'}]})}}]});};
  const result=await rankPoiCandidates({DEEPSEEK_API_KEY:'test'},'贵阳',['历史文化'],'慢游',pois);
  assert.equal(result.status,'ranked');assert.equal(result.recommendations.length,12);assert.equal(result.recommendations[0].id,'p0');assert.deepEqual(result.recommendations[0].matched_interests,['历史文化']);
 }finally{globalThis.fetch=realFetch;}
});
test('ranking failure never substitutes raw search order for AI recommendations',async()=>{
 try{globalThis.fetch=async()=>json({choices:[{message:{content:'{}'}}]});const result=await rankPoiCandidates({DEEPSEEK_API_KEY:'test'},'贵阳',['历史文化'],'',[candidate]);assert.equal(result.status,'unavailable');assert.deepEqual(result.recommendations,[]);}finally{globalThis.fetch=realFetch;}
});
test('placeholder travel schedule rejected while named attractions accepted',()=>{
 assert.equal(isPlaceholderStop('衡阳城市历史人文地点'),true);assert.equal(isPlaceholderStop('衡阳地方生活街区'),true);assert.equal(isPlaceholderStop('衡阳特色餐饮区域'),true);assert.equal(isPlaceholderStop('测试博物馆'),false);
 const p=plan();p.days[0].stops[0].name='衡阳城市历史人文地点';assert.ok(validatePoolPlan(p,{}));
});
test('locked dining candidate can be arranged as optional daily local food',()=>{
 const p=plan();p.days[0].stops=[{name:'具体地点',candidate_id:'p2'}];p.days[0].local_food=[{name:'改名',candidate_id:'p1'}];
 const c={candidate_pools:[{city:'贵阳',candidates:[candidate,{...candidate,id:'p2',name:'测试古迹'}]}],candidate_choices:{p1:'locked'}};
 assert.equal(validatePoolPlan(p,c),'');assert.equal(p.days[0].local_food[0].name,candidate.name);
 c.candidate_choices.p1='excluded';assert.ok(validatePoolPlan(p,c));
});
test('map resolver keeps ambiguous POIs off the map',async()=>{
 try{globalThis.fetch=async()=>json({status:'1',pois:[{id:'a',name:'测试同名公园',location:'112,28'},{id:'b',name:'测试同名公园',location:'113,29'}]});const r=await resolveMapItem({AMAP_WEB_KEY:'test'},{key:'ambiguous',kind:'sight',name:'测试同名公园',city:'长沙',country:'中国'});assert.equal(r.status,'ambiguous');assert.equal(r.location,undefined);}finally{globalThis.fetch=realFetch;}
});
test('map resolver supports a uniquely matched county and reports its coordinate system',async()=>{
 try{globalThis.fetch=async()=>json({status:'1',geocodes:[{district:'测试侗族自治县',city:'怀化市',province:'湖南省',level:'区县',location:'109.68,27.44'}]});const r=await resolveMapItem({AMAP_WEB_KEY:'test'},{key:'county',kind:'city',name:'测试',city:'测试',country:'中国'});assert.equal(r.status,'matched');assert.equal(r.coordinate_system,'GCJ02');}finally{globalThis.fetch=realFetch;}
});
test('foreign map lookup remains explicitly unsupported instead of guessing',async()=>{
 try{globalThis.fetch=async()=>{throw new Error('must not call')};const r=await resolveMapItem({AMAP_WEB_KEY:'test'},{key:'foreign',kind:'city',name:'京都',city:'京都',country:'日本'});assert.equal(r.status,'unsupported');assert.equal(r.location,undefined);}finally{globalThis.fetch=realFetch;}
});
function mapHelpers(){
 const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const snippet=source.slice(source.indexOf('function mapKey('),source.indexOf('function rememberMapLocation('));
 const sandbox={Math,Number,JSON,candidatePools:{}};vm.createContext(sandbox);vm.runInContext(snippet,sandbox);return sandbox;
}
test('coordinate display preserves longitude/latitude order and compensates GCJ offset',()=>{
 const f=mapHelpers();const wgs=[116.397128,39.916527];const gcj=f.wgsToGcj(...wgs);const display=f.displayCoordinate(gcj.join(','),'GCJ02');assert.ok(Math.abs(display[0]-wgs[1])<1e-7);assert.ok(Math.abs(display[1]-wgs[0])<1e-7);
 assert.deepEqual(Array.from(f.displayCoordinate('139.7,35.6','WGS84')),[35.6,139.7]);assert.equal(f.displayCoordinate('bad'),null);assert.equal(f.parseMapCoordinate('181,91'),null);
});
test('model-only coordinates are never trusted as matched map locations',()=>{
 const f=mapHelpers();const unverified=f.stopMapDescriptor({name:'模型地点',location:'112,28'},'长沙','中国');assert.equal(unverified.location,null);
 f.candidatePools={长沙:{pois:[{id:'actual',name:'地图地点',location:'112,28'}]}};const known=f.stopMapDescriptor({candidate_id:'actual',name:'地图地点'},'长沙','中国');assert.equal(known.location,'112,28');
});


test('ranking retries a transient failure once and accepts fenced JSON',async()=>{
 let calls=0;
 try{globalThis.fetch=async()=>{calls++;if(calls===1)return new Response('',{status:503});return json({choices:[{message:{content:'```json\n'+JSON.stringify({recommendations:[{id:'p1',role:'sight',reason:'匹配历史兴趣'}]})+'\n```'}}]});};const r=await rankPoiCandidates({DEEPSEEK_API_KEY:'test'},'贵阳',['历史文化'],'',[candidate]);assert.equal(calls,2);assert.equal(r.status,'ranked');}finally{globalThis.fetch=realFetch;}
});

test('ranking JSON request satisfies provider prompt contract and does not retry HTTP 400',async()=>{
 let calls=0;try{globalThis.fetch=async(_url,options)=>{calls++;const b=JSON.parse(options.body);assert.equal(b.response_format.type,'json_object');assert.match(b.messages[0].content,/json/i);return new Response('',{status:400});};const r=await rankPoiCandidates({DEEPSEEK_API_KEY:'test'},'贵阳',['历史文化'],'',[candidate]);assert.equal(calls,1);assert.match(r.warning,/DS_HTTP_400/);}finally{globalThis.fetch=realFetch;}
});
test('day comparison highlights changed and added days, reports removal, ignores verification wording',()=>{
 const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');const snippet=source.slice(source.indexOf('function comparableDay('),source.indexOf('function isGenericPlanStop('));const f={Set,Map,JSON};vm.createContext(f);vm.runInContext(snippet,f);
 const before={days:[{day_label:'D1',city:'贵阳',stops:[{name:'古迹',verification:'待核'}]},{day_label:'D2',city:'贵阳',stops:[]}]};
 const same=JSON.parse(JSON.stringify(before));same.days[0].stops[0].verification='仍待核';assert.equal(f.planDayChanges(same,before).changed.size,0);
 const after={days:[{day_label:'D1',city:'贵阳',stops:[{name:'新景点'}]},{day_label:'D3',city:'贵阳',stops:[]}]};const changes=f.planDayChanges(after,before);assert.deepEqual([...changes.changed],['D1','D3']);assert.deepEqual([...changes.removed],['D2']);
});


test('sketch uses real geography with a uniform scale and leaves missing locations absent',()=>{
 const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');const f={Math};vm.createContext(f);vm.runInContext(source.slice(source.indexOf('function sketchCoordinates('),source.indexOf('function renderRouteSketch(')),f);
 const p=f.sketchCoordinates([{xy:[112,27]},{xy:[111,27]},{xy:[111,28]},{xy:null}],800,560);assert.ok(p[0][0]>p[1][0]);assert.ok(p[2][1]<p[1][1]);assert.equal(p[3],null);assert.ok(Math.abs((p[0][0]-p[1][0])/(p[1][1]-p[2][1])-Math.cos(27.5*Math.PI/180))<0.01);
});
test('context compaction removes duplicate metadata and keeps all days, cities and chosen candidates',()=>{
 const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');const f={lastAiPlan:{city_sequence:Array.from({length:9},(_,i)=>({city:'城'+i,country:'中国'})),intercity_transport:[]}};vm.createContext(f);vm.runInContext(source.slice(source.indexOf('function compactPlanContext('),source.indexOf('function buildPlanContext(')),f);
 const context={current_plan:{days:Array.from({length:14},(_,i)=>({day_label:'D'+i,local_food:[{name:'特色菜',source:'x'.repeat(20000)}]}))},candidate_choices:{p9:'locked'},candidate_pools:[{city:'城0',candidates:Array.from({length:12},(_,i)=>({id:'p'+i,name:'景点'+i,type:'景点',assessment:{reason:'匹配',extra:'x'.repeat(5000)}}))}]};f.compactPlanContext(context,'plan_discussion');assert.equal(context.current_plan.days.length,14);assert.equal(context.current_plan.city_sequence.length,9);assert.ok(context.candidate_pools[0].candidates.some(p=>p.id==='p9'));assert.ok(JSON.stringify(context).length<6000);
});


test('guided discussion endpoint requests structured JSON and exposes dynamic decision data',async()=>{
 try{globalThis.fetch=async(_url,options)=>{const b=JSON.parse(options.body);assert.equal(b.response_format.type,'json_object');assert.ok(b.messages.some(m=>typeof m.content==='string'&&m.content.includes('本轮唯一需要决定的问题')));return json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({reply:'已理解',question:'多出的一晚放哪？',options:[{label:'怀化',value:'怀化加一晚'},{label:'贵阳',value:'贵阳加一晚'}],ready:false})}}]});};
 const response=await worker.fetch(new Request('https://example.test/api/assistant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({task:'chat',message:'帮我比较',context:{mode:'plan_discussion'}})}),{DEEPSEEK_API_KEY:'test'});assert.equal(response.status,200);assert.equal((await response.json()).data.options[1].value,'贵阳加一晚');
 }finally{globalThis.fetch=realFetch;}
});

test('map descriptors reuse exact candidate identity and classify transfer separately',()=>{
 const f=mapHelpers();f.candidatePools={贵阳:{pois:[{id:'p1',name:'测试博物馆',location:'106.7,26.5'}]}};
 const d=f.stopMapDescriptor({name:'参观测试博物馆',location_name:'测试博物馆'},'贵阳','中国');assert.equal(d.id,'p1');assert.equal(d.name,'测试博物馆');assert.equal(d.location,'106.7,26.5');assert.equal(f.isMapActivity({name:'芙蓉镇至贵阳转场'}),true);assert.equal(f.isMapActivity({name:'测试博物馆'}),false);
});
test('daily preflight matches real sights, skips transfers, and reports unresolved descriptions',async()=>{
 const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');const f=mapHelpers();Object.assign(f,{API_BASE:'https://example.test',apiHeaders:()=>({}),AbortSignal,mapLocationMemory:{},rememberMapLocation:item=>{f.mapLocationMemory[item.key]=item;},candidateChoices:{},fetch:async(_url,options)=>{const items=JSON.parse(options.body).items;assert.equal(items.length,2);return json({results:items.map(p=>p.name==='测试博物馆'?{...p,status:'matched',id:'real',location:'106.7,26.5'}:{...p,status:'ambiguous'})});}});
 vm.runInContext(source.slice(source.indexOf('async function resolvePlanSights('),source.indexOf('function togglePlanInterest(')),f);
 const p={city_sequence:[{city:'贵阳',country:'中国'}],days:[{day_label:'D1',city:'贵阳',stops:[{name:'芙蓉镇至贵阳转场'},{name:'测试博物馆'},{name:'南明河沿岸'}]}]};const missing=await f.resolvePlanSights(p);assert.equal(missing.length,1);assert.equal(missing[0].name,'南明河沿岸');assert.equal(p.days[0].stops[1].location_source,'amap');assert.equal(p.days[0].stops[1].candidate_id,'real');
});

test('candidate validation accepts explicit transfer activities while retaining locked sights',()=>{
 const p=plan();p.days[0].stops.unshift({name:'A至B转场',activity_kind:'transport',from:'A',to:'B'});assert.equal(validatePoolPlan(p,context),'');p.days[0].stops=p.days[0].stops.slice(0,1);assert.ok(validatePoolPlan(p,context));
});


test('overseas recommendations do not depend on Amap and never trust model coordinates',async()=>{
 try{
  let calls=0;globalThis.fetch=async(url,opts)=>{calls++;assert.match(String(url),/deepseek/);const body=JSON.parse(opts.body);const data=JSON.parse(body.messages[1].content);assert.equal(data.country,'哈萨克斯坦');assert.equal(data.city,'阿拉木图');assert.equal(data.preferences,'历史文化');return json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({candidates:[{name:'测试海外博物馆',local_name:'Test Museum',role:'sight',reason:'测试文化偏好',location:'99,39'},{name:'测试海外博物馆',role:'sight',reason:'重复'},{name:'沿河',role:'unknown',reason:'泛称'}]})}}]});};
  const request=()=>new Request('https://example.test/api/poi/search',{method:'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':'intl-test'},body:JSON.stringify({country:'哈萨克斯坦',city:'阿拉木图',interests:['历史文化'],preferences:'历史文化'})});
  const response=await worker.fetch(request(),{DEEPSEEK_API_KEY:'test'});assert.equal(response.status,200);const data=await response.json();assert.equal(data.rankingStatus,'ranked');assert.equal(data.pois.length,1);assert.equal(data.pois[0].location,'');assert.equal(data.pois[0].source,'model_knowledge');assert.match(data.warning,/尚未核验/);assert.equal(calls,1);
  const repeat=await recommendInternationalCandidates({DEEPSEEK_API_KEY:'test'},'哈萨克斯坦','阿拉木图',['历史文化'],'历史文化');assert.equal(repeat.pois[0].id,data.pois[0].id);
 }finally{globalThis.fetch=realFetch;}
});
test('overseas upstream failure stays explicit and retryable instead of empty success',async()=>{
 try{globalThis.fetch=async()=>new Response('{}',{status:400});const r=await worker.fetch(new Request('https://example.test/api/poi/search',{method:'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':'intl-fail'},body:JSON.stringify({country:'日本',city:'京都',interests:['历史文化']})}),{DEEPSEEK_API_KEY:'test'});assert.equal(r.status,502);assert.equal((await r.json()).code,'INTERNATIONAL_CANDIDATES_FAILED');}finally{globalThis.fetch=realFetch;}
});
test('overseas selections survive frontend and Worker validation without Amap claims',()=>{
 const f=frontend();const p={id:'intl:test',name:'海外具体博物馆',source:'model_knowledge',location:''};f.candidatePools={贵阳:{city:'贵阳',pois:[p],recommendations:[{id:p.id,role:'sight',reason:'测试'}],rankingStatus:'ranked'}};f.candidateChoices={[p.id]:'locked'};
 const revised=plan();revised.days[0].stops=[{candidate_id:p.id,name:'AI 名称',location:'99,39'}];f.checkCandidatePlan(revised);assert.equal(revised.days[0].stops[0].location,'');assert.equal(revised.days[0].stops[0].location_source,'unverified');assert.match(revised.days[0].stops[0].verification,/地点位置.*待核验/);
 assert.equal(validatePoolPlan(revised,f.poolContext()),'');assert.equal(revised.days[0].stops[0].location_source,'unverified');
});
test('compact plan context preserves overseas provenance',()=>{
 const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');const sandbox={lastAiPlan:null};vm.createContext(sandbox);vm.runInContext(source.slice(source.indexOf('function compactPlanContext('),source.indexOf('function buildPlanContext(')),sandbox);const c={candidate_pools:[{city:'京都',candidates:[{id:'intl:test',name:'海外馆',source:'model_knowledge',location:'',fact_status:'待核验'}]}]};sandbox.compactPlanContext(c,'candidate_refinement');assert.equal(c.candidate_pools[0].candidates[0].source,'model_knowledge');
});
