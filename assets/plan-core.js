/* Pure Plan workflow rules. No network, DOM, or storage side effects. */
(function(root){
  'use strict';
  const STAGES=['overview','days','review','transport','final'];
  const SLOTS=['上午','中午','下午','傍晚','晚上','时间灵活'];
  const clone=value=>JSON.parse(JSON.stringify(value));
  const text=(value,max=500)=>typeof value==='string'?value.trim().slice(0,max):'';
  const normalize=value=>text(value).normalize('NFKC').replace(/[\s·•（）()]/g,'').toLowerCase();
  function fingerprint(value){let hash=2166136261;for(const c of JSON.stringify(value)){hash^=c.charCodeAt(0);hash=Math.imul(hash,16777619);}return (hash>>>0).toString(36);}
  function dayKey(day,index){return index+'|'+(day.day_label||'D'+(index+1))+'|'+day.city;}
  function stopKey(stop){return stop.workflow_key||stop.candidate_id||'name:'+normalize(stop.name);}
  function isActivity(stop){return ['transport','rest'].includes(stop.activity_kind)||/转场|自由活动|返回.*休息|^休息$|^乘(?:车|火车|高铁|飞机)/.test(stop.name||'');}
  function createFlow(plan,version=1){return {schema:2,baseVersion:version,baseFingerprint:fingerprint(plan),stage:'overview',activeDay:0,revision:0,confirmed:{},edits:{},review:null,reviewRevision:null,answers:{},transport:{},bookings:{},finalVersion:null,customText:''};}
  function restoreFlow(raw,plan,version){
    if(!raw||raw.schema!==2||raw.baseVersion!==version||raw.baseFingerprint!==fingerprint(plan))return createFlow(plan,version);
    const flow={...createFlow(plan,version),...clone(raw)};
    flow.stage=STAGES.includes(flow.stage)?flow.stage:'overview';flow.activeDay=Math.max(0,Math.min(Number(flow.activeDay)||0,(plan.days||[]).length-1));
    for(const key of ['edits','confirmed','answers','transport','bookings'])if(!flow[key]||typeof flow[key]!=='object'||Array.isArray(flow[key]))flow[key]={};
    if(flow.review&&flow.reviewRevision!==flow.revision){flow.review=null;flow.answers={};flow.transport={};if(!['overview','days'].includes(flow.stage))flow.stage='days';}
    return flow;
  }
  function editFor(flow,key){return flow.edits[key]||(flow.edits[key]={removed:[],added:[],slots:{},order:[]});}
  function invalidate(flow,key){flow.revision++;if(key)delete flow.confirmed[key];flow.review=null;flow.reviewRevision=null;flow.answers={};flow.transport={};flow.bookings={};flow.finalVersion=null;if(!['overview','days'].includes(flow.stage))flow.stage='days';}
  function materialize(base,flow){
    const plan=clone(base);
    plan.days=(plan.days||[]).map((day,i)=>{
      const key=dayKey(day,i),edit=flow.edits[key]||{};
      for(const field of ['stops','local_food']){
        day[field]=(day[field]||[]).filter(s=>!(edit.removed||[]).includes(stopKey(s))).map(s=>({...s,workflow_key:stopKey(s)}));
        for(const added of edit.added||[])if((added.role==='food'?'local_food':'stops')===field&&!day[field].some(s=>stopKey(s)===stopKey(added.stop)))day[field].push({...clone(added.stop),workflow_key:stopKey(added.stop)});
        day[field]=day[field].map(s=>({...s,...(field==='stops'&&edit.slots?.[stopKey(s)]?{time:edit.slots[stopKey(s)],workflow_time_locked:true}:{})}));
      }
      if(edit.order?.length)day.stops.sort((a,b)=>{const ai=edit.order.indexOf(stopKey(a)),bi=edit.order.indexOf(stopKey(b));return (ai<0?999:ai)-(bi<0?999:bi);});
      return {...day,workflow_day_key:key};
    });return plan;
  }
  function addCandidate(base,flow,index,poi,role='sight',reason='你加入的选择'){
    if(!poi?.id||!text(poi.name)||!['sight','food'].includes(role))throw new Error('地点信息不完整，请重新筛选。');
    const plan=materialize(base,flow),day=plan.days[index];if(!day)throw new Error('这一天不存在。');
    if(plan.days.some(d=>[...d.stops,...d.local_food].some(s=>s.candidate_id===poi.id)))throw new Error('这个地点已在行程中，可先查看已安排的那一天。');
    const key=dayKey(base.days[index],index),edit=editFor(flow,key);edit.removed=edit.removed.filter(k=>k!==poi.id);
    const verified=poi.source!=='model_knowledge'&&Boolean(poi.location);
    edit.added.push({role,stop:{candidate_id:poi.id,name:poi.name,workflow_key:poi.id,time:'时间灵活',duration:'时长待估算',reason,location:verified?poi.location:'',location_source:verified?'amap':'unverified',coordinate_system:verified?'GCJ02':'',verification:verified?'地点已匹配；开放、预约与票务待核验':'AI 推荐线索；地点位置、开放与预约待核验',activity_kind:role==='food'?'food':'sight'}});
    invalidate(flow,key);
  }
  function removeStop(base,flow,index,key){
    const day=base.days[index];if(!day)throw new Error('这一天不存在。');const dk=dayKey(day,index),edit=editFor(flow,dk);
    const added=edit.added.find(x=>stopKey(x.stop)===key);if(added)edit.added=edit.added.filter(x=>x!==added);else if(!edit.removed.includes(key))edit.removed.push(key);
    invalidate(flow,dk);
  }
  function restoreStop(base,flow,index,key){const dk=dayKey(base.days[index],index),edit=editFor(flow,dk);edit.removed=edit.removed.filter(k=>k!==key);invalidate(flow,dk);}
  function setSlot(base,flow,index,key,slot){if(!SLOTS.includes(slot))throw new Error('请选择时间段。');const dk=dayKey(base.days[index],index);editFor(flow,dk).slots[key]=slot;invalidate(flow,dk);}
  function confirmDay(base,flow,index){const p=materialize(base,flow),day=p.days[index];flow.confirmed[dayKey(base.days[index],index)]=fingerprint(day);}
  function confirmRemaining(base,flow){base.days.forEach((_,i)=>confirmDay(base,flow,i));}
  function reviewSnapshot(plan){
    return {summary:text(plan.summary,500),map_pending:clone(plan.map_pending||[]),city_sequence:clone(plan.city_sequence||[]),intercity_transport:clone(plan.intercity_transport||[]),checks:(plan.checks||[]).map(x=>text(x,500)),questions:(plan.questions||[]).map(x=>text(x,500)),days:(plan.days||[]).map((d,i)=>({day_label:d.day_label,city:d.city,title:d.title,workflow_day_key:d.workflow_day_key||dayKey(d,i),travel_notes:text(d.travel_notes,500),stops:(d.stops||[]).map(packStop),local_food:(d.local_food||[]).map(packStop)}))};
  }
  function packStop(s){return {name:s.name,candidate_id:s.candidate_id||'',workflow_key:stopKey(s),time:s.time||'时间灵活',workflow_time_locked:Boolean(s.workflow_time_locked),duration:text(s.duration,80),reason:text(s.reason,160),area:text(s.area,100),location_name:s.location_name||s.name,location:s.location||'',location_source:s.location_source||'unverified',location_status:s.location_status||'pending',coordinate_system:s.coordinate_system||'',activity_kind:s.activity_kind||'sight',from:s.from||'',to:s.to||'',verification:text(s.verification,160)};}
  function transportLegs(plan){
    const given=plan.intercity_transport||[];
    const inferred=[];for(let i=1;i<(plan.days||[]).length;i++)if(plan.days[i-1].city!==plan.days[i].city)inferred.push({from:plan.days[i-1].city,to:plan.days[i].city,mode:'交通方式待建议',day_label:plan.days[i].day_label});
    return (given.length?given:inferred).map((leg,i)=>({...leg,id:'leg-'+i,day_label:leg.day_label||(plan.days||[]).find(d=>d.city===leg.to)?.day_label||''}));
  }
  function validateReview(input,plan){
    if(!input||typeof input!=='object'||!text(input.summary)||!Array.isArray(input.decisions)||input.decisions.length>8)throw new Error('AI 评估结构不完整，请重试；每天的选择已保留。');
    const days=new Map(plan.days.map((d,i)=>[d.workflow_day_key||dayKey(d,i),d])),ids=new Set();
    const decisions=input.decisions.map((d,i)=>{
      if(!text(d.question)||!Array.isArray(d.options)||d.options.length!==2)throw new Error('AI 尚未给出明确的 A/B 取舍，请重试评估。');
      const id=text(d.id,80)||'decision-'+i;if(ids.has(id))throw new Error('AI 问题重复，请重试评估。');ids.add(id);
      const options=d.options.map((o,j)=>{
        if(!text(o.label)||!text(o.reason)||/帮我比较|生成.*比较/.test(o.label)||!Array.isArray(o.changes)||o.changes.length>12)throw new Error('AI 选项不完整，请重试评估。');
        const changes=o.changes.map(c=>{
          const day=days.get(c.day_key),target=days.get(c.target_day_key);const field=c.field==='local_food'?'local_food':'stops';const stop=day?.[field]?.find(s=>stopKey(s)===c.stop_key);
          if(!stop||isActivity(stop)||!['remove','time','move'].includes(c.type))throw new Error('AI 调整未对应到已选地点，请重试评估。');
          if(c.type==='time'&&!SLOTS.includes(c.value))throw new Error('AI 时间段无效，请重试评估。');
          if(c.type==='move'&&(!target||target.city!==day.city||target===day))throw new Error('AI 跨日调整不在同一城市，请重试评估。');
          return {type:c.type,day_key:c.day_key,stop_key:c.stop_key,field,...(c.type==='time'?{value:c.value}:{}),...(c.type==='move'?{target_day_key:c.target_day_key}:{})};
        });return {id:j?'B':'A',label:text(o.label,150),reason:text(o.reason,350),changes};
      });
      if(normalize(options[0].label)===normalize(options[1].label))throw new Error('AI 返回了相同的两个选项，请重试评估。');
      const proposed=typeof d.recommended==='string'?d.recommended.trim().toUpperCase():'';return {id,question:text(d.question,1000),reason:text(d.reason,600),recommended:['A','B'].includes(proposed)?proposed:'',options};
    });
    const transport=normalizeTransport(input.transport,plan);
    const bookings=(Array.isArray(input.bookings)?input.bookings:[]).filter(b=>b&&text(b.title)&&text(b.action)).slice(0,24).map((b,i)=>({id:'booking-'+i,title:text(b.title,160),action:text(b.action,500),day_label:text(b.day_label,80),category:['ticket','hotel','transport'].includes(b.category)?b.category:'ticket',priority:b.priority==='early'?'early':'normal',verification:'待按出行日期核实'}));
    return {summary:text(input.summary,1200),deferred:input.deferred===true,day_notes:(Array.isArray(input.day_notes)?input.day_notes:[]).slice(0,plan.days.length).map(n=>({day_label:text(n.day_label,80),note:text(n.note,500)})),decisions,transport,bookings};
  }
  function normalizeTransport(input,plan){
    const rows=Array.isArray(input)?input:[];
    return transportLegs(plan).map(leg=>{
      const matches=rows.filter(row=>row&&row.id===leg.id),row=matches.length===1?matches[0]:{};
      const ids=new Set();
      const options=(Array.isArray(row.options)?row.options:[]).filter(o=>o&&o.id!=='pending').slice(0,2).map((o,i)=>({id:['A','B'].includes(o.id)?o.id:(i?'B':'A'),mode:text(o.mode,80),reason:text(o.reason,500)||'适用条件、费用和衔接仍需核实。'})).filter(o=>{if(!o.mode||o.mode==='待定'||ids.has(o.id))return false;ids.add(o.id);return true;});
      const recommendation=typeof row.recommended==='string'?row.recommended.trim().toUpperCase():'';
      const valid=options.some(o=>o.id===recommendation);
      const recommended=valid?recommendation:'pending';
      options.push({id:'pending',mode:'待定',reason:'先保留这段行程，之后再确认交通方式、班次和换乘。'});
      return {...leg,options,recommended,status:valid?'suggested':'pending',pending_reason:valid?'':text(row.pending_reason,300)||(matches.length!==1?'这段交通建议尚未完整返回。':'AI 尚未给出可对应的推荐选项；不是你的路线有错。'),notes:text(row.notes,600)||'具体方式、班次、票价及衔接时间待按出行日期核实。'};
    });
  }

  function applyReview(plan,review,answers){
    const result=clone(plan),dayMap=new Map(result.days.map((d,i)=>[d.workflow_day_key||dayKey(d,i),d]));
    for(const d of review?.decisions||[]){const answer=answers[d.id];if(!answer)continue;const option=d.options.find(o=>o.id===answer);if(!option)throw new Error('选择未匹配当前问题。');
      for(const c of option.changes){const day=dayMap.get(c.day_key),field=c.field||'stops',index=day?.[field]?.findIndex(s=>stopKey(s)===c.stop_key);if(index==null||index<0)throw new Error('两个调整影响同一地点，请回到每天安排重新确认。');const stop=day[field][index];
        if(c.type==='remove')day[field].splice(index,1);else if(c.type==='time')stop.time=c.value;else if(c.type==='move'){const target=dayMap.get(c.target_day_key);day[field].splice(index,1);target[field].push(stop);}
      }
    }return result;
  }
  function adoptReviewedPlan(base,flow,reviewed){
    const edits={};
    base.days.forEach((day,i)=>{
      const after=reviewed.days[i],key=dayKey(day,i),edit={removed:[],added:[],slots:{},order:after.stops.map(stopKey)};
      for(const field of ['stops','local_food']){
        const original=day[field]||[],actual=after[field]||[];
        edit.removed.push(...original.filter(s=>!actual.some(a=>stopKey(a)===stopKey(s))).map(stopKey));
        for(const s of actual){const old=original.find(o=>stopKey(o)===stopKey(s));if(!old)edit.added.push({role:field==='local_food'?'food':'sight',stop:clone(s)});else if(field==='stops'&&(s.workflow_time_locked||old.time!==s.time)&&SLOTS.includes(s.time))edit.slots[stopKey(s)]=s.time;}
      }
      edits[key]=edit;
    });
    flow.edits=edits;invalidate(flow);flow.confirmed={};
  }
  function finalCandidateChoices(plan,pools,previous={}){
    const selected=new Set(plan.days.flatMap(d=>[...d.stops,...(d.local_food||[])]).map(s=>s.candidate_id).filter(Boolean));
    const choices={};for(const [id,value] of Object.entries(previous))if(value==='excluded'&&!selected.has(id))choices[id]='excluded';
    for(const pool of Object.values(pools))for(const p of pool.pois||[])choices[p.id]=selected.has(p.id)?'locked':'excluded';
    return choices;
  }
  function assertFinalPlan(input,expected,review,transportChoices){
    if(!input||!Array.isArray(input.days)||!Array.isArray(input.city_sequence)||input.days.length!==expected.days.length)throw new Error('AI 改变了已确认的天数，未覆盖你的选择，请重试。');
    if(JSON.stringify(input.city_sequence.map(c=>[c.city,c.country]))!==JSON.stringify(expected.city_sequence.map(c=>[c.city,c.country])))throw new Error('AI 改变了已确认的城市顺序，请重试。');
    const result=clone(input);
    result.days.forEach((day,i)=>{
      const before=expected.days[i];if(day.city!==before.city||day.day_label!==before.day_label||!Array.isArray(day.stops))throw new Error('AI 改变了日期归属，请重试。');
      for(const field of ['stops','local_food']){
        const original=before[field]||[],actual=day[field]||[];
        if(!Array.isArray(actual)||actual.length!==original.length)throw new Error('AI 返回的 '+day.day_label+' '+(field==='local_food'?'美食':'景点')+' 数量与已确认安排不一致，原行程保留。');
        const remaining=new Set(original.map((_,index)=>index));
        const id=s=>s.candidate_id==null?'':String(s.candidate_id).trim();
        day[field]=actual.map(s=>{
          let matches=[...remaining].filter(index=>id(s)&&id(original[index])===id(s));
          if(!matches.length)matches=[...remaining].filter(index=>normalize(original[index].name)===normalize(s.name)&&!(id(s)&&id(original[index])&&id(s)!==id(original[index])));
          if(matches.length!==1)throw new Error('AI 返回的 '+day.day_label+' 地点身份不一致：'+(text(s.name,80)||'未命名地点')+'；原行程保留。');
          const index=matches[0],old=original[index];remaining.delete(index);
          if(old.workflow_time_locked&&!String(s.time||'').includes(old.time))throw new Error('AI 改变了你指定的时间段，原行程保留。');
          return {...s,name:old.name,candidate_id:old.candidate_id||'',location:old.location||'',location_name:old.location_name||old.name,location_source:old.location_source||'unverified',location_status:old.location_status||(old.location_source==='amap'&&old.location?'matched':'pending'),coordinate_system:old.coordinate_system||'',activity_kind:old.activity_kind||'sight',verification:old.verification||'待核验',workflow_key:stopKey(old)};
        });
      }
    });
    return completeFinalMetadata(result,expected,review,transportChoices);
  }
  function completeFinalMetadata(result,expected,review,transportChoices){
    result.intercity_transport=(review?.transport||[]).map(leg=>{const selected=transportChoices[leg.id]||'pending';const choice=selected==='pending'?{mode:'待定'}:leg.options.find(o=>o.id===selected);if(!choice)throw new Error('请重新选择 '+leg.from+' → '+leg.to+' 的交通方式，或设为待定。');return {from:leg.from,to:leg.to,day_label:leg.day_label,mode:selected==='pending'?'待定':choice.mode,status:selected==='pending'?'pending':'suggested',notes:leg.notes,verification:selected==='pending'?'交通待定；需确认方式、班次及换乘，当前不是已可执行的交通安排':'建议方式；班次、票价与衔接时间待核实'};});
    result.map_pending=clone(expected.map_pending||[]);result.checks=[...new Set([...(expected.checks||[]),...(result.checks||[])])];for(const leg of result.intercity_transport)if(leg.status==='pending')result.checks.push('交通待定：'+leg.from+' → '+leg.to+'；出发前请确认交通方式、班次与换乘缓冲。');if(review?.deferred)result.checks.push('综合评估尚未完成；本版保留用户当前景点安排，出发前需继续检查节奏与衔接。');result.checks=[...new Set(result.checks)];result.questions=[];return result;
  }
  function assembleConfirmedPlan(plan,review,transportChoices){
    const final=completeFinalMetadata(clone(plan),plan,review,transportChoices);
    final.ai_refinement_status='not_requested';
    final.checks=[...new Set([...final.checks,'行程按用户已确认的地点、时段和交通选择直接整理；更细的交通耗时与时间优化尚待补充。'])];
    return final;
  }
  const api={STAGES,SLOTS,clone,normalize,fingerprint,dayKey,stopKey,isActivity,createFlow,restoreFlow,editFor,invalidate,materialize,addCandidate,removeStop,restoreStop,setSlot,confirmDay,confirmRemaining,reviewSnapshot,transportLegs,normalizeTransport,validateReview,applyReview,adoptReviewedPlan,finalCandidateChoices,assertFinalPlan,assembleConfirmedPlan};
  root.PlanCore=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
