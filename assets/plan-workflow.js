/* Plan UI and orchestration. Every expensive action is explicit and every step is recoverable. */
let planFlow=null;
let planFlowJob=null;
let planFlowTimer=null;
let planFlowError='';
let planFlowRetry=null;
let planFlowStorageError='';
let dailyEntryBusy=false;
let planGenerationBusy=false;
const PF=PlanCore;
function workflowBusy(){return Boolean(planFlowJob||planGenerationBusy||planDiscussionBusy||candidatePoolBusy||planUploadsBusy);}
function ensurePlanFlow(){if(lastAiPlan&&(!planFlow||planFlow.baseVersion!==planVersionNumber||planFlow.baseFingerprint!==PF.fingerprint(lastAiPlan)))planFlow=PF.createFlow(lastAiPlan,planVersionNumber);return planFlow;}
function workflowDraft(){return PF.materialize(lastAiPlan,ensurePlanFlow());}
function savePlanSession(){
 try{localStorage.setItem('travelCompanionPlanSessionV1',JSON.stringify({brief:planBrief,plan:lastAiPlan,discussion:planDiscussionHistory.slice(-24),versions:planVersions.slice(-6),versionNumber:planVersionNumber,referenceMaterials:planReferenceMaterials.slice(0,5),planReferencesPending,materialInsights,candidatePools,candidateChoices,candidatePoolNotice,workflow:planFlow}));planFlowStorageError='';}
 catch{planFlowStorageError='当前设备未能保存修改，请先使用页面底部的测试备份导出，避免关闭后丢失。';}
}
function restorePlanSession(){
 try{
  const saved=JSON.parse(localStorage.getItem('travelCompanionPlanSessionV1')||'null');if(!saved)return;
  planBrief=saved.brief||null;lastAiPlan=saved.plan||null;candidatePools=saved.candidatePools||{};candidateChoices=saved.candidateChoices||{};candidatePoolNotice=saved.candidatePoolNotice||'';
  planDiscussionHistory=Array.isArray(saved.discussion)?saved.discussion:[];planVersions=Array.isArray(saved.versions)?saved.versions:[];planVersionNumber=Number(saved.versionNumber)||(lastAiPlan?1:0);
  planReferenceMaterials=Array.isArray(saved.referenceMaterials)?saved.referenceMaterials.slice(0,5):[];planReferencesPending=Boolean(saved.planReferencesPending);materialInsights=Array.isArray(saved.materialInsights)?saved.materialInsights:[];
  if(planBrief){for(const key of ['origin','destination','cities','startDate','endDate','pace','preferences']){const input=document.getElementById(key);if(input&&planBrief[key]!=null)input.value=planBrief[key];}document.getElementById('planDays').value=planBrief.durationDays||'';document.querySelectorAll('input[name=travelPace]').forEach(r=>r.checked=r.value===(planBrief.pace||'舒适慢游'));document.querySelectorAll('[data-plan-interest]').forEach(button=>{const active=(planBrief.interests||[]).includes(button.dataset.planInterest);button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});}
  if(lastAiPlan){planFlow=PF.restoreFlow(saved.workflow,lastAiPlan,planVersionNumber);if(!saved.workflow)migratePendingChoices();renderPlanResult(lastAiPlan);}updatePlanReferencePreview();
 }catch(error){planFlowError='之前的方案未能完整读取，请保留测试备份后再重试。';console.warn('Plan session restore',error);}
}
function migratePendingChoices(){
 const selected=poolSelectedIds();
 for(const [id,choice] of Object.entries(candidateChoices)){
  const pool=Object.values(candidatePools).find(p=>p.pois?.some(x=>x.id===id));const poi=pool?.pois.find(p=>p.id===id);if(!poi)continue;
  if(choice==='locked'&&!selected.has(id)){const index=lastAiPlan.days.findIndex(d=>d.city===pool.city);if(index>=0)PF.addCandidate(lastAiPlan,planFlow,index,poi,pool.recommendations?.find(r=>r.id===id)?.role||'sight','之前已选的想去地点');}
  if(choice==='excluded')lastAiPlan.days.forEach((day,index)=>{if([...(day.stops||[]),...(day.local_food||[])].some(s=>s.candidate_id===id))PF.removeStop(lastAiPlan,planFlow,index,id);});
 }
}
function workflowButton(parent,label,action,kind='btn',allowBusy=false){const b=addTextNode(parent,'button',kind,label);b.type='button';b.disabled=!allowBusy&&workflowBusy();b.onclick=()=>{if(!allowBusy&&workflowBusy())return;try{const result=action();if(result?.catch)result.catch(workflowError);}catch(error){workflowError(error);}};return b;}
function workflowError(error){planFlowError=error?.message||String(error);renderPlanResult(lastAiPlan);document.getElementById('planFlowError')?.scrollIntoView({block:'nearest'});}
function workflowStage(stage){if(workflowBusy())return;if(planFlow.finalVersion===planVersionNumber&&stage!=='final'){planFlow=PF.createFlow(lastAiPlan,planVersionNumber);stage=stage==='overview'?'overview':'days';}
 if(['overview','days'].includes(stage)&&reviewIsCurrent()&&Object.keys(planFlow.answers).length){const before=workflowDraft(),after=PF.applyReview(before,planFlow.review,planFlow.answers);if(PF.fingerprint(before)!==PF.fingerprint(after)){const selected=new Set(after.days.flatMap(d=>[...d.stops,...d.local_food]).map(s=>s.candidate_id));for(const day of before.days)for(const stop of [...day.stops,...day.local_food])if(stop.candidate_id&&!selected.has(stop.candidate_id))candidateChoices[stop.candidate_id]='excluded';PF.adoptReviewedPlan(lastAiPlan,planFlow,after);}}
 planFlow.stage=stage;planFlowError='';savePlanSession();renderPlanResult(lastAiPlan);document.getElementById('planFlowTop')?.scrollIntoView({block:'start',behavior:'smooth'});}
