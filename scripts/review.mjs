import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {sha256,hashObject,failure} from './audio.mjs';
import {musicIdentity,validateNotationMapping} from './music.mjs';
import {validateNotationAudit} from './notation-audit.mjs';
import {inheritedScoreApproval} from './migration-v2.mjs';
import {verifyWorkbenchSession} from './workbench-approval.mjs';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const write=(p,v)=>fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function requestReview({stage,out,files,display=[],musicSha256=null,jobSha256=null,sourceType=null,notes=[]}){
  if(!['score','keyframes'].includes(stage))throw failure('REVIEW_STAGE_INVALID',stage,'Use score or keyframes.');
  const dir=path.resolve(out);if(fs.existsSync(dir))throw failure('OUTPUT_EXISTS',dir,'Choose a new review directory.');
  const unique=[...new Set(files.map(p=>path.resolve(p)))];
  // A content approval can only bind material the reviewer can actually see.
  // HTML/PDF stay as linked full sources; SVG/PNG/JPEG and audio/video render
  // in the page. Unknown binary types make this request invalid rather than
  // silently confirming an unshown file.
  const shown=display.map(p=>path.resolve(p));
  // Links are reviewable sources only when they are self-contained evidence
  // documents. A score, timeline or internal check must be rendered as a visual
  // item; otherwise the click would confirm something the page never showed.
  const sourceDocument=p=>/\.(?:pdf|html?|json|csv|md)$/i.test(p);
  const unsupported=[...new Set(unique.filter(p=>!shown.includes(p)&&!sourceDocument(p)))];
  if(unsupported.length)throw failure('REVIEW_CONTENT_UNSUPPORTED',unsupported.slice(0,8).join(', '),'Render every required content item or use the Agent chat review; a hidden file cannot be recorded as reviewed.');
  const fingerprints=Object.fromEntries(unique.map(p=>[p,sha256(fs.readFileSync(p))]));
  fs.mkdirSync(dir,{recursive:true});
  const request={schema:'aiyoupu-review-request/v1',id:randomUUID(),stage,status:stage==='score'?'WAITING_FOR_SCORE_APPROVAL':'WAITING_FOR_KEYFRAME_APPROVAL',sourceType,musicSha256,jobSha256,fingerprints,notes,display:[]};
  for(const [i,p] of display.entries()){
    const file=path.resolve(p);if(!fingerprints[file])throw failure('REVIEW_FILE_UNBOUND',file,'Include every displayed file in the fingerprints.');
    const name=`view-${i}${path.extname(file).toLowerCase()}`;fs.copyFileSync(file,path.join(dir,name));request.display.push({file:name,original:file,sha256:fingerprints[file]});
  }
  request.bundleSha256=hashObject(request);write(path.join(dir,'request.json'),request);
  const text=`<!doctype html><meta charset="utf-8"><title>AI有谱 ${stage} review</title><style>body{font:17px system-ui;max-width:1200px;margin:30px auto;padding:20px;background:#f7f4ef;color:#212129}img{max-width:100%;border:1px solid #999}button,select{font:inherit;padding:12px;margin:8px}figure{margin:25px 0}textarea{width:95%;min-height:80px}</style><h1>${stage==='score'?'确认谱面 / Score approval':'确认关键帧与试听 / Frame approval'}</h1><p>Request ${esc(request.id)}。请核对本版全部资料，未回复前任务必须暂停。Agent 自检不代替用户确认。</p><ul>${notes.map(n=>`<li>${esc(n)}</li>`).join('')}</ul>${request.display.map(f=>`<figure><figcaption>${esc(path.basename(f.original))}</figcaption>${/\.(png|jpg|jpeg|svg)$/i.test(f.file)?`<img src="${f.file}">`:/\.(mp4|webm)$/i.test(f.file)?`<video controls style="max-width:100%" src="${f.file}"></video>`:/\.(wav|mp3)$/i.test(f.file)?`<audio controls src="${f.file}"></audio>`:`<a href="${f.file}">打开资料</a>`}</figure>`).join('')}<p>完整来源与逐小节对照：${unique.filter(p=>/\.(pdf|html)$/i.test(p)).map(p=>`<a href="${esc('file:///'+p.replaceAll('\\','/'))}">${esc(path.basename(p))}</a>`).join(' · ')}</p>${stage==='score'?'<p>请选择音频方式；这是谱面阶段的真实决定：</p><select id="audio"><option value="provided">已提供录音 / 不更改音频决定</option><option value="synthesize">生成钢琴音频（优先现有采样音源）</option><option value="silent">明确无声</option></select>':''}<p>请记录发现的问题或确认说明：</p><textarea id="message"></textarea><p><button onclick="save('approve')">确认本版并下载回复</button><button onclick="save('changes_requested')">要求修改并下载回复</button></p><p>将下载的 JSON 交给 Agent。也可直接在对话中说明本版 requestId 与具体确认；Agent 应引用实际用户消息，不得代填用户身份。</p><script>const request=${JSON.stringify({id:request.id,bundleSha256:request.bundleSha256,stage}).replaceAll('<','\\u003c')};function save(decision){const message=document.querySelector('#message').value.trim();if(!message)return alert('请填写确认说明或修改意见');const r={schema:'aiyoupu-user-response/v1',actor:'user',requestId:request.id,bundleSha256:request.bundleSha256,decision,message,messageRef:'review-ui:'+crypto.randomUUID(),...(request.stage==='score'?{audioChoice:document.querySelector('#audio').value}:{})};const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(r,null,2)],{type:'application/json'}));a.download='user-response.json';a.click();}</script>`;
  fs.writeFileSync(path.join(dir,'index.html'),text,{flag:'wx'});
  return {status:request.status,request:path.join(dir,'request.json'),review:path.join(dir,'index.html'),requestId:request.id,next:'Show this review to the user and END THE TURN. Do not approve on their behalf or continue full rendering.'};
}
export function readRequest(file){
  const r=read(file),{bundleSha256,...body}=r;
  if(r.schema!=='aiyoupu-review-request/v1'||hashObject(body)!==bundleSha256)throw failure('REVIEW_REQUEST_INVALID',file,'Rebuild the review package.');
  for(const [p,h] of Object.entries(r.fingerprints))if(!fs.existsSync(p)||sha256(fs.readFileSync(p))!==h)throw failure('REVIEW_STALE',p,'Show a new review of changed inputs.');
  for(const d of r.display){const p=path.join(path.dirname(file),d.file);if(sha256(fs.readFileSync(p))!==d.sha256)throw failure('REVIEW_STALE',p,'Displayed media changed; create a new request.');}
  return r;
}
export function displayFingerprint(r){
  return hashObject({requestId:r.id,bundleSha256:r.bundleSha256,stage:r.stage,display:r.display.map(d=>({file:d.file,sha256:d.sha256})),musicSha256:r.musicSha256??null,jobSha256:r.jobSha256??null});
}
/** Compatibility view for consumers that historically read `response`.
 * Every field comes from the verified v2 approval or its consumed session. It
 * is deliberately not a v1 user-response and never invents actor/message. */
