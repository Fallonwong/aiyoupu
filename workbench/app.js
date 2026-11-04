/* AI有谱 direction console. The page only chooses a visual direction; all
 * preparation and review states live in the Agent, not this UI. */
let state = null;
let direction = null;
let player = null;
let currentFrame = 0;
let seeking = false;
let audioTickAt = 0;
let warnedAudio = false;
let validatedPropsSha256 = null;
let lastProps = null;
let validationRevision = 0;
let playerSignature = null;
let validateQueue = Promise.resolve();
let pendingValidate = null;

const $ = id => document.getElementById(id);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const formatTime = f => {
  const fps = state?.fps || 30;
  return `${String(Math.floor(f / fps / 60)).padStart(2, '0')}:${String(Math.floor(f / fps % 60)).padStart(2, '0')}`;
};
async function api(url, options = {}) {
  const response = await fetch(url, options);
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw Error(data.message || data.next || `请求失败 ${response.status}`);
  return data;
}
function showNotice(text, title = '预览不可用') {
  $('noticeTitle').textContent = title;
  $('noticeText').textContent = String(text || '请检查预览包。');
  $('notice').hidden = false;
}
/** Preset incompatibility is advisory. It is cleared as soon as another preset
 * is selected so a stale modal cannot make a valid direction look broken. */
