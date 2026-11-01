import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import worker,{planPoiQueries,rankPoiCandidates,validatePoolPlan,isPlaceholderStop} from '../worker/travel-companion.mjs';
const realFetch=globalThis.fetch;
const json=x=>new Response(JSON.stringify(x),{headers:{'Content-Type':'application/json'}});
const candidate={id:'p1',name:'测试博物馆',type:'博物馆',location:'106.7,26.5'};
const context={candidate_pools:[{city:'贵阳',candidates:[candidate]}],candidate_choices:{p1:'locked'}};
const plan=()=>({summary:'测试',city_sequence:[{city:'贵阳'}],days:[{city:'贵阳',stops:[{candidate_id:'p1',name:'模型改名'}]}]});
test('query planning receives preferences and produces distinct searches for interests',async()=>{
 try{
  const captured=[];globalThis.fetch=async(url,opts)=>{const body=JSON.parse(opts.body);const input=JSON.parse(body.messages[1].content);captured.push(input);return json({choices:[{message:{content:JSON.stringify({queries:[{interest:input.interests[0],keyword:input.interests[0]==='历史文化'?'博物馆':'菜市场'}]})}}]});};
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
 const snippet=source.slice(source.indexOf('function poolSelectedIds(){'),source.indexOf('function appendCandidateExplorer('));
 const poolFn=source.slice(source.indexOf('function poolContext(){'),source.indexOf('function setCandidateChoice('));
 const sandbox={Set,Map,Error,candidatePools:{贵阳:{city:'贵阳',pois:[candidate],rankingStatus:'ranked',recommendations:[{id:'p1',reason:'兴趣匹配',role:'sight'}],queries:[]}},candidateChoices:{},candidatePoolBusy:false,candidateExplorerCity:'',planDiscussionBusy:false,lastAiPlan:plan(),planHasStructuredData:p=>!!p?.days?.length,savePlanSession:()=>{},renderPlanResult:()=>{},toast:()=>{}};
 vm.createContext(sandbox);vm.runInContext(snippet,sandbox);return sandbox;
}
test('candidate add, exclude and undo survive in model context',()=>{
 const f=frontend();f.setCandidateChoice('p1','locked');assert.equal(f.poolContext().candidate_choices.p1,'locked');f.setCandidateChoice('p1','excluded');assert.equal(f.poolContext().candidate_choices.p1,'excluded');f.setCandidateChoice('p1','excluded');assert.equal(f.poolContext().candidate_choices.p1,undefined);
});
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
test('initial Plan discovers every domestic city before a single refinement',async()=>{
 const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const snippet=source.slice(source.indexOf('async function generatePlan(){'),source.indexOf('function applyAiPlan(){'));
 const fields={origin:'长沙',destination:'衡阳',cities:'',startDate:'',endDate:'',pace:'舒适慢游',preferences:'历史与地方生活',planDays:'3'};
 const nodes=Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,{value:v}]));nodes.generated={style:{},innerHTML:''};
 const found=[];let refinements=0;
 const sandbox={document:{getElementById:id=>nodes[id],querySelector:()=>({}),querySelectorAll:()=>[]},Set,Map,
   addTextNode:()=>{},setBusy:()=>{},savePlanSession:()=>{},updatePlanReferencePreview:()=>{},toast:()=>{},buildPlanContext:()=>({}),renderPlanResult:()=>{},showAiError:(_o,e)=>{throw e;},
   apiRequest:async()=>({data:{summary:'测试',city_sequence:[{city:'长沙',country:'中国'},{city:'衡阳',country:'中国'},{city:'京都',country:'日本'}],days:[{city:'长沙',stops:[{name:'具体地点'}]}]}}),
   planHasStructuredData:()=>true,discoverCityPool:async c=>{found.push(c.city);return true;},refinePlanWithPool:async()=>{refinements++;}
 };
 vm.createContext(sandbox);vm.runInContext(snippet,sandbox);await sandbox.generatePlan();assert.deepEqual(found,['长沙','衡阳']);assert.equal(refinements,1);
});
