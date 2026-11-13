import React from 'react';
import {useCurrentFrame} from 'remotion';
import {scoreAttackEvents,scoreChordGeometry} from './ScoreChordGeometry';

export type ScoreNote = {x:number;y:number;pitch?:string;attack?:boolean;tieStart?:boolean;tieStop?:boolean;
  part?:string;voice?:string;staff?:number;durationFrames?:number;soundingEndFrame?:number};
export type ScoreAttack = ScoreNote & {frame:number;systemId?:string|number;notes?:ScoreNote[]};
export type ScoreNoteLeapProps = {
  events?: ScoreAttack[]; color?:string; coreColor?:string; width?:number; height?:number;
  arcHeight?:number; trailFrames?:number; highlightFrames?:number;
  holdHighlightUntilNext?:boolean;
  glowColor?:string; glowStrength?:number; starburst?:boolean; trailWidth?:number;
  taperTrail?:boolean;
  followChordNotes?:boolean;
  preciseLandings?:boolean;
  /** Only the struck notehead breathes; no moving head or air trail. */
  pulseOnly?:boolean;
  /** Consecutive frame count for a struck note's breathing pulse. */
  pulseFrames?:number;
  /** Screen-space correction for the notehead glow. */
  pulseScale?:number;
  rippleRing?:boolean; rippleFrames?:number; rippleMaxRadius?:number; rippleColor?:string;
  rippleOpacity?:number; inactiveNoteOpacity?:number;
  className?:string; style?:React.CSSProperties;
};
/** Coordinates share the score's pixel space. Every time value is in frames. */
export const ScoreNoteLeap:React.FC<ScoreNoteLeapProps> = ({
  events:writtenEvents=[],color='#ffd477',coreColor='#fff9e9',width=1600,height=320,arcHeight=42,
  trailFrames=5,highlightFrames=10,holdHighlightUntilNext=false,glowColor=color,
  glowStrength=0,starburst=false,trailWidth=2,taperTrail=true,followChordNotes=false,preciseLandings=false,pulseOnly=false,
  pulseFrames=18,
  pulseScale=1,
  rippleRing=false,rippleFrames=14,rippleMaxRadius=38,rippleColor,
  rippleOpacity=1,inactiveNoteOpacity=.24,
  className,style
}) => {
  const frame=useCurrentFrame();
  const events=React.useMemo(()=>scoreAttackEvents(writtenEvents),[writtenEvents]);
  const point=(f:number) => {
    if(!events.length || f<events[0].frame) return null;
    const index=events.findIndex((e)=>e.frame>f);
    const a=events[index===-1?events.length-1:index-1];
    const b=events[index===-1?events.length-1:index];
    if(a!==b && (b.x<a.x-200 || Math.abs(b.y-a.y)>200)) return null;
    const t=a===b?0:Math.max(0,Math.min(1,(f-a.frame)/(b.frame-a.frame)));
    return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t-4*arcHeight*t*(1-t)};
  };
  const head=point(frame);
  const sampleCount = Math.max(30, Math.round(trailFrames * 3));
  const rawTail = Array.from({length: sampleCount}, (_, i) =>
    point(frame - trailFrames + (i * trailFrames) / (sampleCount - 1))
  ).filter((p): p is {x: number; y: number} => p !== null);
  const tail: {x:number;y:number}[] = [];
  if (head) {
    tail.push(head);
    for (let i = rawTail.length - 2; i >= 0; i--) {
      const p = rawTail[i];
      const prev = tail[tail.length - 1];
      if (Math.abs(p.x - prev.x) > 200 || Math.abs(p.y - prev.y) > 150) break;
      tail.push(p);
    }
    tail.reverse();
  }

  const segments: {p1:{x:number;y:number}; p2:{x:number;y:number}; t:number}[] = [];
  if (tail.length >= 2) {
    const N = tail.length - 1;
    for (let i = 0; i < N; i++) {
      segments.push({
        p1: tail[i],
        p2: tail[i + 1],
        t: (i + 0.5) / N,
      });
    }
  }

  const semantic=events.some(e=>(e.notes??[e]).some(n=>n.tieStart||n.tieStop||n.attack===false||n.durationFrames!==undefined));
  const chord=followChordNotes||semantic?scoreChordGeometry(events,frame,arcHeight,trailFrames,18,preciseLandings):null;
  const visibleSegments=pulseOnly?[]:chord?.segments??segments;
  const visibleHeads=pulseOnly?[]:chord?.heads??(head?[head]:[]);
  const visibleTails=pulseOnly?[]:chord?.tails??[tail];

  return <svg className={className} width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{overflow:'visible',...style}}>
    {(() => {
    let lastActive = -1;
    if (pulseOnly) {
      for (let i=events.length-1; i>=0; i--) {
        if (frame-events[i].frame >= 0 && frame-events[i].frame < pulseFrames) { lastActive = i; break; }
      }
    }
    return events.map((event,i)=>{
      const age=frame-event.frame;
      if(age<0) return null;
      const isHeld=holdHighlightUntilNext&&(i===events.length-1||frame<events[i+1].frame);
      const life=pulseOnly?Math.max(1,pulseFrames):highlightFrames;
      // Once a notehead has finished glowing it has no remaining visual role.
      // Unmount it instead of accumulating hundreds of invisible SVG filters.
      if(!isHeld&&inactiveNoteOpacity===0&&age>=Math.max(life,rippleRing?rippleFrames:0)) return null;
      const strength=isHeld?Math.max(.7,1-age/life):Math.max(0,1-age/life);
      const showRipple=rippleRing&&age<rippleFrames;
      const rippleT=showRipple?age/rippleFrames:0;
      const rippleEase=1-Math.pow(1-rippleT,2.5);
      const rippleRadius=10+(rippleMaxRadius-10)*rippleEase;
      const ringOpacity=showRipple?Math.max(0,(1-rippleT)*(1-0.2*rippleT))*rippleOpacity:0;
      const rippleStroke=Math.max(0.8,3.2*(1-rippleT*0.7));
      // Only the most recently struck notehead breathes. Older notes return to
      // their engraved state, so teaching mode has one pulse instead of a stack.
      if (pulseOnly && i !== lastActive) return null;
      return <g key={i}>{(event.notes??[event]).filter(n=>n.attack!==false&&!n.tieStop).map((n,j)=><g key={j}>
        {showRipple&&<>
          <ellipse cx={n.x} cy={n.y} rx={rippleRadius*1.15} ry={rippleRadius*0.85} fill="none" stroke={glowColor} strokeWidth={rippleStroke+2.5} opacity={ringOpacity*0.45} style={{filter:`blur(${2+glowStrength*2}px)`}}/>
          <ellipse cx={n.x} cy={n.y} rx={rippleRadius*1.15} ry={rippleRadius*0.85} fill="none" stroke={rippleColor??(glowStrength>0?glowColor:color)} strokeWidth={rippleStroke} opacity={ringOpacity*0.9} style={{filter:`drop-shadow(0 0 6px ${glowColor})`}}/>
        </>}
        {glowStrength>0&&strength>0&&<ellipse cx={n.x} cy={n.y} rx={15*pulseScale} ry={10*pulseScale} fill={glowColor} opacity={strength*.5} style={{filter:`blur(${Math.max(2,(4+glowStrength)*pulseScale)}px)`}}/>}
        <ellipse cx={n.x} cy={n.y} rx={(10+strength*3)*pulseScale} ry={(6+strength*2)*pulseScale} transform={`rotate(-18 ${n.x} ${n.y})`} fill={color} fillOpacity={strength*.25} stroke={glowStrength>0&&strength>.2?glowColor:color} strokeWidth={Math.max(.6,(1.5+strength)*pulseScale)} opacity={inactiveNoteOpacity+strength*(1-inactiveNoteOpacity)} style={{filter:`drop-shadow(0 0 ${Math.max(1,(2+strength*7)*pulseScale)}px ${glowStrength>0?glowColor:color})`}} />
      </g>)}</g>;
    })})()}
    {taperTrail ? (
      <>
        {glowStrength > 0 && visibleSegments.length > 0 && (
          <g style={{filter: `blur(${glowStrength * 2}px)`}}>
            {visibleSegments.map((seg, idx) => (
              <line
                key={idx}
                x1={seg.p1.x}
                y1={seg.p1.y}
                x2={seg.p2.x}
                y2={seg.p2.y}
                stroke={glowColor}
                strokeWidth={Math.max(0.6, (trailWidth + glowStrength * 3) * Math.pow(seg.t, 1.2))}
                opacity={0.65 * (0.05 + 0.95 * Math.pow(seg.t, 1.1))}
                strokeLinecap="round"
              />
            ))}
          </g>
        )}
        {visibleSegments.length > 0 && (
          <g style={{filter: `drop-shadow(0 0 5px ${glowColor})`}}>
            {visibleSegments.map((seg, idx) => (
              <line
                key={idx}
                x1={seg.p1.x}
                y1={seg.p1.y}
                x2={seg.p2.x}
                y2={seg.p2.y}
                stroke={glowStrength > 0 ? glowColor : color}
                strokeWidth={Math.max(0.3, trailWidth * Math.pow(seg.t, 1.2))}
                opacity={0.08 + 0.92 * Math.pow(seg.t, 1.1)}
                strokeLinecap="round"
              />
            ))}
          </g>
        )}
      </>
    ) : (
      <>{visibleTails.map((points,i)=><React.Fragment key={i}>
        {glowStrength>0&&<polyline points={points.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke={glowColor} strokeWidth={trailWidth+glowStrength*3} opacity={.65} style={{filter:`blur(${glowStrength*2}px)`}}/>}
        <polyline points={points.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke={glowStrength>0?glowColor:color} strokeWidth={trailWidth} strokeLinecap="round" style={{filter:`drop-shadow(0 0 5px ${glowColor})`}}/>
      </React.Fragment>)}</>
    )}
    {visibleHeads.map((head,i)=><g key={i}>
      {glowStrength>0&&<><circle cx={head.x} cy={head.y} r={10+glowStrength*7} fill={glowColor} opacity={.55} style={{filter:`blur(${6+glowStrength*3}px)`}}/><circle cx={head.x} cy={head.y} r={7+glowStrength} fill={glowColor} style={{filter:`drop-shadow(0 0 8px ${glowColor})`}}/></>}
      {starburst&&<path d={`M${head.x-19},${head.y} H${head.x+19} M${head.x},${head.y-19} V${head.y+19}`} stroke={coreColor} strokeWidth={1} opacity={.85} style={{filter:`drop-shadow(0 0 4px ${glowColor})`}}/>}
      <circle cx={head.x} cy={head.y} r={13} fill={color} opacity={.14}/><circle cx={head.x} cy={head.y} r={4.5} fill={coreColor} style={{filter:`drop-shadow(0 0 9px ${glowColor}) drop-shadow(0 0 3px ${glowColor})`}}/>
    </g>)}
  </svg>;
};
