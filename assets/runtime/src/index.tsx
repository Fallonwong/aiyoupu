import React from 'react';
import {Composition, registerRoot} from 'remotion';
import {AiyoupuScoreScene} from './animations/score/AiyoupuScoreScene';
import timelineData from '../public/score/demo/timeline.json';
import type {AiyoupuTimeline} from './animations/score/AiyoupuScoreScene';
const timeline = timelineData as AiyoupuTimeline;
export const Root: React.FC = () => <Composition
  id="Aiyoupu-Demo" component={AiyoupuScoreScene}
  durationInFrames={timeline.durationInFrames} fps={timeline.fps} width={1280} height={720}
  defaultProps={{timeline,scoreSrc:'score/demo/score.svg',title:'AI有谱',label:'TWO HANDS / GLOWING NOTES',subtitle:'Light between the notes.',overlay:{enabled:false}}}
  calculateMetadata={({props})=>({durationInFrames:props.timeline.durationInFrames,fps:props.timeline.fps})}
/>;
registerRoot(Root);