function workflowDay(index){if(workflowBusy())return;planFlow.activeDay=index;candidateInlineDay='';workflowStage(planFlow.stage==='final'?'final':'days');}
function paintPlanWork(){const node=document.getElementById('planWorkStatus');if(!node)return;node.hidden=!planFlowJob;if(planFlowJob)node.textContent='◌ '+planFlowJob.label+' · 已等待 '+Math.floor((Date.now()-planFlowJob.started)/1000)+' 秒。'+(Date.now()-planFlowJob.started>30000?'AI 仍在处理，无需重复点击；超时后会保留选择并提供重试。':'你的选择已保存，正在处理。');}
async function runPlanWork(label,action,retry){
 if(workflowBusy())return {ok:false};planFlowError='';planFlowRetry=retry||null;planFlowJob={label,started:Date.now()};planDiscussionBusy=true;savePlanSession();renderPlanResult(lastAiPlan);clearInterval(planFlowTimer);planFlowTimer=setInterval(paintPlanWork,1000);
 try{return {ok:true,value:await action()};}
 catch(error){planFlowError=(error.message||'这次处理未完成')+' 你的选择已保留。';return {ok:false};}
 finally{clearInterval(planFlowTimer);planFlowTimer=null;planFlowJob=null;planDiscussionBusy=false;candidatePoolBusy=false;savePlanSession();renderPlanResult(lastAiPlan);}
}
function startPlanWork(label){planFlowJob={label,started:Date.now()};clearInterval(planFlowTimer);planFlowTimer=setInterval(paintPlanWork,1000);paintPlanWork();}
function stopPlanWork(){clearInterval(planFlowTimer);planFlowJob=null;planFlowTimer=null;if(lastAiPlan)renderPlanResult(lastAiPlan);}
function refreshPlanActionState(){if(lastAiPlan)renderPlanResult(lastAiPlan);}
function showPlanEntryStatus(message){planFlowError=message;if(lastAiPlan)renderPlanResult(lastAiPlan);else toast(message);}
function renderPlanResult(result){
 const out=document.getElementById('generated');if(!out)return;
 const advanced=document.getElementById('planCustomization');const reference=document.getElementById('planReferenceCard');
 if(advanced&&out.contains(advanced))out.after(advanced);else if(reference&&out.contains(reference))out.after(reference);
 disposeTripMaps(out);out.replaceChildren();out.style.display='block';document.getElementById('planner')?.classList.add('has-plan');
 if(!planHasStructuredData(result)){addTextNode(out,'p','notice',result?.summary||'请先生成第一版方案。');return;}
 ensurePlanFlow();
 const header=addTextNode(out,'header','pf-header','');header.id='planFlowTop';
 addTextNode(header,'div','eyebrow','PLAN TOGETHER · V13');if(planFlow.stage==='overview')workflowButton(header,'修改旅行需求',()=>{document.getElementById('planner').classList.remove('has-plan');document.querySelector('.planner-form')?.scrollIntoView({block:'start',behavior:'smooth'});},'btn line small');addTextNode(header,'h3','',({overview:'先看看这趟旅行',days:'一天一天，选你喜欢的',review:'AI 帮你把整趟旅行理顺',transport:'确认交通与出发准备',final:'你的最终每日行程'})[planFlow.stage]);
 const stepper=addTextNode(out,'nav','pf-stepper','');stepper.setAttribute('aria-label','规划步骤');
 const labels=['全程总览','逐天选择','综合评估','交通与订票','最终行程'];PF.STAGES.forEach((stage,i)=>{const done=i<PF.STAGES.indexOf(planFlow.stage);const b=workflowButton(stepper,(done?(i===2&&planFlow.review?.deferred?'待补 ':'✓ '):String(i+1)+' ')+labels[i],()=>{if(stage==='overview'||stage==='days'||(stage==='review'&&planFlow.review)||(stage==='transport'&&canProceedTransport())||(stage==='final'&&planFlow.finalVersion===planVersionNumber))workflowStage(stage);},'pf-step'+(stage===planFlow.stage?' active':''));b.disabled=workflowBusy()||(i>1&&!done&&stage!==planFlow.stage);if(stage===planFlow.stage)b.setAttribute('aria-current','step');});
 const status=addTextNode(out,'div','notice pf-work','');status.id='planWorkStatus';status.setAttribute('role','status');status.setAttribute('aria-live','polite');paintPlanWork();
 if(planFlowError){const error=addTextNode(out,'div','pf-error','');error.id='planFlowError';error.setAttribute('role','alert');addTextNode(error,'p','',planFlowError);if(planFlow.stage==='transport'&&canProceedTransport())workflowButton(error,'直接用已确认安排生成行程',finalizePlanWorkflow,'btn light');if(planFlow.stage==='final')workflowButton(error,'保留原行程，直接进入每日行程',()=>applyAiPlan(),'btn light');if(planFlowRetry)workflowButton(error,'重试这一步',planFlowRetry,'btn small');if(planFlow.stage==='review')workflowButton(error,'先沿用当前安排，继续下一步',continueWithPendingTransport,'btn light');workflowButton(error,'返回每天安排，保留我的选择',()=>workflowStage('days'),'btn line small');}
 if(planFlowStorageError)addTextNode(out,'p','pf-error',planFlowStorageError);
 const main=addTextNode(out,'section','pf-main','');
 if(planFlow.stage==='overview')renderFlowOverview(main,workflowDraft());
 if(planFlow.stage==='days')renderFlowDay(main,false);
 if(planFlow.stage==='review')renderFlowReview(main);
 if(planFlow.stage==='transport')renderFlowTransport(main);
 if(planFlow.stage==='final')renderFlowFinal(main);
 const customization=advanced||createPlanCustomization();out.appendChild(customization);customization.hidden=false;customization.querySelectorAll('button,input[type=file]').forEach(n=>n.disabled=workflowBusy());
 refreshPlanCustomization(customization);updatePlanReferencePreview();
}
function renderFlowOverview(parent,plan){
 addTextNode(parent,'p','pf-intro',plan.summary||'AI 已根据你的兴趣安排第一版。先看整体，再挑想调整的日子。');
 appendTransportOverview(parent,plan,'planWholeRouteMap');
 const list=addTextNode(parent,'div','pf-overview-days','');
 plan.days.forEach((day,i)=>{const b=workflowButton(list,'',()=>workflowDay(i),'pf-overview-day');addTextNode(b,'span','eyebrow',day.day_label||'D'+(i+1));addTextNode(b,'strong','',day.city+' · '+day.title);addTextNode(b,'small','',(day.stops||[]).filter(s=>!PF.isActivity(s)).map(s=>s.name).join(' · ')||'抵达、交通或休息');});
 const previous=planVersions.at(-1)?.plan;if(previous){const changes=planDayChanges(plan,previous);addTextNode(parent,'p','notice','对比 V'+planVersions.at(-1).version+'：'+(changes.changed.size?'已更新 '+[...changes.changed].join('、'):'每日地点未变化')+(changes.removed.length?'；移除 '+changes.removed.join('、'):''));}
 const details=addTextNode(parent,'details','pf-details','');addTextNode(details,'summary','','住宿、美食与规划依据');for(const c of plan.city_sequence||[])addTextNode(details,'p','',c.city+'：'+(c.reason||''));for(const c of plan.checks||[])addTextNode(details,'p','tiny',c);appendSources(details,plan.sources||[]);
 const actions=addTextNode(parent,'div','pf-actions','');workflowButton(actions,'开始逐天选择 →',()=>workflowDay(planFlow.activeDay));workflowButton(actions,'都挺好，沿用推荐并综合评估',()=>reviewPlanWorkflow(true),'btn line');
}
function renderFlowDayTabs(parent,final=false){
 const strip=addTextNode(parent,'nav','pf-day-tabs','');strip.setAttribute('aria-label',final?'查看每日行程':'选择安排哪一天');lastAiPlan.days.forEach((d,i)=>{const key=PF.dayKey(d,i),active=planFlow.activeDay===i;const b=workflowButton(strip,(planFlow.confirmed[key]?'✓ ':'')+(d.day_label||'D'+(i+1)),()=>workflowDay(i),'pf-day-tab'+(active?' active':''));if(active)b.setAttribute('aria-current','date');});
}
function changeDay(callback){if(workflowBusy())return;callback();planFlowError='';planFlowRetry=null;savePlanSession();renderPlanResult(lastAiPlan);}
function renderFlowDay(parent,final=false){
 renderFlowDayTabs(parent,final);const index=planFlow.activeDay,base=lastAiPlan.days[index],day=final?base:workflowDraft().days[index],key=PF.dayKey(base,index),edit=planFlow.edits[key]||{};
 const card=addTextNode(parent,'article','pf-day','');addTextNode(card,'div','eyebrow','第 '+(index+1)+' / '+lastAiPlan.days.length+' 天'+(!final?' · 已确认 '+Object.keys(planFlow.confirmed).length+' 天':''));addTextNode(card,'h3','',(day.day_label||'D'+(index+1))+' · '+day.city+' · '+day.title);
 if(!final)addTextNode(card,'p','tiny','满意就直接下一天；有想法再调整。先选时间段，最终结合交通细化。');
 const previous=planVersions.at(-1)?.plan?.days?.find(d=>d.day_label===day.day_label);if(final&&previous&&comparableDay(previous)!==comparableDay(day))addTextNode(card,'span','pill','本次已更新');
 const renderStop=(s,i,food=false)=>{
  const sk=PF.stopKey(s),row=addTextNode(card,'div','pf-stop','');addTextNode(row,'span','pf-stop-number',food?'餐':String(i+1));const body=addTextNode(row,'div','pf-stop-body','');addTextNode(body,'strong','',s.name);
  if((edit.added||[]).some(a=>PF.stopKey(a.stop)===sk))addTextNode(body,'span','pill','你新加入的');
  addTextNode(body,'p','tiny',food?(s.area||'顺路可选'):(s.time||'时间灵活')+' · '+(s.duration||'时长待估算'));
  if(s.reason)addTextNode(body,'p','',s.reason);
  if(final){if(s.location_status==='pending')addTextNode(body,'span','pill','地图待匹配');addTextNode(body,'small','tiny',s.verification||'开放与预约待核实');return;}
  if(!food&&!PF.isActivity(s)){
   const label=addTextNode(body,'label','pf-slot','时间段 ');const select=document.createElement('select');select.setAttribute('aria-label',s.name+' 的时间段');select.disabled=workflowBusy();const current=PF.SLOTS.find(slot=>String(s.time||'').includes(slot))||'时间灵活';PF.SLOTS.forEach(slot=>{const opt=addTextNode(select,'option','',slot);opt.value=slot;opt.selected=slot===current;});select.onchange=()=>changeDay(()=>PF.setSlot(lastAiPlan,planFlow,index,sk,select.value));label.appendChild(select);
   workflowButton(body,'↑ 提前',()=>changeDay(()=>{const all=workflowDraft().days[index].stops.map(PF.stopKey),at=all.indexOf(sk);if(at>0){[all[at-1],all[at]]=[all[at],all[at-1]];PF.editFor(planFlow,key).order=all;PF.invalidate(planFlow,key);}}),'btn line small').disabled=workflowBusy()||i===0;
  }
  if(!PF.isActivity(s))workflowButton(body,(edit.added||[]).some(a=>PF.stopKey(a.stop)===sk)?'撤销新增':'移除这处',()=>changeDay(()=>{PF.removeStop(lastAiPlan,planFlow,index,sk);if(s.candidate_id)candidateChoices[s.candidate_id]='excluded';}),'btn line small');
 };
 day.stops.forEach((s,i)=>renderStop(s,i));
 const food=addTextNode(card,'details','pf-details','');addTextNode(food,'summary','','顺路美食 · '+(day.local_food||[]).length+' 项建议');(day.local_food||[]).forEach((s,i)=>{const holder=addTextNode(food,'div','pf-food','');addTextNode(holder,'strong','',s.name);addTextNode(holder,'p','tiny',[s.area,s.reason,s.verification||'具体店铺与营业待核验'].filter(Boolean).join(' · '));if(!final&&s.candidate_id)workflowButton(holder,'这家暂不考虑',()=>changeDay(()=>{PF.removeStop(lastAiPlan,planFlow,index,PF.stopKey(s));candidateChoices[s.candidate_id]='excluded';}),'btn line small');});
 if(edit.removed?.length&&!final){const removed=addTextNode(card,'details','pf-details','');addTextNode(removed,'summary','','本天已移除 '+edit.removed.length+' 处 · 可撤销');for(const sk of edit.removed){const s=[...(base.stops||[]),...(base.local_food||[])].find(x=>PF.stopKey(x)===sk);if(s)workflowButton(removed,'恢复 '+s.name,()=>changeDay(()=>{PF.restoreStop(lastAiPlan,planFlow,index,sk);if(s.candidate_id)delete candidateChoices[s.candidate_id];}),'btn line small');}}
 const housing=(lastAiPlan.checks||[]).filter(s=>/住|酒店|民宿/.test(s)&&String(s).includes(day.city));if(housing.length){const h=addTextNode(card,'details','pf-details','');addTextNode(h,'summary','','今晚住哪里');housing.forEach(s=>addTextNode(h,'p','tiny',s));}
 const map=addTextNode(card,'details','pf-details','');addTextNode(map,'summary','','看当天位置与游览顺序');map.ontoggle=()=>{if(!map.open||map.dataset.loaded)return;map.dataset.loaded='true';const country=lastAiPlan.city_sequence.find(c=>c.city===day.city)?.country||'';const box=addTextNode(map,'div','','');appendLiveMap(box,'workflowDayMap',()=>[...day.stops.filter(s=>!PF.isActivity(s)).map(s=>stopMapDescriptor(s,day.city,country)),...(day.local_food||[]).filter(s=>s.candidate_id).map(s=>stopMapDescriptor(s,day.city,country,'food'))]);};
 if(!final){
  const toggle=workflowButton(card,candidateInlineDay===key?'收起备选':'想看看别的？为这一天挑选',()=>{},candidateInlineDay===key?'btn line':'btn light');
  toggle.onclick=()=>{if(workflowBusy())return;candidateInlineDay=candidateInlineDay===key?'':key;renderPlanResult(lastAiPlan);};
  if(candidateInlineDay===key)renderDayCandidates(card,day,index);
 }
 if(day.travel_notes)addTextNode(card,'p','notice','当天交通衔接：'+day.travel_notes);
 const actions=addTextNode(parent,'div','pf-day-actions','');if(index)workflowButton(actions,'← 上一天',()=>workflowDay(index-1),'btn line');
 if(final){if(index<lastAiPlan.days.length-1)workflowButton(actions,'下一天 →',()=>workflowDay(index+1));}
 else{workflowButton(actions,index===lastAiPlan.days.length-1?'这天就这样，综合评估 →':'这天就这样，下一天 →',()=>{PF.confirmDay(lastAiPlan,planFlow,index);savePlanSession();if(index<lastAiPlan.days.length-1)workflowDay(index+1);else reviewPlanWorkflow(false);});workflowButton(parent,'其余沿用推荐，直接综合评估',()=>reviewPlanWorkflow(true),'btn line pf-wide');}
}
function renderDayCandidates(parent,day,index){
 const panel=addTextNode(parent,'section','pf-candidates','');panel.id='candidateInlineExplorer';const pool=candidatePools[day.city];addTextNode(panel,'h4','','给 '+day.day_label+' 的其他选择');
 if(pool?.rankingStatus!=='ranked'){addTextNode(panel,'p','tiny',pool?.warning||'按兴趣先筛出少量具体地点，再挑喜欢的加入这一天。');workflowButton(panel,workflowBusy()?'正在筛选…':'为 '+day.city+' 筛选推荐',()=>discoverCityPool(lastAiPlan.city_sequence.find(c=>c.city===day.city)||{city:day.city,country:''}),'btn light');return;}
 if(pool.warning)addTextNode(panel,'p','tiny',pool.warning);
 const chosen=new Set(workflowDraft().days.flatMap(d=>[...d.stops,...d.local_food]).map(s=>s.candidate_id).filter(Boolean));
 const ranks=pool.recommendations.filter(r=>!chosen.has(r.id)&&candidateChoices[r.id]!=='excluded');const pages=Math.ceil(ranks.length/3),page=(candidatePage[day.city]||0)%Math.max(1,pages),shown=ranks.slice(page*3,page*3+3);
 if(!shown.length)addTextNode(panel,'p','tiny','这批地点已安排或已排除。可以换个偏好重新找，也可以直接下一天。');
 for(const rank of shown){const poi=pool.pois.find(p=>p.id===rank.id);if(!poi)continue;const item=addTextNode(panel,'article','pf-candidate','');addTextNode(item,'strong','',routeExperienceIcon(poi.name)+' '+poi.name);addTextNode(item,'p','',rank.reason);if(rank.tradeoff)addTextNode(item,'small','tiny','取舍：'+rank.tradeoff);
  workflowButton(item,'＋ 加入 '+day.day_label,()=>changeDay(()=>{PF.addCandidate(lastAiPlan,planFlow,index,poi,rank.role,rank.reason);candidateChoices[poi.id]='locked';}),'btn light small');workflowButton(item,'暂不感兴趣',()=>changeDay(()=>{candidateChoices[poi.id]='excluded';}),'btn line small');
 }
 if(pages>1)workflowButton(panel,'换一批 · 还有 '+Math.max(0,ranks.length-3)+' 处可看',()=>{candidatePage[day.city]=page+1;renderPlanResult(lastAiPlan);},'btn line small');
 const direction=addTextNode(panel,'details','pf-details','');addTextNode(direction,'summary','','这批都不合适？换个方向');for(const preference of ['更多当地生活','更多自然风景','更多历史文化','更轻松，少走路'])workflowButton(direction,preference,()=>rerankCityPreference({city:day.city,country:lastAiPlan.city_sequence.find(c=>c.city===day.city)?.country},preference),'btn line small');
}
function reviewContext(plan){return {mode:'workflow_review',trip_brief:planBrief,current_plan:PF.reviewSnapshot(plan),workflow:{revision:planFlow.revision,transport_legs:PF.transportLegs(plan)}};}
function finalWorkflowContext(plan,choices,transports){const selected=new Set(plan.days.flatMap(d=>[...d.stops,...d.local_food]).map(s=>s.candidate_id).filter(Boolean));return {mode:'workflow_finalize',trip_brief:planBrief,current_plan:PF.reviewSnapshot(plan),candidate_choices:choices,candidate_pools:Object.values(candidatePools).map(pool=>({city:pool.city,candidates:pool.pois.filter(p=>selected.has(p.id)).map(p=>({id:p.id,name:p.name,location:p.location||'',source:p.source||'amap'}))})).filter(p=>p.candidates.length),workflow:{transport:transports,booking_tasks:planFlow.review.bookings,review_deferred:planFlow.review.deferred===true}};}