function selectPresetOrExplain(id) {
  hideNotice();
  setPreset(id);
}
function hideNotice() { $('notice').hidden = true; }
function multiSystem() {
  const ys = state?.timeline?.focusPath?.map(p => p.focusY) || [];
  return ys.length > 1 && ys.some(y => Math.abs(y - ys[0]) > 1e-6);
}
function message(text, kind = '') {
  const el = $('saveMessage');
  el.textContent = text;
  el.className = 'hint' + (kind ? ' ' + kind : '');
}
function setPreset(id) {
  if (!state || !direction) return;
  const p = state.presets.find(x => x.id === id);
  if (!p) return;
  hideNotice();
  if (id === 'TeachingLandscape') {
    const ys = state.timeline?.focusPath?.map(x => x.focusY) || [];
    if (!ys.length || ys.length !== state.durationInFrames) {
      message('教学预设需要完整的逐帧焦点路径。', 'error');
      showNotice('当前预览缺少完整的焦点路径，请回 Agent 重新准备预览包。', '教学预设暂时不能用');
      return;
    }
  }
  if (p.cameraMode === 'portrait-runway' && !state.pipelineAvailable) {
    message('跑道需要已核验的连续谱带；当前预览只有全页谱。', 'error');
    showNotice('跑道预设需要已核验的连续谱带。当前预览包没有连续谱带，请回 Agent 准备后再试。', '这个预设暂时不能用');
    return;
  }
  const bounds=state.timeline.systemBounds;
  const teachingDefaultScale = p.id === 'TeachingLandscape' && multiSystem()
    ?(bounds?.length?Math.min(2.4,Math.floor(858/(Math.max(...bounds.map(b=>b.bottom-b.top))+32)*20)/20):2.4):p.camera.scale;
  direction = {...p, presetId: id, motionFx: direction.motionFx ?? 'converge-arc', titleScale: id === 'TeachingLandscape' ? 1 : (direction.titleScale ?? 1), avatar: direction.avatar ?? {kind: 'none'}, camera: {...p.camera, scale: teachingDefaultScale, focusX: direction.camera?.focusX ?? 0, focusY: direction.camera?.focusY ?? 0}};
  if (id === 'TeachingLandscape') Object.assign(direction, {aspectRatio: '16:9', theme: 'pure-white', texture: 'black-multiply', typography: 'clean', cameraMode: 'landscape-classic', pipeline: 'full-score', motionFx: 'converge-arc', titleScale: 1});
  // The shared server normalizes the preset's exact camera and typography.
  // Reuse that result instead of sending a partially merged preset again.
  paint();
  validateAndRender();
}
function fillPresetButtons() {
  const box = $('presets');
  box.replaceChildren();
  for (const p of state.presets.filter(p => p.cameraMode !== 'portrait-runway')) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preset';
    button.dataset.preset = p.id;
    button.innerHTML = '';
    const label = document.createElement('span');
    label.textContent = (state.names?.[p.id] || p.id).replace(/^AI有谱 · /, '');
    const small = document.createElement('small');
    small.textContent = `${p.aspectRatio} · ${p.id}`;
    button.append(label, small);
    const unavailable = p.cameraMode === 'portrait-runway' && !state.pipelineAvailable;
    button.disabled = unavailable;
    button.classList.toggle('unavailable', unavailable);
    if (unavailable) button.title = '此预览包没有连续谱带，跑道预设不可用。';
    button.onclick = () => selectPresetOrExplain(p.id);
    box.appendChild(button);
  }
  const select = $('presetSelect');
  select.replaceChildren();
  for (const p of state.presets.filter(p => p.cameraMode !== 'portrait-runway')) {
    const option = new Option((state.names?.[p.id] || p.id).replace(/^AI有谱 · /, ''), p.id);
    option.disabled = p.cameraMode === 'portrait-runway' && !state.pipelineAvailable;
    select.add(option);
  }
  select.onchange = () => selectPresetOrExplain(select.value);
  for (const option of [...$('cameraMode').options]) {
    if (option.value === 'portrait-runway') option.remove();
  }
}
function paint() {
  if (!direction) return;
  document.querySelectorAll('.preset').forEach(b => b.classList.toggle('active', b.dataset.preset === direction.presetId));
  for (const k of ['aspectRatio', 'cameraMode', 'theme', 'texture', 'typography', 'motionFx']) if ($(k)) $(k).value = direction[k];
  $('presetSelect').value = direction.presetId;
  $('titleScale').value = direction.titleScale;
  $('titleScaleVal').textContent = `${Number(direction.titleScale).toFixed(2)}×`;
  const teaching = direction.presetId === 'TeachingLandscape';
  // Keep flat projection and teaching typography fixed; zoom and focal shift
  // are valid framing choices and remain adjustable.
  for (const id of ['aspectRatio', 'theme', 'texture', 'typography', 'cameraMode', 'motionFx', 'rotateX', 'rotateZ', 'titleScale']) $(id).disabled = teaching;
  $('motionFx').value = teaching ? 'converge-arc' : direction.motionFx;
  $('scale').disabled = false;
  for (const key of ['scale', 'rotateX', 'rotateZ', 'focusX', 'focusY']) {
    $(key).value = direction.camera[key];
    $(key + 'Val').textContent = key === 'scale' ? Number(direction.camera[key]).toFixed(2) : direction.camera[key];
  }
  for (const option of $('cameraMode').options) option.disabled = option.value === 'portrait-runway' && !state.pipelineAvailable;
  $('presetStatus').textContent = `${direction.aspectRatio} · ${direction.cameraMode} · ${direction.pipeline}`;
  const multi = multiSystem();
  $('compatHint').textContent = teaching ? `教学预设固定白纸与 14 帧合流跃动${multi ? '；多行谱按当前行缓冲换行' : ''}。缩放与焦点可调。` : direction.cameraMode === 'portrait-runway' ? '跑道需要连续谱带。' : direction.cameraMode === 'landscape-classic' ? '横屏全页跟谱。' : '竖屏动态聚焦。';
}
function changeCameraMode(value) {
  if (value === 'portrait-runway' && !state.pipelineAvailable) {
    message('跑道需要已核验的连续谱带。', 'error');
    paint();
    return;
  }
  direction.cameraMode = value;
  direction.aspectRatio = value === 'landscape-classic' ? '16:9' : '9:16';
  direction.pipeline = value === 'portrait-runway' ? 'score-strip' : 'full-score';
  paint();
  validateAndRender();
}
function fitPlayer() {
  if (!direction || !$('viewport')) return;
  const box = $('viewport');
  const aw = Math.max(120, box.clientWidth - 12), ah = Math.max(120, box.clientHeight - 12);
  const portrait = direction.aspectRatio === '9:16';
  const ratio = portrait ? 1920 / 1080 : 1080 / 1920;
  let w = aw, h = w * ratio;
  if (h > ah) { h = ah; w = h / ratio; }
  $('playerWrap').style.width = `${Math.floor(w)}px`;
  $('playerWrap').style.height = `${Math.floor(h)}px`;
}
function PlayerHost() {
  const [configuration, setConfiguration] = React.useState(null);
  const [remountKey, setRemountKey] = React.useState(0);
  React.useEffect(() => {
    // A stale Player instance can be playing from a previous page mount. The
    // direction console starts paused; the explicit Play button is the start.
    try { player?.pause(); } catch {}
    window.__setPlayerConfiguration = next => {
      if (next?.remount) setRemountKey(key => key + 1);
      setConfiguration(next);
    };
    window.__resumePlayerAt = (frame, shouldPlay) => {
      if (!player) return;
      try {
        player.seekTo(frame);
        if (!shouldPlay) { player.pause(); return; }
        const maybe = player.play();
        if (maybe?.catch) maybe.catch(() => {});
      } catch {}
    };
    if (window.__pendingPlayerConfiguration) {
      setConfiguration(window.__pendingPlayerConfiguration);
      window.__pendingPlayerConfiguration = null;
    }
    return () => { window.__setPlayerConfiguration = null; };
  }, []);
  if (!configuration) return null;
  return React.createElement(Remotion.Player, {
    key: remountKey,
    component: window.AiyoupuWorkbenchScene,
    inputProps: configuration.props,
    durationInFrames: configuration.durationInFrames,
    compositionWidth: configuration.width,
    compositionHeight: configuration.height,
    fps: configuration.fps,
    autoPlay: false,
    controls: false,
    acknowledgeRemotionLicense: true,
    style: {width: '100%', height: '100%'},
    ref: element => { if (element) { player = element; window.__playerRef = element; } },
  });
}
async function validateAndRender(propsOverride = null) {
  if (!state || !direction) return;
  const revision = ++validationRevision;
  const frame = player?.getCurrentFrame() ?? currentFrame;
  const playing = player?.isPlaying() ?? false;
  try {
    const result = propsOverride ? {props: propsOverride, propsSha256: null} : await api('/api/direction/validate', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({direction})});
    if (revision !== validationRevision) return;
    if (result.direction) direction = result.direction;
    lastProps = result.props;
    validatedPropsSha256 = result.propsSha256 ?? validatedPropsSha256;
    currentFrame = frame;
    $('title').textContent = state.title || 'AI有谱';
    $('meta').textContent = `${state.fps} fps · ${state.durationInFrames} 帧 · ${state.noteCount} 音`;
    $('seek').max = Math.max(0, state.durationInFrames - 1);
    $('empty').hidden = true;
    fitPlayer();
    const width = result.width ?? (direction.aspectRatio === '9:16' ? 1080 : 1920);
    const height = result.height ?? (direction.aspectRatio === '9:16' ? 1920 : 1080);
    const signature = `${width}x${height}:${state.durationInFrames}:${state.fps}`;
    const firstConfiguration = playerSignature === null;
    const resumePlaying = firstConfiguration ? false : playing;
    const config = {
      props: result.props,
      durationInFrames: state.durationInFrames,
      fps: state.fps,
      width,
      height,
      remount: signature !== playerSignature,
      keep: {frame, playing: resumePlaying},
    };
    playerSignature = signature;
    if (window.__setPlayerConfiguration) window.__setPlayerConfiguration(config); else window.__pendingPlayerConfiguration = config;
    setTimeout(() => {
      if (config.remount) { window.__resumePlayerAt?.(config.keep.frame, config.keep.playing); return; }
      if (player && config.keep.playing && !player.isPlaying()) {
        try { const maybe = player.play(); if (maybe?.catch) maybe.catch(() => {}); } catch {}
      }
    }, 120);
    if (firstConfiguration) {
      setTimeout(() => { try { player?.pause(); } catch {} }, 180);
    }
    message('方向参数有效，预览保留当前帧与播放状态。', 'ok');
  } catch (error) {
    if (revision !== validationRevision) return;
    message(error.message, 'error');
    showNotice(error.message);
  }
}
/** Coalesce slider input into one server check after the user pauses. A new
 * drag replaces a queued check and keeps canvas frame/playing state intact. */
