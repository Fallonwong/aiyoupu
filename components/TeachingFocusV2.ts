import type {AiyoupuTimeline} from './AiyoupuScoreScene';
export function teachingDefaultScale(timeline:AiyoupuTimeline){
  const bounds=timeline.systemBounds;
  return bounds?.length?Math.min(2.4,Math.floor(858/(Math.max(...bounds.map(b=>b.bottom-b.top))+32)*20)/20):2.4;
}
/** Flat teaching view. A single system keeps its measured midpoint; a multi-system
 * score keeps the measured per-system focus so the current reading band follows
 * the performance without flattening unrelated rows. */
export function teachingFocusPath(timeline:AiyoupuTimeline,staffMidpointY:number){
  const events=timeline.events.filter(e=>e.hand==='right').sort((a,b)=>a.frame-b.frame);
  if(!Number.isFinite(staffMidpointY)||!events.length||events.some((e,i)=>!Number.isFinite(e.x)||!Number.isFinite(e.frame)||(i>0&&e.frame<=events[i-1].frame))) throw Error('TEACHING_MELODY_GEOMETRY_REQUIRED');
  const measured=timeline.focusPath;
  if(!measured?.length||measured.length!==timeline.durationInFrames||measured.some(p=>!Number.isFinite(p.focusX)||!Number.isFinite(p.focusY))) throw Error('TEACHING_FOCUS_PATH_REQUIRED');
  const multiSystem=measured.some(p=>Math.abs(p.focusY-staffMidpointY)>1e-6);
  if(multiSystem)return measured.map(p=>({focusX:p.focusX,focusY:p.focusY}));
  return Array.from({length:timeline.durationInFrames},(_,frame)=>{
    const next=events.findIndex(e=>e.frame>frame);
    const a=events[next===-1?events.length-1:Math.max(0,next-1)],b=next===-1?a:events[next];
    const u=a===b?0:Math.max(0,Math.min(1,(frame-a.frame)/(b.frame-a.frame)));
    return {focusX:a.x+(b.x-a.x)*u,focusY:staffMidpointY};
  });
}

/** A system boundary is a reading transition, not a jump cut. Extend each
 * measured pan over a longer eased window while keeping its exact destination
 * frame, so the first attack of the new row is already at rest. */
export function smoothTeachingFocusPath(path:{focusX:number;focusY:number}[],frames=24){
  if(path.length<2)return path.map(p=>({...p}));
  const out=path.map(p=>({...p})),width=Math.max(16,Math.round(frames));
  // Seed a measured boundary that would otherwise be a single-frame jump.
  for(let i=1;i+1<out.length;i++)if(Math.abs(out[i].focusY-out[i-1].focusY)<1e-6&&Math.abs(out[i+1].focusY-out[i].focusY)>=1e-6)out[i].focusY=out[i+1].focusY;
  // Collapse a staircase of one-way steps into one transition span so the
  // eased move is never split at an intermediate system midpoint.
  for(let i=1;i<out.length;i++){
    const d=Math.sign(out[i].focusY-out[i-1].focusY);
    if(!d)continue;
    let end=i;while(end+1<out.length&&Math.sign(out[end+1].focusY-out[end].focusY)===d)end++;
    const first=out[Math.max(0,i-1)].focusY,last=out[end].focusY,count=end-i+1;
    for(let j=0;j<count;j++)out[i+j].focusY=first+(last-first)*(j+1)/count;
    i=end;
  }
  for(let i=1;i<out.length;i++){
    if(Math.abs(out[i].focusY-out[i-1].focusY)<1e-6)continue;
    const originalStart=i;
    let end=i;
    while(end+1<out.length&&Math.abs(out[end+1].focusY-out[end].focusY)>=1e-6)end++;
    const destination=end,before=Math.max(0,originalStart-1),start=Math.max(before+1,destination-width+1);
    const y0=out[before].focusY,y1=out[destination].focusY,x0=out[start].focusX,x1=out[destination].focusX,span=destination-start+1;
    if(span<2){i=end;continue;}
    for(let j=start;j<destination;j++){
      const t=(j-start)/span,s=t*t*(3-2*t);
      out[j].focusY=y0+(y1-y0)*s;out[j].focusX=x0+(x1-x0)*s;
    }
    out[destination]={...out[destination],focusY:y1,focusX:x1};
    i=destination;
  }
  return out;
}

export type TeachingSystemBand={centerY:number;top:number;bottom:number};

/** Find the sustained measured row centres and turn their midpoints into
 * one-system page bands. Interpolated transition frames are excluded by count,
 * so the crop follows real engraved systems rather than the camera tween. */
export function teachingSystemBands(path:{focusX:number;focusY:number}[],scoreHeight:number):TeachingSystemBand[]{
  if(path.length<2||!Number.isFinite(scoreHeight)||scoreHeight<=0)return [];
  const clusters:{y:number;count:number}[]=[];
  for(const point of path){
    if(!Number.isFinite(point.focusY))continue;
    const cluster=clusters.find(item=>Math.abs(item.y-point.focusY)<2);
    if(cluster)cluster.count++;
    else clusters.push({y:point.focusY,count:1});
  }
  const minimum=Math.max(8,Math.ceil(path.length*.02));
  const centres=clusters.filter(item=>item.count>=minimum).map(item=>item.y).sort((a,b)=>a-b);
  if(centres.length<2)return [];
  return centres.map((centerY,index)=>({
    centerY,
    top:index===0?0:(centres[index-1]+centerY)/2,
    bottom:index===centres.length-1?scoreHeight:(centerY+centres[index+1])/2,
  }));
}
