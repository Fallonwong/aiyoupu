import React from 'react';
import {Composition,getInputProps,registerRoot} from 'remotion';
import {dimensions} from './animations/score/AiyoupuPresentation';
import {AiyoupuScoreScene,type AiyoupuScoreSceneProps} from './animations/score/AiyoupuScoreSceneV2';
type SongProps=AiyoupuScoreSceneProps & {width?:number;height?:number;presentation?:{cameraPath?:{cameraX:number;cameraY:number}[]}};
const Song:React.FC<SongProps>=(props)=><AiyoupuScoreScene {...props} timeline={{...props.timeline,cameraPath:props.presentation?.cameraPath??props.timeline.cameraPath}}/>;
const Root:React.FC=()=>{
  const input=getInputProps<SongProps>();
  if(!input.timeline||!input.scoreSrc)throw new Error('SONG_PROPS_REQUIRED: provide the checked song props; no demo fallback is allowed.');
  return <Composition id="Aiyoupu-Song" component={Song}
    durationInFrames={input.timeline.durationInFrames} fps={input.timeline.fps} width={input.width??dimensions(input.aspectRatio).width} height={input.height??dimensions(input.aspectRatio).height}
    defaultProps={{...input}}/>;
};
registerRoot(Root);