function scheduleValidate() {
  clearTimeout(pendingValidate);
  pendingValidate = setTimeout(() => {
    pendingValidate = null;
    validateQueue = validateQueue.then(() => validateAndRender()).catch(() => {});
  }, 140);
}
function wire() {
  $('play').onclick = () => {
    // A user gesture is the right moment to retry an audio element that the
    // browser paused. Do not raise the playback warning while merely dragging
    // the timeline or while the player is paused.
    try { const maybe = player?.play(); if (maybe?.catch) maybe.catch(() => {}); } catch {}
    const music = [...document.querySelectorAll('#player audio')]
      .filter(a => a.isConnected && !String(a.currentSrc || a.src).startsWith('data:audio/'))[0];
    if (music?.paused) {
      try { const maybe = music.play(); if (maybe?.catch) maybe.catch(() => {}); } catch {}
    }
  };
  $('pause').onclick = () => player?.pause();
  $('seek').onpointerdown = () => { seeking = true; };
  $('seek').onpointerup = () => { seeking = false; };
  $('seek').oninput = () => { currentFrame = Number($('seek').value); player?.seekTo(currentFrame); };
  for (const key of ['scale', 'rotateX', 'rotateZ', 'focusX', 'focusY']) {
    $(key).oninput = () => { direction.camera[key] = Number($(key).value); $(key + 'Val').textContent = key === 'scale' ? Number($(key).value).toFixed(2) : $(key).value; scheduleValidate(); };
  }
  $('titleScale').oninput = () => { direction.titleScale = Number($('titleScale').value); $('titleScaleVal').textContent = `${direction.titleScale.toFixed(2)}×`; scheduleValidate(); };
  for (const id of ['theme', 'texture', 'typography', 'motionFx']) {
    $(id).onchange = () => { direction[id] = $(id).value; paint(); validateAndRender(); };
  }
  $('aspectRatio').onchange = () => changeCameraMode($('aspectRatio').value === '16:9' ? 'landscape-classic' : 'portrait-focus');
  $('cameraMode').onchange = () => changeCameraMode($('cameraMode').value);
  $('save').onclick = async () => {
    $('save').disabled = true;
    message('正在保存方向…');
    try {
      const result = await api('/api/direction/save', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({direction})});
      $('prompt').hidden = false;
      $('prompt').value = result.prompt;
      $('copy').hidden = false;
      message(`已保存 ${result.id}。回 Agent 发送上方短提示词；关键帧和成片尚未审批。`, 'ok');
      try { await navigator.clipboard.writeText(result.prompt); } catch {}
    } catch (error) { message(error.message, 'error'); }
    finally { $('save').disabled = false; }
  };
  $('copy').onclick = async () => { try { await navigator.clipboard.writeText($('prompt').value); message('提示词已复制。', 'ok'); } catch { message('浏览器拒绝写入剪贴板，请手动选择提示词。', 'error'); } };
  $('noticeClose').onclick = hideNotice;
  $('notice').onclick = event => { if (event.target === $('notice')) hideNotice(); };
}
function statusAudio() {
  const element = $('audioState');
  if (!state.audioSrc) {
    element.textContent = '静音预览：无音轨';
    element.className = 'audioState';
    return;
  }
  const audios = [...document.querySelectorAll('#player audio')];
  // A replaced Player can leave an old detached node in the DOM. Only
  // mounted, current source elements count for the status badge.
  const current = audios.filter(a => a.isConnected && (a.currentSrc || a.src));
  if (!current.length) { element.textContent = '音频：加载中…'; element.className = 'audioState'; return; }
  // Remotion also mounts silent placeholder tracks. Only the real preview
  // source is a music player; do not let a decoder placeholder update the badge.
  const music = current.filter(a => !String(a.currentSrc || a.src).startsWith('data:audio/'));
  if (!music.length) { element.textContent = '音频：加载中…'; element.className = 'audioState'; return; }
  const active = music.find(a => !a.paused && !a.ended);
  if (active) { element.textContent = `音频：播放中 ${active.currentTime.toFixed(1)}s`; element.className = 'audioState ok'; warnedAudio = false; return; }
  const ready = music.some(a => a.readyState >= 2);
  element.textContent = ready ? '音频：已暂停' : '音频：加载中…'; element.className = 'audioState' + (ready ? ' warn' : '');
  if (ready && player?.isPlaying() && !warnedAudio) { warnedAudio = true; showNotice('画面在播放，但浏览器暂停了音频。点击播放即可恢复。', '音频被暂停'); }
}
function tick() {
  const now = performance.now();
  try {
    const frame = player?.getCurrentFrame() ?? currentFrame;
    currentFrame = frame;
    const timeText = formatTime(frame), frameText = `${frame} / ${Math.max(0, (state?.durationInFrames || 1) - 1)}`;
    if ($('time').textContent !== timeText) $('time').textContent = timeText;
    if ($('frame').textContent !== frameText) $('frame').textContent = frameText;
    if (!seeking && $('seek').value !== String(frame)) $('seek').value = frame;
  } catch {}
  if (now - audioTickAt >= 250) { audioTickAt = now; statusAudio(); }
  requestAnimationFrame(tick);
}
async function boot() {
  try {
    state = await api('/api/state');
    $('title').textContent = state.title;
    $('meta').textContent = `${state.fps} fps · ${state.durationInFrames} 帧 · ${state.noteCount} 音`;
    $('headerMeta').textContent = `${state.noteCount} 音 · ${state.eventCount} 事件`;
    $('seek').max = Math.max(0, state.durationInFrames - 1);
    fillPresetButtons();
    wire();
    ReactDOM.createRoot($('player')).render(React.createElement(PlayerHost));
    direction = structuredClone(state.direction);
    paint();
    await validateAndRender();
    new ResizeObserver(fitPlayer).observe($('viewport'));
    requestAnimationFrame(tick);
  } catch (error) {
    $('empty').innerHTML = `<div><b style="font-size:15px">预览包无法读取</b><div style="font-size:12px;margin-top:7px;color:#c6d2e4">${error.message}</div></div>`;
    showNotice(`${error.message}\n\n请回到 Agent 重新创建并检查预览包。`, '预览包不可用');
  }
}
boot();
