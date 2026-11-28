import fs from 'node:fs';
import path from 'node:path';
import {failure, run, sha256} from './audio.mjs';
import {executeLogged} from './execution.mjs';
import {validateJianpu} from './jianpu-check.mjs';
import {escapeXml, layoutJianpu} from './jianpu-layout.mjs';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const hash = file => sha256(fs.readFileSync(file));
const write = (file, data) => fs.writeFileSync(file, JSON.stringify(data,null,2)+'\n',{flag:'wx'});
const fail = (code, message) => { throw failure(code,message,'Inspect the original crop and retain every unresolved reading.'); };
const fields = ['x','y','width','height'];
const inBounds = (box, frame) => fields.every(key => Number.isSafeInteger(box?.[key])) &&
  box.width > 0 && box.height > 0 && box.x >= frame.x && box.y >= frame.y &&
  box.x + box.width <= frame.x + frame.width && box.y + box.height <= frame.y + frame.height;

export function cropJianpuImage({image, regions, out, ffmpeg='ffmpeg', ffprobe='ffprobe'}) {
  const spec = read(regions);
  if (!['.png','.jpg','.jpeg','.webp','.bmp','.tif','.tiff'].includes(path.extname(image).toLowerCase())) {
    fail('JIANPU_IMAGE_FORMAT','Use one original raster image per capture.');
  }
  const media = JSON.parse(run(ffprobe,['-v','error','-show_streams','-of','json',image]));
  const {width,height} = media.streams.find(stream=>stream.codec_type==='video') ?? {};
  if (!width || !height) fail('JIANPU_IMAGE_FORMAT','No decoded source image');
  const page = {x:0,y:0,width,height};
  const angle = spec.deskewDegrees ?? 0;
  const scale = spec.scale ?? 2;
  if (spec.schema!=='aiyoupu-jianpu-regions/v1'||!Number.isInteger(scale)||scale<1||scale>4||
      !Number.isFinite(angle)||Math.abs(angle)>15||!inBounds(spec.heading,page)||!spec.lines?.length) {
    fail('JIANPU_REGIONS_INVALID','Need a measured heading, line list and bounded deskew/scale');
  }
  const captures = [{kind:'heading',box:spec.heading}];
  const measureNumbers = new Set();
  for (const [index,line] of spec.lines.entries()) {
    const system = index+1;
    if (!inBounds(line.box,page)||!line.measures?.length) fail('JIANPU_REGIONS_INVALID','Missing line or measures: '+system);
    captures.push({kind:'line',system,box:line.box});
    for(const measure of line.measures) {
      if(!Number.isInteger(measure.number)||measure.number<0||measureNumbers.has(measure.number)||!inBounds(measure.box,line.box)||
        !Array.isArray(measure.rows)||measure.rows.length<1||measure.rows.length>2||
        new Set(measure.rows.map(row=>row.row)).size!==measure.rows.length||!measure.rows.some(row=>row.row==='upper')||
        measure.rows.some(row=>!['upper','lower'].includes(row.row)||!inBounds(row.box,measure.box))) {
        fail('JIANPU_REGIONS_INVALID','Invalid measured bar or voice crop: '+measure.number);
      }
      measureNumbers.add(measure.number);
      captures.push({kind:'measure',system,number:measure.number,box:measure.box,rows:measure.rows});
      for(const row of measure.rows) captures.push({kind:'voice',system,number:measure.number,row:row.row,box:row.box});
    }
  }
  fs.mkdirSync(out,{recursive:false});
  const original = path.join(out,'original'+path.extname(image).toLowerCase());
  fs.copyFileSync(image,original,fs.constants.COPYFILE_EXCL);
  // Rotate the whole page once, then crop each region from the rotated page.
  // Region boxes are measured in original-image pixels; cropping first and
  // rotating the small crop would shift every off-center box relative to its
  // source coordinates and the comparison page.
  const theta=angle*Math.PI/180;
  const rotw=Math.ceil(width*Math.abs(Math.cos(theta))+height*Math.abs(Math.sin(theta)));
  const roth=Math.ceil(width*Math.abs(Math.sin(theta))+height*Math.abs(Math.cos(theta)));
  let pageSource=original,pageWidth=width,pageHeight=height;
  if(angle){
    pageSource=path.join(out,'rotated'+path.extname(image).toLowerCase());
    executeLogged(ffmpeg,['-v','error','-i',original,'-vf',
      'rotate='+theta+':ow='+rotw+':oh='+roth+':fillcolor=white','-frames:v','1',pageSource],
      {log:path.join(out,'rotated.command.json')});
    pageWidth=rotw;pageHeight=roth;
  }
  const transformPoint=(x,y)=>{
    const dx=x-width/2,dy=y-height/2,c=Math.cos(theta),s=Math.sin(theta);
    return {x:pageWidth/2+dx*c-dy*s,y:pageHeight/2+dx*s+dy*c};
  };
  const rotatedBox=box=>{
    const pts=[[box.x,box.y],[box.x+box.width,box.y],[box.x,box.y+box.height],[box.x+box.width,box.y+box.height]].map(([x,y])=>transformPoint(x,y));
    const xs=pts.map(point=>point.x),ys=pts.map(point=>point.y);
    const left=Math.max(0,Math.floor(Math.min(...xs))),top=Math.max(0,Math.floor(Math.min(...ys)));
    const right=Math.min(pageWidth,Math.ceil(Math.max(...xs))),bottom=Math.min(pageHeight,Math.ceil(Math.max(...ys)));
    return {x:left,y:top,width:Math.max(1,right-left),height:Math.max(1,bottom-top)};
  };
  for(const capture of captures) {
    const tag = capture.kind==='heading'?'heading':capture.kind==='line'?'line-'+capture.system:
      'measure-'+capture.number+(capture.row?'-'+capture.row:'');
    const file = path.join(out,tag+'.png');
    const b=angle?rotatedBox(capture.box):capture.box;
    executeLogged(ffmpeg,['-v','error','-i',pageSource,'-vf',
      'crop='+b.width+':'+b.height+':'+b.x+':'+b.y+':exact=1,scale=iw*'+scale+':ih*'+scale+':flags=lanczos',
      '-frames:v','1',file],{log:path.join(out,tag+'.command.json')});
    Object.assign(capture,{page:1,file,sha256:hash(file)});
  }
  const capture = path.join(out,'capture.json');
  write(capture,{schema:'aiyoupu-jianpu-capture/v1',original,sourceSha256:hash(original),width,height,deskewDegrees:angle,scale,
    regionsSha256:hash(regions),captures});
  const request=path.join(out,'recognition-request.json');
  write(request,{schema:'aiyoupu-jianpu-vision-request/v1',capture,source:original,scoreSchema:path.resolve(import.meta.dirname,'../references/jianpu.schema.json'),
    heading:captures.find(item=>item.kind==='heading'),measures:captures.filter(item=>item.kind==='measure').map(bar=>({
      ...bar,voiceCrops:captures.filter(item=>item.kind==='voice'&&item.number===bar.number)})),
    instructions:['Read the heading first. If 1=X or meter is unreadable, return missing values and the heading location.',
      'Read each measure once with its voice crops. Copy visible notes, lyrics and symbols only. For unclear readings, retain an issue with original-image coordinates.',
      'Use neighboring line crops for slurs, ties, tuplets, hairpin endpoints and lyrics extending beyond a single crop. Keep source coordinates in the original image.',
      'Return a JianpuJSON draft following the supplied schema. Put user-confirmed playback choices in the tempo table and keep all printed words in annotations.']});
  return {status:'crops_ready_for_vision',capture,request,measures:measureNumbers.size,scale,deskewDegrees:angle};
}