async function reviewPlanWorkflow(confirmRest=false){
 if(workflowBusy())return;if(confirmRest)PF.confirmRemaining(lastAiPlan,planFlow);
 planFlow.stage='review';const revision=planFlow.revision;const draft=workflowDraft();savePlanSession();
 await runPlanWork('正在综合检查每天的选择、顺序与交通衔接',async()=>{
  const result=await apiRequest({task:'review',message:'评估用户逐天确认的行程，先做取舍比较，再直接给明确 A/B 与推荐。只提出确实影响可行性的决定，不因预算等可选项阻塞。不要直接更改地点。交通按 workflow.transport_legs 的 id 全部返回。提醒门票预约、住宿与交通衔接，但不得当作已预订或已核实。',context:reviewContext(draft)});
  const review=PF.validateReview(result.data,draft);if(planFlow.revision!==revision)throw new Error('选择有变化，请重新评估。');planFlow.review=review;planFlow.reviewRevision=revision;planFlow.answers={};planFlow.transport=Object.fromEntries(review.transport.map(t=>[t.id,t.recommended]));planFlow.bookings={};
 },()=>reviewPlanWorkflow(false));
}
function continueWithPendingTransport(){if(workflowBusy())return;const draft=workflowDraft();planFlow.review={summary:'这次综合评估未完成。先保留当前景点安排，交通在第四步继续确认。',deferred:true,decisions:[],day_notes:[],transport:PF.normalizeTransport([],draft),bookings:[]};planFlow.reviewRevision=planFlow.revision;planFlow.answers={};planFlow.transport=Object.fromEntries(planFlow.review.transport.map(t=>[t.id,'pending']));planFlow.bookings={};planFlowError='';planFlowRetry=null;workflowStage('transport');}
function reviewIsCurrent(){return Boolean(planFlow.review&&planFlow.reviewRevision===planFlow.revision);}
function canProceedTransport(){return reviewIsCurrent()&&planFlow.review.decisions.every(d=>planFlow.answers[d.id]);}
function renderFlowReview(parent){
 if(!reviewIsCurrent()){addTextNode(parent,'p','pf-intro','AI 会检查景点是否太赶、重复或绕路；交通与订票在第四步确认，缺项可以先标为待定。');if(!workflowBusy()){workflowButton(parent,'开始综合评估',()=>reviewPlanWorkflow(false));if(!planFlowError){workflowButton(parent,'暂时沿用当前安排，交通稍后确认',continueWithPendingTransport,'btn line');addTextNode(parent,'p','tiny','选择稍后确认会保留当前景点，并明确标记综合评估尚未完成。');}}return;}
 const review=planFlow.review;addTextNode(parent,'p','pf-intro',review.summary);
 const pending=review.decisions.find(d=>!planFlow.answers[d.id]);
 if(pending){const i=review.decisions.indexOf(pending),card=addTextNode(parent,'section','pf-decision','');addTextNode(card,'div','eyebrow','第 '+(i+1)+' / '+review.decisions.length+' 个取舍');addTextNode(card,'h4','',pending.question);addTextNode(card,'p','tiny',pending.recommended?'AI 建议 '+pending.recommended+'：'+pending.reason:'推荐尚未完整返回，你可以直接选择更喜欢的一项。');
  for(const o of pending.options){const b=workflowButton(card,'',()=>{const answers={...planFlow.answers,[pending.id]:o.id};PF.applyReview(workflowDraft(),review,answers);planFlow.answers=answers;savePlanSession();renderPlanResult(lastAiPlan);},'pf-choice'+(o.id===pending.recommended?' recommended':''));addTextNode(b,'strong','',o.id+' · '+o.label+(o.id===pending.recommended?'（推荐）':''));addTextNode(b,'small','',o.reason);}
 }else{addTextNode(parent,'p','notice',review.deferred?'综合评估尚未完成，本次先沿用当前安排。交通可以在下一步设为待定。':'✓ 景点取舍已确认。交通缺项留到第四步，不影响继续。');workflowButton(parent,'确认这些安排，看看交通与订票 →',()=>workflowStage('transport'));}
 const answered=review.decisions.filter(d=>planFlow.answers[d.id]);if(answered.length){const history=addTextNode(parent,'details','pf-details','');addTextNode(history,'summary','','已决定 '+answered.length+' 项 · 查看或修改');for(const d of answered){addTextNode(history,'p','',d.question+' → '+d.options.find(o=>o.id===planFlow.answers[d.id]).label);workflowButton(history,'重新选择',()=>{const at=review.decisions.indexOf(d);for(const item of review.decisions.slice(at))delete planFlow.answers[item.id];planFlow.finalVersion=null;savePlanSession();renderPlanResult(lastAiPlan);},'btn line small');}}
 const reasoning=addTextNode(parent,'details','pf-details','');addTextNode(reasoning,'summary','','查看每天的检查说明');for(const note of review.day_notes)addTextNode(reasoning,'p','tiny',note.day_label+'：'+note.note);
 workflowButton(parent,'回到每天安排',()=>workflowStage('days'),'btn line');
}
function renderFlowTransport(parent){
 if(!canProceedTransport()){workflowStage('review');return;}
 addTextNode(parent,'p','pf-intro',(planFlow.review.deferred?'本次先沿用你已选的景点，AI 综合评估尚未完成。':planFlow.review.transport.some(t=>t.status==='pending')?'部分交通建议尚未完整返回，相关路段已标为待定。':'AI 已给出交通建议，你可以采用或更换。')+' 不确定的路段选“待定”即可继续。票务、住宿和交通细节可在出发前补齐。');
 for(const leg of planFlow.review.transport){const card=addTextNode(parent,'article','pf-transport','');addTextNode(card,'h4','',[leg.day_label,leg.from+' → '+leg.to].filter(Boolean).join(' · '));if((planFlow.transport[leg.id]||'pending')==='pending')addTextNode(card,'p','notice','交通待定：'+(leg.pending_reason||'方式和换乘之后再确认。')+' 可以直接继续，之后再补。');for(const o of [...leg.options.filter(o=>o.id!=='pending'),{id:'pending',mode:'待定',reason:'暂时不决定，保留这段行程；出发前再确认交通衔接。'}]){const label=addTextNode(card,'label','pf-radio','');const radio=document.createElement('input');radio.type='radio';radio.name='transport-'+leg.id;radio.checked=planFlow.transport[leg.id]===o.id;radio.disabled=workflowBusy();radio.onchange=()=>{planFlow.transport[leg.id]=o.id;planFlow.finalVersion=null;savePlanSession();renderPlanResult(lastAiPlan);};label.appendChild(radio);const body=addTextNode(label,'span','','');addTextNode(body,'strong','',o.mode+(o.id!=='pending'&&o.id===leg.recommended?' · AI 推荐':''));addTextNode(body,'small','',o.reason);}addTextNode(card,'p','tiny',leg.notes||'具体班次、票价、接驳与道路情况需按出行日期核实。');}
 if(!planFlow.review.transport.length)addTextNode(parent,'p','notice','本次没有跨城交通段；当天市内衔接会整理进每日行程。');
 renderBookingChecklist(parent,false);
 addTextNode(parent,'p','tiny','这里确认的是交通建议；勾选清单只表示已经记下待办，不代表订票或预订成功。');
 workflowButton(parent,'保留已选方式与待定项，生成行程 →',finalizePlanWorkflow,'btn pf-wide');workflowButton(parent,'← 返回 AI 取舍',()=>workflowStage('review'),'btn line');
}
function renderBookingChecklist(parent,final){
 const box=addTextNode(parent,'section','pf-bookings','');addTextNode(box,'h4','','出发前准备清单');const bookings=planFlow.review?.bookings||[];
 if(!bookings.length)addTextNode(box,'p','tiny','请按出行日期核实景点预约、住宿房源与交通班次。暂未查明的票务不会标记为已确认。');
 for(const task of bookings){const row=addTextNode(box,'label','pf-check','');const check=document.createElement('input');check.type='checkbox';check.checked=Boolean(planFlow.bookings[task.id]);check.disabled=workflowBusy();check.onchange=()=>{planFlow.bookings[task.id]=check.checked;savePlanSession();};row.appendChild(check);const body=addTextNode(row,'span','','');addTextNode(body,'strong','',(task.priority==='early'?'优先留意 · ':'')+task.title);addTextNode(body,'small','',[task.day_label,task.action,task.verification].filter(Boolean).join(' · '));}
 addTextNode(box,'p','tiny','□ 勾选表示“已记下待办”；订票、付款和预订请在对应官方或预订平台完成。');
}
function markFinalLocationStatus(plan){
 const pending=[];
 for(const day of plan.days||[])for(const stop of [...(day.stops||[]),...(day.local_food||[])]){
  if(PF.isActivity(stop))continue;const food=(day.local_food||[]).includes(stop);if(food&&!stop.candidate_id)continue;
  const country=plan.city_sequence.find(c=>c.city===day.city)?.country||'';
  const descriptor=stopMapDescriptor(stop,day.city,country,food?'food':'sight');
  const cached=typeof mapLocationMemory!=='undefined'?mapLocationMemory[descriptor.key]:null;
  const location=descriptor.location||(cached?.status==='matched'?cached.location:null);
  if(parseMapCoordinate(location)){stop.location=location;stop.location_source='amap';stop.coordinate_system=descriptor.coordinate_system||cached?.coordinate_system||'GCJ02';stop.location_status='matched';}
  else{stop.location='';stop.location_source='unverified';stop.location_status='pending';stop.verification='地图位置待匹配；'+(stop.verification||'开放、预约与交通待核实');pending.push({day_label:day.day_label,name:stop.name});}
 }
 plan.map_pending=pending;
}
function commitFinalPlan(final){
  planVersions.push({version:planVersionNumber,plan:PF.clone(lastAiPlan)});planVersions=planVersions.slice(-6);planVersionNumber++;lastAiPlan=final;candidateChoices={};
  const previousFlow=planFlow;planFlow=PF.createFlow(final,planVersionNumber);planFlow.stage='final';planFlow.activeDay=0;planFlow.finalVersion=planVersionNumber;planFlow.review=previousFlow.review;planFlow.reviewRevision=planFlow.revision;planFlow.answers=previousFlow.answers;planFlow.transport=previousFlow.transport;planFlow.bookings=previousFlow.bookings;PF.confirmRemaining(final,planFlow);
 savePlanSession();renderPlanResult(lastAiPlan);
}
function finalizePlanWorkflow(){
 if(workflowBusy())return;if(!canProceedTransport()){workflowStage('review');return;}
 const draft=PF.applyReview(workflowDraft(),planFlow.review,planFlow.answers);
 markFinalLocationStatus(draft);
 const final=PF.assembleConfirmedPlan(draft,planFlow.review,planFlow.transport);
 final.sources=lastAiPlan.sources||[];
 commitFinalPlan(final);
}
async function enhanceFinalPlanWorkflow(){
 if(workflowBusy())return;if(planFlow.stage!=='final')return;
 const draft=PF.clone(lastAiPlan);
 const choices=PF.finalCandidateChoices(draft,candidatePools,candidateChoices);const transports=planFlow.review.transport.map(t=>({...t,selected:planFlow.transport[t.id]||'pending'}));
 await runPlanWork('正在优化已有行程的时段与衔接，原行程仍保留',async()=>{
  markFinalLocationStatus(draft);
  const context=finalWorkflowContext(draft,choices,transports);
  const result=await apiRequest({task:'plan',message:'基于已确认的 current_plan 和 workflow.transport 生成完整最终每日行程。城市顺序、天数、每一天的全部景点与餐饮身份必须原样保留，不得新增、删除或移日。可结合已选交通方式细化游览顺序、时段、停留建议与衔接说明。workflow_time_locked=true 的地点必须保留原 time 指定的时间段。地点位置待匹配时保留原名称与当天安排，不编坐标、不要求用户定位，不因定位状态拒绝生成。selected=pending 的跨城交通保持待定，不编造方式、班次或精确时间；在 checks 提醒后续补齐，不得因此拒绝生成。时间点是可调整估算，不得编造实际班次或官方营业时间。每个day额外给travel_notes字符串，简短说明当天交通方式、地点衔接和需要核实的缓冲；没有路线服务不编精确车程。保留餐饮和住宿建议；订票与预约待办放 checks，标待核实而非已预订。已经决定的问题不再重复提问。',context});
  const final=PF.assertFinalPlan(result.data,draft,planFlow.review,planFlow.transport);final.sources=result.sources||[];
  final.ai_refinement_status='enhanced';final.checks=final.checks.filter(c=>c!=='行程按用户已确认的地点、时段和交通选择直接整理；更细的交通耗时与时间优化尚待补充。');commitFinalPlan(final);
 },enhanceFinalPlanWorkflow);
}
function renderFlowFinal(parent){
 addTextNode(parent,'p','notice','✓ 方案已整理完成 · V'+planVersionNumber+'。每天只展示一页，可切换查看；待预约和待订票事项保留在准备清单。');
 if(lastAiPlan.map_pending?.length)addTextNode(parent,'p','tiny','有 '+lastAiPlan.map_pending.length+' 处地图位置仍待系统匹配，已保留在行程中；匹配前暂不落点，不影响查看。');if(planFlow.review?.deferred)addTextNode(parent,'p','notice','本版暂沿用你当前的景点安排，AI 综合评估尚未完成，可稍后继续检查；这不会阻止你查看全程。');const pending=(lastAiPlan.intercity_transport||[]).filter(t=>t.status==='pending'||t.mode==='待定');if(pending.length)addTextNode(parent,'p','notice','仍有 '+pending.length+' 段交通待定：'+pending.map(t=>t.from+' → '+t.to).join('、')+'。可先查看全程，出发前请补齐。');
 if(lastAiPlan.ai_refinement_status!=='enhanced')addTextNode(parent,'p','tiny','已按你的确认直接整理，无需等待 AI 重写；时间与衔接优化可稍后再做。');if(planReferencesPending)addTextNode(parent,'p','tiny','新补充资料尚未整合，本版按当前已确认安排生成。');workflowButton(parent,'保存到我的行程，开始使用 →',()=>applyAiPlan(),'btn pf-wide');renderFlowDay(parent,true);
 const prep=addTextNode(parent,'details','pf-details','');addTextNode(prep,'summary','','查看订票、住宿与交通准备');renderBookingChecklist(prep,true);for(const t of lastAiPlan.intercity_transport||[])addTextNode(prep,'p','tiny',t.from+' → '+t.to+'：'+t.mode+'；'+t.notes+' '+t.verification);for(const c of lastAiPlan.checks||[])addTextNode(prep,'p','tiny',c);
 workflowButton(parent,'选做：让 AI 优化时间与衔接',enhanceFinalPlanWorkflow,'btn line');workflowButton(parent,'继续修改这趟旅行',()=>{planFlow=PF.createFlow(lastAiPlan,planVersionNumber);workflowStage('days');},'btn line');
}
async function applyAiPlan(){
 if(workflowBusy())return;if(planFlow?.stage!=='final'){workflowStage('days');return;}
 const before=PF.clone(trip),oldDay=activeDay,oldCity=activeCity;
 try{
  const ids=new Map();trip.planDerived=true;trip.planVersion=planVersionNumber;trip.transport=PF.clone(lastAiPlan.intercity_transport||[]);trip.preparation=PF.clone(planFlow.review?.bookings||[]);trip.preparationNoted=PF.clone(planFlow.bookings);trip.planChecks=PF.clone(lastAiPlan.checks||[]);
  trip.cities=lastAiPlan.city_sequence.map((c,i)=>{const id='ai-city-'+i;ids.set(c.city,id);return {id,name:c.city,country:c.country,days:(c.nights||'待确认')+' 晚',summary:c.reason||'',spots:[...new Set(lastAiPlan.days.filter(d=>d.city===c.city).flatMap(d=>d.stops.filter(s=>!PF.isActivity(s)).map(s=>s.name)))]};});
  trip.days=lastAiPlan.days.map((d,i)=>({id:'ai-day-'+(i+1),label:d.day_label,city:ids.get(d.city),title:d.title,transportNote:d.travel_notes||'',stops:[...d.stops.map(s=>[s.time||'时间灵活',s.name,[s.duration,s.reason,s.verification].filter(Boolean).join(' · '),stopMapDescriptor(s,d.city,lastAiPlan.city_sequence.find(c=>c.city===d.city)?.country||'')]),...(d.local_food||[]).map(s=>['可选风味',s.name,[s.area,s.reason,s.verification].filter(Boolean).join(' · '),stopMapDescriptor(s,d.city,lastAiPlan.city_sequence.find(c=>c.city===d.city)?.country||'','food')])]}));
  activeDay=trip.days[0].id;activeCity=trip.days[0].city;persist(true);nav('trip');toast('最终行程已保存，出发准备清单仍可回到规划页查看');
 }catch(error){trip=before;activeDay=oldDay;activeCity=oldCity;workflowError(new Error('行程保存未完成：'+error.message+'，最终方案已保留，可重试。'));}
}
function createPlanCustomization(){
 const panel=document.createElement('details');panel.id='planCustomization';panel.className='pf-customization';addTextNode(panel,'summary','','更多定制 · 写想法、补充攻略');
 addTextNode(panel,'p','tiny','适合想进一步调整的朋友。补充后，AI 会生成新草案，再从总览确认。');
 const input=document.createElement('textarea');input.id='planDiscussionInput';input.placeholder='还有其他想法？例如：D3 不想爬山，想换成当地生活体验。';input.value=planFlow?.customText||'';input.oninput=()=>{planFlow.customText=input.value;savePlanSession();};panel.appendChild(input);
 workflowButton(panel,'按我的补充重新推荐',()=>sendPlanMessage(),'btn light');
 const files=document.createElement('input');files.type='file';files.multiple=true;files.id='planDiscussionFiles';files.accept='image/jpeg,image/png,image/webp';files.setAttribute('aria-label','上传攻略截图');panel.appendChild(files);addTextNode(panel,'p','tiny','攻略截图最多 4 张，每张不超过 3 MB。');
 const reference=document.getElementById('planReferenceCard');if(reference){reference.hidden=false;panel.appendChild(reference);}workflowButton(panel,'整理攻略，并更新草案',absorbPlanMaterials,'btn line');
 const history=addTextNode(panel,'details','pf-details','');addTextNode(history,'summary','','历史版本与讨论');const versions=addTextNode(history,'div','','');versions.id='planVersionList';const log=addTextNode(history,'div','','');log.id='planDiscussionLog';planDiscussionHistory.slice(-8).forEach(m=>addTextNode(log,'p','tiny',(m.role==='user'?'我：':'AI：')+m.content));
 return panel;
}
function refreshPlanCustomization(panel){const log=panel.querySelector('#planDiscussionLog');if(log){log.replaceChildren();planDiscussionHistory.slice(-8).forEach(m=>addTextNode(log,'p','tiny',(m.role==='user'?'我：':'AI：')+m.content));}const versions=panel.querySelector('#planVersionList');if(versions){versions.replaceChildren();for(let i=planVersions.length-1;i>=0;i--)workflowButton(versions,'恢复 V'+planVersions[i].version,()=>restorePlanVersion(i),'btn line small');}}
function renderPlanDiscussionLog(){const log=document.getElementById('planDiscussionLog');if(log){log.replaceChildren();planDiscussionHistory.slice(-8).forEach(m=>addTextNode(log,'p','tiny',(m.role==='user'?'我：':'AI：')+m.content));}}
function renderLatestPlanReply(){if(lastAiPlan)renderPlanResult(lastAiPlan);}
async function sendPlanMessage(prefill){const input=document.getElementById('planDiscussionInput'),message=prefill||input?.value.trim();if(!message){toast('可以先写一点希望调整的地方');return;}appendPlanDiscussionMessage('user',message);await revisePlanFromDiscussion();}
async function revisePlanFromDiscussion(){
 if(workflowBusy())return;
 await runPlanWork('正在结合补充内容重新推荐',async()=>{
  const context=buildPlanContext('workflow_revision');context.current_plan=workflowDraft();
  const result=await apiRequest({task:'plan',message:'按用户最新讨论与攻略资料修订完整旅行草案，保留未要求修改的城市、天数和已确认约束，保证具体地点可检索。每一天提供景点顺序、建议时段、美食方向，checks 保留住宿建议与待核验事项。不得编造开放时间、车次、票价。',history:planDiscussionHistory.slice(-8),context});
  const revised=Object.keys(candidatePools).length?checkCandidatePlan(result.data):result.data;if(!planHasStructuredData(revised))throw new Error('AI 返回草案不完整。');
  planVersions.push({version:planVersionNumber,plan:PF.clone(lastAiPlan)});planVersions=planVersions.slice(-6);planVersionNumber++;lastAiPlan=revised;lastAiPlan.sources=result.sources||[];planFlow=PF.createFlow(lastAiPlan,planVersionNumber);planReferencesPending=false;candidateChoices={};appendPlanDiscussionMessage('assistant','已更新草案 V'+planVersionNumber+'，请从总览查看变化。');const input=document.getElementById('planDiscussionInput');if(input)input.value='';
 },revisePlanFromDiscussion);
}
async function absorbPlanMaterials(){
 if(workflowBusy())return;
 let files;try{files=await readImageFilesFromInput('planDiscussionFiles');}catch(error){workflowError(error);return;}if(!files.length&&!planReferenceMaterials.length){toast('请先上传截图或文档');return;}
 const result=await runPlanWork('正在整理攻略中的地点与经验',async()=>{const r=await apiRequest({task:'materials',message:'整理这些旅行攻略线索，区分经验和待核验事实。'+planReferenceMaterials.map(x=>x.text).join('\n'),images:files,context:buildPlanContext('materials_for_plan')});if(!Array.isArray(r.data?.items))throw new Error('攻略未整理完成。');materialInsights=r.data.items.slice(0,20);appendPlanDiscussionMessage('user','请吸收攻略精华调整草案：'+(r.data.summary||''));planReferencesPending=true;},absorbPlanMaterials);
 if(result.ok)await revisePlanFromDiscussion();
}
function restorePlanVersion(index){if(workflowBusy())return;const item=planVersions[index];if(!item?.plan)return;const old={version:planVersionNumber,plan:PF.clone(lastAiPlan)};lastAiPlan=PF.clone(item.plan);planVersionNumber++;planVersions=planVersions.filter((_,i)=>i!==index).concat(old).slice(-6);candidateChoices={};planFlow=PF.createFlow(lastAiPlan,planVersionNumber);planFlowError='';savePlanSession();renderPlanResult(lastAiPlan);}
async function discoverCityPool(city){
 if(workflowBusy())return false;
 const result=await runPlanWork('正在为 '+city.city+' 按兴趣筛选推荐',async()=>{candidatePoolBusy=true;const data=await apiPoiRequest({city:city.city,country:city.country,interests:planBrief?.interests?.length?planBrief.interests:['历史文化','地方生活'],preferences:[planBrief?.preferences,planBrief?.cityPreferences?.[city.city]].filter(Boolean).join('；')});if(data.contractVersion!==3)throw new Error('请先部署 V13 Worker 后重试推荐。');if(data.rankingStatus!=='ranked'||!data.recommendations?.length)throw new Error(data.warning||'本次精选尚未完成，请重试。');
  const old=candidatePools[city.city];const pool={city:city.city,country:city.country,pois:data.pois||[],recommendations:data.recommendations,rankingStatus:'ranked',warning:data.warning||'',queries:data.queries||[]};const used=new Set(workflowDraft().days.flatMap(d=>[...d.stops,...d.local_food]).map(s=>s.candidate_id));for(const p of old?.pois||[])if((used.has(p.id)||candidateChoices[p.id])&&!pool.pois.some(x=>x.id===p.id))pool.pois.push(p);candidatePools[city.city]=pool;candidatePage[city.city]=0;candidatePoolNotice='';return true;
 },()=>discoverCityPool(city));return Boolean(result.ok);
}
async function rerankCityPreference(city,preference){if(!planBrief.cityPreferences)planBrief.cityPreferences={};planBrief.cityPreferences[city.city]=preference;await discoverCityPool(city);}
function openPlanCandidates(){if(!lastAiPlan){nav('planner');return;}nav('planner');ensurePlanFlow();planFlow.stage='days';candidateInlineDay=PF.dayKey(lastAiPlan.days[planFlow.activeDay],planFlow.activeDay);renderPlanResult(lastAiPlan);}
function setCandidateChoice(id,choice){if(workflowBusy())return;const pool=Object.values(candidatePools).find(p=>p.pois?.some(x=>x.id===id)),poi=pool?.pois.find(x=>x.id===id);if(!poi)return;if(choice==='locked')changeDay(()=>{PF.addCandidate(lastAiPlan,planFlow,planFlow.activeDay,poi,pool.recommendations.find(r=>r.id===id)?.role||'sight');candidateChoices[id]='locked';});else changeDay(()=>{candidateChoices[id]='excluded';});}
async function finalizePlanAndOpenTrip(){if(workflowBusy())return;if(planFlow?.stage==='final')return applyAiPlan();if(reviewIsCurrent()&&canProceedTransport())workflowStage('transport');else await reviewPlanWorkflow(true);}
async function updatePlanFromInput(){return sendPlanMessage();}