function workbenchResponseView(approval){
  return {
    schema:approval.schema,
    source:'workbench',
    kind:'workbench-approval-view',
    decision:approval.decision,
    requestId:approval.requestId,
    bundleSha256:approval.bundleSha256,
    displaySha256:approval.displaySha256,
    audioChoice:approval.stage==='score'?approval.audioChoice:null,
    approvedAt:approval.approvedAt,
    approvalSha256:approval.approvalSha256,
    credential:{provider:approval.credential.provider,sessionId:approval.credential.sessionId,clickedAt:approval.credential.clickedAt,displaySha256:approval.credential.displaySha256},
  };
}

/** Single consumer boundary for a score audio decision. It accepts both the
 * actual v1 response and the verified v2 compatibility view. */
export function approvalAudioChoice(review){
  const choice=review?.response?.audioChoice;
  if(!['provided','synthesize','silent'].includes(choice))throw failure('AUDIO_DECISION_REQUIRED','The approved score has no recorded audio choice','Show the current score review and obtain the user audio decision.');
  return choice;
}
export function approveReview({request,response,out}){
  const r=readRequest(request),answer=read(response);
  if(answer.schema!=='aiyoupu-user-response/v1'||answer.actor!=='user'||!answer.messageRef?.trim()||!answer.message?.trim())throw failure('USER_RESPONSE_REQUIRED','An actual user response or review-page response is required','Stop and wait for the user; Agent self-review cannot approve.');
  if(answer.requestId!==r.id||answer.bundleSha256!==r.bundleSha256)throw failure('REVIEW_RESPONSE_STALE','Response belongs to a different displayed version','Request confirmation of the current review bundle.');
  if(!['approve','changes_requested'].includes(answer.decision))throw failure('REVIEW_DECISION_INVALID',answer.decision,'Use an explicit decision for this stage only.');
  if(answer.decision==='changes_requested')return {status:r.stage==='score'?'WAITING_FOR_SCORE_REVISION':'WAITING_FOR_KEYFRAME_REVISION',message:answer.message,next:'Revise the requested content and show a new version; no approval was created.'};
  if(r.stage==='score'&&!['provided','synthesize','silent'].includes(answer.audioChoice))throw failure('AUDIO_DECISION_REQUIRED','Record the user audio choice','Ask whether to provide audio, synthesize, or explicitly remain silent.');
  const approval={schema:'aiyoupu-user-approval/v1',stage:r.stage,request:path.resolve(request),requestSha256:sha256(fs.readFileSync(request)),response:path.resolve(response),responseSha256:sha256(fs.readFileSync(response)),decision:answer.decision};
  write(out,approval);return {status:r.stage==='score'?'SCORE_USER_APPROVED':'KEYFRAMES_USER_APPROVED',approval:path.resolve(out),next:r.stage==='score'?'Proceed to actual-song setup, keyframes and short audition; full render still requires the second approval.':'Render this exact reviewed job; do not change its props or inputs.'};
}
export function requireApproval(file,stage,{musicSha256,jobSha256,propsSha256}={}){
  if(!file)throw failure(stage==='score'?'WAITING_FOR_SCORE_APPROVAL':'WAITING_FOR_KEYFRAME_APPROVAL','User approval is missing','Display the current review and end the turn until the user responds.');
  const a=read(file);
  if(stage==='score'&&a.schema==='aiyoupu-inherited-score-approval/v1')return inheritedScoreApproval(a,{musicSha256});
  if(a.schema==='aiyoupu-user-approval/v2'&&a.source==='workbench'){
    if(a.stage!==stage||a.decision!=='approve'||a.credential?.provider!=='workbench'||!a.credential?.nonceSha256)throw failure('USER_RESPONSE_REQUIRED',file,'A real workbench confirmation is required for this stage.');
    const {approvalSha256,...body}=a;
    if(!approvalSha256||hashObject(body)!==approvalSha256)throw failure('USER_APPROVAL_INVALID',file,'Workbench approval record was modified; obtain a new user confirmation.');
    if(!a.request||!fs.existsSync(a.request)||sha256(fs.readFileSync(a.request))!==a.requestSha256)throw failure('USER_APPROVAL_INVALID',file,'Approval no longer matches its review request.');
    const r=readRequest(a.request);
    const session=verifyWorkbenchSession(a);
    if(a.requestId!==r.id||a.bundleSha256!==r.bundleSha256||a.displaySha256!==displayFingerprint(r))throw failure('USER_APPROVAL_INVALID',file,'Approval is bound to different displayed content.');
    if((musicSha256&&r.musicSha256!==musicSha256)||(jobSha256&&a.jobSha256!==jobSha256)||(propsSha256&&a.propsSha256!==propsSha256))throw failure('USER_APPROVAL_STALE','Music, job or props changed since review','Show the affected stage again.');
    if(stage==='score'&&!['provided','synthesize','silent'].includes(a.audioChoice))throw failure('AUDIO_DECISION_REQUIRED',file,'Record the user audio choice in the same real content approval.');
    return {request:r,response:workbenchResponseView(a),credential:a.credential,session,approval:a};
  }
  if(a.schema!=='aiyoupu-user-approval/v1'||a.stage!==stage||a.decision!=='approve'||sha256(fs.readFileSync(a.request))!==a.requestSha256||sha256(fs.readFileSync(a.response))!==a.responseSha256)throw failure('USER_APPROVAL_INVALID',file,'Obtain a valid response to the current review.');
  const r=readRequest(a.request),response=read(a.response);
  if(response.actor!=='user'||response.decision!=='approve'||!response.messageRef?.trim()||response.requestId!==r.id||response.bundleSha256!==r.bundleSha256)throw failure('USER_RESPONSE_REQUIRED',file,'Agent-written approval is not a substitute for a user response.');
  if((musicSha256&&r.musicSha256!==musicSha256)||(jobSha256&&r.jobSha256!==jobSha256))throw failure('USER_APPROVAL_STALE','Music or job changed since review','Show the affected stage again.');
  if(stage==='score'&&!['provided','synthesize','silent'].includes(response.audioChoice))throw failure('AUDIO_DECISION_REQUIRED',file,'Record the user audio choice in the same real content approval.');
  return {request:r,response,approval:a};
}
export function scoreRequest(a){
  const timeline=read(a.timeline);
  if(!a.comparison&&['svg','midi'].includes(a.sourceType))return requestReview({stage:'score',out:a.out,sourceType:a.sourceType,files:[a.source,a.timeline,...(a.score?[a.score]:[])],display:[a.source,...(a.score?[a.score]:[])].filter(p=>/\.(svg|png|jpg)$/i.test(p)),musicSha256:musicIdentity(timeline),notes:['标准素材直接审阅：核对来源、音符、时值与连音。此分支没有宣称完成 MusicXML/OMR 语义验证。','请选择音频方式；确认后才进入关键帧阶段。']});
  const comparison=read(a.comparison),dir=path.dirname(path.resolve(a.comparison));
  if(comparison.structuralPassed!==true||!comparison.measures?.length)throw failure('SCORE_STRUCTURE_REQUIRED','Comparison is missing or structurally invalid','Run score check/compare first; keep all doubts.');
  const original=fs.readFileSync(a.source);
  if(comparison.bindings?.sourceSha256!==sha256(original))throw failure('SOURCE_PROVENANCE_REQUIRED','Comparison source does not match the original input','Compare the original PDF/image itself; preserve rasterization provenance instead of relabeling a page PNG.');
  if(original.subarray(0,4).toString()==='%PDF'&&a.sourceType!=='pdf')throw failure('SOURCE_TYPE_MISMATCH','Original source is PDF','Keep the real source type after engraving.');
  const crops=comparison.measures.flatMap(m=>['source','layout'].map(s=>{const c=m.crops?.[s];if(!c)throw failure('MEASURE_CROPS_REQUIRED',m.id,'Generate real source/reflow crops for every measure.');const f=path.join(dir,c.file);if(sha256(fs.readFileSync(f))!==c.sha256)throw failure('REVIEW_STALE',f,'Regenerate comparison crops.');return f;}));
  const musicxml=fs.readdirSync(dir).find(n=>n.startsWith('original-musicxml.'));if(!musicxml)throw failure('SCORE_STRUCTURE_REQUIRED','Original MusicXML snapshot missing','Retain the checked structured notation.');
  const structural=path.join(dir,'check.json');validateNotationMapping(timeline,read(structural));
  const files=[a.source,a.comparison,structural,path.join(dir,musicxml),path.join(dir,'comparison.html'),...crops];
  if(a.audit){const audit=validateNotationAudit(a.audit,{source:a.source,check:structural}),html=path.join(path.dirname(path.resolve(a.audit)),'index.html');files.push(a.audit,html,...Object.keys(audit.fingerprints));crops.push(html);}
  return requestReview({stage:'score',out:a.out,sourceType:a.sourceType,files,display:crops,musicSha256:musicIdentity(timeline),notes:['核对原谱与重排谱的每个小节，包括时值、声部、延音线和圆滑线。','Agent 自检与用户确认分别记录。无法确认的内容请要求修改。','确认回复同时记录使用已有录音、合成音频或明确静音。']});
}