function readCapture(file) {
  const capture=read(file);
  if(capture.schema!=='aiyoupu-jianpu-capture/v1'||hash(capture.original)!==capture.sourceSha256||
    !capture.captures?.some(item=>item.kind==='measure')||
    capture.captures.some(item=>hash(item.file)!==item.sha256)) fail('JIANPU_IMAGE_CAPTURE_STALE','Original or crops changed');
  return capture;
}

const uri = file => 'data:image/png;base64,'+fs.readFileSync(file).toString('base64');
const localSvg = (svg, b) => svg.replace(/<svg\b[^>]*>/,
  '<svg xmlns="http://www.w3.org/2000/svg" font-family="Arial, Microsoft YaHei, sans-serif" viewBox="'+
  [b.x,b.y,b.width,b.height].join(' ')+'">');

function comparisonHtml(score,capture,layout) {
  const heading=capture.captures.find(item=>item.kind==='heading');
  const marks=score.issues.map(issue=>'<li>'+escapeXml(issue.message)+' · 第 '+(issue.source.measure??'谱头')+
    ' · 原图像素 '+fields.map(key=>issue.source[key]).join(', ')+'</li>').join('');
  const issueOverlay=score.issues.length ? '<figure><svg xmlns="http://www.w3.org/2000/svg" class="issue-map" viewBox="0 0 '+
    capture.width+' '+capture.height+'"><image href="data:'+
    ({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.bmp':'image/bmp','.tif':'image/tiff','.tiff':'image/tiff'})[path.extname(capture.original).toLowerCase()]+
    ';base64,'+fs.readFileSync(capture.original).toString('base64')+'" width="'+capture.width+'" height="'+capture.height+'"/>'+
    score.issues.map(issue=>'<rect x="'+issue.source.x+'" y="'+issue.source.y+'" width="'+issue.source.width+'" height="'+issue.source.height+
      '" fill="#e65d2722" stroke="#e65d27" stroke-width="5"><title>'+escapeXml(issue.message)+'</title></rect>').join('')+'</svg></figure>':'';
  const bars=capture.captures.filter(item=>item.kind==='measure').map(item=>{
    const b=layout.measureBounds.get(item.number);
    if(!b) return '';
    const issues=score.issues.filter(issue=>issue.source.measure===item.number).map(issue=>{
      const relative=fields.map(key=>issue.source[key]);
      return '<figcaption>'+escapeXml(issue.message)+' · 原图 '+relative.join(', ')+'</figcaption>';
    }).join('');
    return '<section><h2>第 '+item.number+' 小节</h2><div class="pair"><figure><img src="'+uri(item.file)+
      '" alt="原图第 '+item.number+' 小节">'+issues+'</figure><figure>'+
      localSvg(layout.svg,b)+'</figure></div></section>';
  }).join('');
  return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>'+escapeXml(score.title)+
    ' · 简谱对照</title><style>body{margin:28px auto;max-width:1180px;padding:0 22px;font:17px system-ui;color:#222;background:#faf8f4}'+
    'h1{font-size:27px}h2{font-size:17px;margin-top:24px}figure{margin:0;padding:12px;background:#fff;border:1px solid #ddd}'+
    '.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start}img,svg{width:100%;max-height:350px;display:block;object-fit:contain}.issue-map{max-height:850px}small{color:#56504d}</style>'+
    '<h1>'+escapeXml(score.title)+' · 原谱与校样</h1><p>左边是原谱裁切，右边是由识读稿排出的简谱。请核对数字、八度点、时值、两行声部、歌词和表情标记。</p>'+
    '<details><summary>查看原谱谱头</summary><figure><img src="'+uri(heading.file)+'" alt="原图谱头"></figure></details>'+
    (marks?'<h2>待核</h2><ul>'+marks+'</ul>':'')+issueOverlay+bars+'</html>';
}

export function auditJianpuImage({capture: capturePath, draft, out}) {
  const capture=readCapture(capturePath);
  const score=read(draft);
  if(!score.tonic?.step||!score.meter?.beats||!score.meter?.beatUnit) {
    const box=capture.captures.find(item=>item.kind==='heading').box;
    return {status:'WAITING_FOR_HEADING',exitCode:3,missing:[...(!score.tonic?.step?['1=X']:[]),...(!score.meter?.beats||!score.meter?.beatUnit?['拍号']:[])],
      original:capture.original,source:{page:1,...box}};
  }
  const structural=validateJianpu(score);
  if(structural.status==='invalid') return {...structural,status:'IMAGE_STRUCTURE_BLOCKED',exitCode:3};
  const bars=capture.captures.filter(item=>item.kind==='measure');
  const byMeasure=new Map(bars.map(bar=>[bar.number,bar]));
  const voices=new Map(score.voices.map(voice=>[voice.id,voice.row]));
  const originalFrame={x:0,y:0,width:capture.width,height:capture.height};
  const errors=[];
  if(score.measures.length!==bars.length||score.measures.some((measure,index)=>{
    const bar=bars[index];
    return !bar||measure.number!==bar.number||measure.system!==bar.system||measure.voices.length!==bar.rows.length||
      measure.voices.some(voice=>!bar.rows.some(row=>row.row===voices.get(voice)));
  })) errors.push('Measure order, systems or active voice rows disagree with the original crop inventory');
  for(const note of score.notes) {
    const row=byMeasure.get(note.measure)?.rows.find(item=>item.row===voices.get(note.voice));
    if(!row||note.source?.page!==1||note.source?.measure!==note.measure||!inBounds(note.source,row.box)) errors.push('Note source outside its voice crop: '+note.id);
  }
  for(const item of [...score.annotations,...score.issues]) {
    if(item.source?.page!==1||!inBounds(item.source,originalFrame)) errors.push('Original source location missing or invalid: '+item.id);
  }
  if(errors.length) return {status:'IMAGE_STRUCTURE_BLOCKED',exitCode:3,errors};
  const layout=layoutJianpu(score);
  fs.mkdirSync(out,{recursive:false});
  const json=path.join(out,'score.jianpu.json');
  const compare=path.join(out,'comparison.html');
  fs.copyFileSync(draft,json,fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(compare,comparisonHtml(score,capture,layout),{flag:'wx'});
  const audit=path.join(out,'image-audit.json');
  const status=structural.readyForPlayback?'WAITING_FOR_IMAGE_SCORE_APPROVAL':'NEEDS_SOURCE_OR_PLAYBACK_REVIEW';
  write(audit,{schema:'aiyoupu-jianpu-image-audit/v1',status,original:capture.original,sourceSha256:capture.sourceSha256,
    capture:path.resolve(capturePath),captureSha256:hash(capturePath),draftSha256:hash(json),comparison:compare,
    comparisonSha256:hash(compare),measures:bars.map(bar=>({number:bar.number,rows:bar.rows.length})),structural});
  return {status,audit,score:json,comparison:compare,measures:bars.length,issues:structural.issues,playbackIssues:structural.playbackIssues};
}

export function validateImageAudit(file,scoreFile) {
  const report=read(file);
  if(report.schema!=='aiyoupu-jianpu-image-audit/v1'||report.status!=='WAITING_FOR_IMAGE_SCORE_APPROVAL'||
      hash(scoreFile)!==report.draftSha256||hash(report.capture)!==report.captureSha256||
      hash(report.comparison)!==report.comparisonSha256) fail('JIANPU_IMAGE_AUDIT_STALE','Image comparison does not match the current JSON');
  const capture=readCapture(report.capture);
  if(capture.original!==report.original||capture.sourceSha256!==report.sourceSha256) fail('JIANPU_IMAGE_AUDIT_STALE','Original image fingerprint mismatch');
  return report;
}