async function generatePlan(){
  if(workflowBusy()||planGenerationBusy)return;
  const backup={brief:planBrief,plan:lastAiPlan,flow:planFlow,version:planVersionNumber,versions:planVersions,pools:candidatePools,choices:candidateChoices,history:planDiscussionHistory};
  const button=document.querySelector('#planner .planner-form .btn');
  const out=document.getElementById("generated");disposeTripMaps(out);
  const reference=document.getElementById("planReferenceCard");if(reference&&out.contains?.(reference)){out.after(reference);reference.hidden=true;}
  out.style.display="block";out.innerHTML="";
  addTextNode(out,"div","ai-loading","✦ AI 正在根据兴趣与喜好生成第一版方案…");
  setBusy(button,true,"AI 规划中…");
  const brief={
    origin:document.getElementById("origin").value.trim(),
    destination:document.getElementById("destination").value.trim(),
    cities:document.getElementById("cities").value.trim(),
    startDate:document.getElementById("startDate").value,
    endDate:document.getElementById("endDate").value,
    pace:document.getElementById("pace").value,
    preferences:document.getElementById("preferences").value.trim(),
    interests:[...document.querySelectorAll("[data-plan-interest].active")].map(x=>x.dataset.planInterest),
    durationDays:document.getElementById("planDays").value ? Number(document.getElementById("planDays").value) : null
  };
  // Origin/destination belong to the route boundaries, not intermediate stops.
  // Keep the endpoint in trip_brief.destination so the model still routes there.
  const normalizePlace=name=>name.trim().replace(/\s+/g,"").replace(/(市|地区)$/,"");
  const boundaryNames=new Set([normalizePlace(brief.origin),normalizePlace(brief.destination)].filter(Boolean));
  const seenStops=new Set();
  const intermediateStops=brief.cities.split(/[、，,;；\n]+/).map(x=>x.trim()).filter(Boolean).filter(city=>{
    const key=normalizePlace(city);
    if(boundaryNames.has(key)||seenStops.has(key))return false;
    seenStops.add(key);return true;
  });
  const removedBoundary=brief.cities.split(/[、，,;；\n]+/).map(x=>x.trim()).some(x=>x&&boundaryNames.has(normalizePlace(x)));
  brief.cities=intermediateStops.join("、");
  if(removedBoundary){
    document.getElementById("cities").value=brief.cities;
    toast("已从途经城市中去掉重复的起点或终点，终点仍保留在路线末尾");
  }
  candidatePools={};candidateChoices={};candidatePoolNotice='';candidateExplorerCity='';candidateInlineDay='';candidatePage={};candidateBatchTurns={};candidateGuidanceCity='';
  planGenerationBusy=true;planFlow=null;planFlowError='';planFlowRetry=null;planBrief=brief;planDiscussionHistory=[];planVersions=[];planVersionNumber=1;lastAiPlan=null;savePlanSession();updatePlanReferencePreview();
  try{
    const result=await apiRequest({task:"plan",message:"请作为旅行规划师与协商搭档生成可编辑的第一版 Plan。origin 是起点、destination 是终点、cities 为候选城市；仅给国家时可建议城市组合。具体文字喜好优先于宽泛标签，明确约束优先于软偏好。根据 trip_brief.interests、preferences、pace 和 durationDays 实际调整地点选择、停留时长与节奏；在 summary 和各地点 reason 解释与用户偏好的关联，不能只改变措辞。日期空白时，在 checks 中给出适合出行的月份或季节、原因和取舍，使用 D1/D2 排程，不假设用户已选定日期；天数空白时建议合理天数并注明假设。除非无法识别目的地，否则先生成有条件的初稿，questions 最多提出两个会明显改变方案的关键问题，不用预算等选填项阻塞。返回完整 city_sequence、intercity_transport、days、checks、questions。每天安排符合节奏的核心体验，考虑地理聚类与交通缓冲；没有路线服务核算，不声称最优路线或给精确交通分钟数。无需安排固定午餐晚餐时间或强制餐饮停留点，必须在每天 local_food 提供顺路的特色菜和餐饮区域选项，具体店铺需候选 id，否则只给菜品或区域并标待核验；偏远户外活动需提示核实补给，不能未经查证断言没有餐饮。住宿建议先到区域及其取舍，遵守已有酒店约束。热门推荐线索与事实核验分开，未检索不能声称来自小红书或实时热榜。营业时间、票价、预约、班次、营业状态未取得本轮可靠证据一律待核实；具体日期确定后需复查。若有 reference_materials，吸收地点和个人备注，区分主观体验与事实。不擅自删除用户明确锁定的安排。",context:buildPlanContext("initial_plan")});
    lastAiPlan=result.data&&typeof result.data==="object"?result.data:null;
    if(lastAiPlan){lastAiPlan.sources=result.sources||[];planReferencesPending=false;}
    if(!planHasStructuredData(lastAiPlan))throw new Error('AI 尚未给出完整的城市与每日安排，请重试。');planVersions=[];
    renderPlanResult(lastAiPlan||{summary:result.text||"AI 已返回结果",text:result.text||"",checks:[],questions:[],days:[]});
    planFlow=PF.createFlow(lastAiPlan,planVersionNumber);savePlanSession();updatePlanReferencePreview();toast('第一版推荐已生成，可以逐天选择喜欢的安排');


  }catch(e){if(backup.plan){planBrief=backup.brief;lastAiPlan=backup.plan;planFlow=backup.flow;planVersionNumber=backup.version;planVersions=backup.versions;candidatePools=backup.pools;candidateChoices=backup.choices;planDiscussionHistory=backup.history;planFlowError='新草案生成未完成：'+e.message+'。之前的方案和选择已保留。';savePlanSession();}else showAiError(out,e);}
  finally{planGenerationBusy=false;setBusy(button,false);if(lastAiPlan)renderPlanResult(lastAiPlan);}
}
