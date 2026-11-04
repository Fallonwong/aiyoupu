export type AspectRatio = '16:9' | '9:16';
export type ScoreTheme = 'slate' | 'parchment' | 'dark' | 'kraft' | 'pure-white' | 'custom' | 'slate-gray' | 'obsidian-dark' | 'deep-sapphire';
export const dimensions=(aspect?:AspectRatio)=>aspect==='9:16'?{width:1080,height:1920}:aspect==='16:9'?{width:1920,height:1080}:{width:1280,height:720};
export const depthPreset=(aspect:AspectRatio)=>aspect==='9:16'
  ?{targetScreenX:540,targetScreenY:960,scale:1.18,perspective:1000,tiltX:40,tiltZ:-7}
  :{targetScreenX:920,targetScreenY:570,scale:1.28,perspective:1350,tiltX:40,tiltZ:-10};
export const themePreset=(theme:ScoreTheme): {background:string;blend:'multiply'|'screen';filter:string;text:string}=>{
  if(theme==='slate-gray')return themePreset('slate');
  if(['obsidian-dark','deep-sapphire'].includes(theme))return {background:theme==='obsidian-dark'?'#05070e':'#030714',blend:'screen' as const,filter:'invert(0.95) contrast(1.2)',text:'#f3eaff'};
  const paper={slate:'#6b6561',parchment:'#ebdcc5',kraft:'#baa485','pure-white':'#f3f4f8'};
  if(theme in paper)return {background:paper[theme as keyof typeof paper],blend:'multiply' as const,filter:'none',text:theme==='slate'?'#fff6ee':'#302a27'};
  return {background:'#121018',blend:'screen' as const,filter:`invert(0.95) hue-rotate(190deg) brightness(1.25) contrast(${theme==='custom'?1.18:1.12})`,text:'#f3eaff'};
};
