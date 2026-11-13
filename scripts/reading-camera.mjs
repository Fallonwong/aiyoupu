import {failure} from './audio.mjs';

// Normalized score travel per frame, at 30 fps. A diagnostic limit, not a
// guarantee of readability at every zoom or projection.
export const cameraSpeedLimit = fps => 0.022 * 30 / (fps || 30);
export const rowPanSpeedLimit = fps => 0.026 * 30 / (fps || 30);
export const cameraTravel = (dx, dy, timeline) =>
  Math.hypot(dx / (timeline.scoreWidth || 1600), dy / (timeline.scoreHeight || 1600));

// Keep exact attack anchors while carrying a common velocity through each
// internal anchor. A harmonic mean prevents overshoot on uneven spacing.
function readingRun(points) {
  const speeds = points.slice(1).map((b,i)=>(b.x-points[i].x)/(b.frame-points[i].frame));
  const slopes = points.map((_,i)=>{
    const a=speeds[i-1],b=speeds[i];
    if(a===undefined||b===undefined||a*b<=0)return 0;
    return 2*a*b/(a+b);
  });
  return {...points[0],points,slopes};
}

export function buildReadingCamera(timeline, systems, {transitionFrames=14}={}) {
  if(!Number.isInteger(transitionFrames)||transitionFrames<12||transitionFrames>16)
    throw failure('CAMERA_WINDOW','Use 12..16 frames as the base wrap window','Check the actual wrap in a motion preview.');
  const bounds=timeline.systemBounds;
  const centers=new Map();
  if(systems!==undefined){
    if(!systems?.length||new Set(systems.map(s=>s.id)).size!==systems.length||systems.some(s=>!Number.isFinite(s.centerY)))
      throw failure('SYSTEMS_REQUIRED','Unique measured systems and finite centers required','Supply layout systems with id and centerY.');
    for(const s of systems)centers.set(s.id,s.centerY);
  }else{
    if(!bounds?.length)throw failure('SYSTEMS_REQUIRED','No measured system bounds','Supply --systems and assign a systemId to every event.');
    bounds.forEach((b,i)=>centers.set(b.id??i,(b.top+b.bottom)/2));
  }
  const groups=[];
  for(const e of [...timeline.events].sort((a,b)=>a.frame-b.frame)){
    if(!Number.isFinite(e.frame)||!Number.isFinite(e.x)||!Number.isFinite(e.y))
      throw failure('CAMERA_EVENTS_REQUIRED','Nonfinite frame/point','Use checked events.');
    const row=systems===undefined?bounds.findIndex(b=>e.y>=b.top&&e.y<=b.bottom):-1;
    const id=systems!==undefined?e.systemId:row<0?undefined:bounds[row].id??row;
    if(!centers.has(id)||!Number.isFinite(centers.get(id)))
      throw failure('SYSTEM_MAPPING_REQUIRED',String(e.frame),'Map each attack to its engraved system.');
    const prev=groups.at(-1),p={frame:e.frame,id,x:e.x,y:centers.get(id),hand:e.hand};
    if(prev?.frame===e.frame){
      if(prev.id!==id)throw failure('CAMERA_SYSTEM_CONFLICT','Simultaneous hands on different systems','Review system and occurrence mapping.');
      if(e.hand==='right'&&prev.hand!=='right')groups[groups.length-1]=p;
    }else groups.push(p);
  }
  if(!groups.length)throw failure('CAMERA_EVENTS_REQUIRED','Empty timeline','Supply mapped events.');
  const rows=[];
  for(const p of groups){
    if(rows.at(-1)?.[0].id!==p.id)rows.push([]);
    rows.at(-1).push(p);
  }
  const runs=rows.map(readingRun);
  const transitions=runs.slice(1).map((b,i)=>{
    const a=runs[i].points.at(-1);
    const distance=cameraTravel(b.x-a.x,b.y-a.y,timeline);
    // Smoothstep peaks at 1.5 times the average velocity.
    const span=Math.max(transitionFrames,Math.ceil(1.5*distance/cameraSpeedLimit(timeline.fps)));
    const available=b.frame-a.frame;
    if(span<=available)return {start:b.frame-span};
    const fps=timeline.fps||30,frame=Math.ceil(b.frame);
    const frames=Math.min(Math.round(fps*1.45),Math.max(Math.round(fps*.7),Math.ceil(distance*54*fps/30)));
    const lead=Math.round(frames*.68);
    // Use time on both sides of the entrance; camera and musical time are
    // independent. Midpoints leave a complete reading interval between wraps.
    const lower=i?Math.ceil((Math.ceil(runs[i].frame)+frame)/2):0;
    const upper=i+2<runs.length?Math.floor((frame+Math.ceil(runs[i+2].frame))/2):timeline.durationInFrames-1;
    return {pan:{frame,start:Math.max(lower,frame-lead),end:Math.min(upper,frame+frames-lead),pullback:Math.min(.12,distance*.17)}};
  });
  let row=0,k=0;
  const focusPath=Array.from({length:timeline.durationInFrames},(_,f)=>{
    if(row+1<runs.length&&f>=runs[row+1].frame){row++;k=0;}
    const {points,slopes}=runs[row],next=runs[row+1],wrap=transitions[row];
    while(k+1<points.length&&points[k+1].frame<=f)k++;
    const a=points[k],b=points[k+1];
    if(b&&f>a.frame){
      const dt=b.frame-a.frame,t=(f-a.frame)/dt,t2=t*t,t3=t2*t;
      const x=(2*t3-3*t2+1)*a.x+(t3-2*t2+t)*dt*slopes[k]+(-2*t3+3*t2)*b.x+(t3-t2)*dt*slopes[k+1];
      return {focusX:x,focusY:a.y};
    }
    if(next&&wrap?.start!==undefined&&f>=wrap.start){
      const t=(f-wrap.start)/(next.frame-wrap.start),s=t*t*(3-2*t);
      return {focusX:a.x+(next.x-a.x)*s,focusY:a.y+(next.y-a.y)*s};
    }
    return {focusX:a.x,focusY:a.y};
  });
  const rowPans=transitions.flatMap(t=>t.pan?[t.pan]:[]);
  for(const {frame,start,end,pullback} of rowPans){
    const exit=focusPath[frame-1],entry=focusPath[frame];
    if(!exit||!entry||start>=frame||end<=frame)
      throw failure('CAMERA_WINDOW','Not enough frames for a continuous row change','Review the engraved layout and transition in motion.');
    for(let f=start;f<=end;f++){
      const u=(f-start)/(end-start),s=u*u*(3-2*u);
      const from=f<frame?focusPath[f]:exit,to=f>=frame?focusPath[f]:entry;
      focusPath[f]={focusX:from.focusX+(to.focusX-from.focusX)*s,
        focusY:from.focusY+(to.focusY-from.focusY)*s,zoom:1-pullback*Math.sin(Math.PI*u)**2};
    }
  }
  return {focusPath,focusHandoffs:[],rowPans};
}
