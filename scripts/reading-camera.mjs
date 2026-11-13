import {failure} from './audio.mjs';

// Normalized score travel per frame, at 30 fps. A diagnostic limit, not a
// guarantee of readability at every zoom or projection.
export const cameraSpeedLimit = fps => 0.022 * 30 / (fps || 30);
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
    // Reserve the first attack on the new system and the last on the old one.
    // If both cannot fit a gentle pan, use a deliberate score-only dip.
    return span<=available
      ? {start:b.frame-span}
      : {start:b.frame,handoff:{frame:Math.ceil(b.frame),dipFrames:Math.min(5,Math.max(0,Math.ceil(available)-2))}};
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
    if(next&&wrap&&!wrap.handoff&&f>=wrap.start){
      const t=(f-wrap.start)/(next.frame-wrap.start),s=t*t*(3-2*t);
      return {focusX:a.x+(next.x-a.x)*s,focusY:a.y+(next.y-a.y)*s};
    }
    return {focusX:a.x,focusY:a.y};
  });
  return {focusPath,focusHandoffs:transitions.flatMap(t=>t.handoff?[t.handoff]:[])};
}
