import {SCORE_PRESETS as LEGACY_PRESETS, CONVERGE_ARC_MOTION_FX, type ScoreVideoConfig} from './ScoreVideoConfig';
export * from './ScoreVideoConfig';

/** Display labels only: factory keys and all historical values remain intact. */
export const PRESET_DISPLAY_NAMES = {
  SlateClassic:'AI有谱 · 经典石板灰', SapphireRunway:'AI有谱 · 深蓝纵深跑道',
  ObsidianFocus:'AI有谱 · 黑曜石动态聚焦', SapphireLandscape:'AI有谱 · 深蓝横屏跟谱',
  TeachingLandscape:'AI有谱 · 横屏平面教学',
} as const;
/** Multi-row teaching keeps the same flat white treatment with a wider view; a
 * single-system teaching score retains the historical 2.8x geometry. */
export const TEACHING_LANDSCAPE_SINGLE_SYSTEM_SCALE=2.8;
export const TEACHING_LANDSCAPE_MULTI_SYSTEM_SCALE=2.4;
export type TeachingLandscapeConfig = Omit<ScoreVideoConfig,'theme'> & {
  theme:'pure-white'; preset:'TeachingLandscape';
  /** Optional user override; defaults to 2.8 for one system and 2.4 for many. */
  cameraScale?:number;
};
export const SCORE_PRESETS = {
  ...LEGACY_PRESETS,
  TeachingLandscape:(title='曲目名',subtitle='AI有谱 · 教学'):TeachingLandscapeConfig=>({
    preset:'TeachingLandscape', aspectRatio:'16:9', cameraMode:'landscape-classic',
    theme:'pure-white', texture:'black-multiply', pipeline:'full-score', avatar:'none',
    motionFx:{...CONVERGE_ARC_MOTION_FX},
    typography:{style:'clean',showStatusBar:true,title,chineseTitle:title,subtitle},
  }),
};
