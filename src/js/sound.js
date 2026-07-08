/* ==========================================================================
   sound.js — 効果音(WebAudio合成)共通モジュール
   外部ファイル・外部通信・外部ライブラリなし。すべてWebAudio APIで合成する。
   AudioContext非対応/生成失敗でも例外で落ちず、無音で進行する。
   ========================================================================== */

'use strict';

/** マスター音量(控えめ) */
const SOUND_MASTER_GAIN = 0.2;
/** ルーレットのクリック音の長さ(秒) */
const SOUND_TICK_DURATION_S = 0.03;
/** カードスライド音の長さ(秒) */
const SOUND_CARD_DURATION_S = 0.4;
/** サイコロ1個分の着地音の長さ(秒) */
const SOUND_DICE_HIT_DURATION_S = 0.14;
/** サイコロ3個をずらして鳴らす間隔(秒) */
const SOUND_DICE_STAGGER_S = 0.1;
/** あみだくじのスライド音の長さ(秒) */
const SOUND_AMIDA_DURATION_S = 0.22;

/**
 * 効果音モジュール。単一のAudioContextを遅延生成で保持する。
 */
const SoundFx = (function createSoundFx() {
  /** @type {AudioContext|null} 遅延生成するAudioContext */
  let audioCtx = null;
  /** @type {GainNode|null} マスターゲイン */
  let masterGain = null;

  /**
   * AudioContextを生成・resumeする(初回ユーザータップ時に呼ぶ)。
   * 生成に失敗しても例外を投げず、audioCtxはnullのままにする。
   */
  function unlock() {
    try {
      if (!audioCtx) {
        const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtxClass) {
          return;
        }
        audioCtx = new AudioCtxClass();
        masterGain = audioCtx.createGain();
        masterGain.gain.value = SOUND_MASTER_GAIN;
        masterGain.connect(audioCtx.destination);
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
    } catch (err) {
      // 生成/resume失敗時は無音で続行する
      audioCtx = null;
      masterGain = null;
    }
  }

  /**
   * 再生準備が整っているか(unlock済みか)を返す。
   * @returns {boolean}
   */
  function isReady() {
    return audioCtx !== null && masterGain !== null;
  }

  /**
   * 短いホワイトノイズのバッファを生成する。
   * @param {number} durationS
   * @returns {AudioBuffer}
   */
  function createNoiseBuffer(durationS) {
    const sampleCount = Math.floor(audioCtx.sampleRate * durationS);
    const buffer = audioCtx.createBuffer(1, sampleCount, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  /**
   * ルーレットの1クリック音(短い打撃音)。
   */
  function rouletteTick() {
    if (!isReady()) {
      return;
    }
    try {
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      const freq = 1500 + Math.random() * 1000; // 1500〜2500Hz
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.9, now + 0.003);
      gain.gain.linearRampToValueAtTime(0.0001, now + SOUND_TICK_DURATION_S);

      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(now);
      osc.stop(now + SOUND_TICK_DURATION_S + 0.01);
    } catch (err) {
      // 無音で続行
    }
  }

  /**
   * カードをスライドさせる「シャカ」音(ノイズをバンドパスして上へスイープ)。
   */
  function cardSqueeze() {
    if (!isReady()) {
      return;
    }
    try {
      const now = audioCtx.currentTime;
      const noise = audioCtx.createBufferSource();
      noise.buffer = createNoiseBuffer(SOUND_CARD_DURATION_S);

      const bandpass = audioCtx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.Q.value = 1.2;
      bandpass.frequency.setValueAtTime(1000, now);
      bandpass.frequency.linearRampToValueAtTime(3000, now + SOUND_CARD_DURATION_S);

      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.5, now + SOUND_CARD_DURATION_S * 0.3);
      gain.gain.linearRampToValueAtTime(0.0001, now + SOUND_CARD_DURATION_S);

      noise.connect(bandpass);
      bandpass.connect(gain);
      gain.connect(masterGain);
      noise.start(now);
      noise.stop(now + SOUND_CARD_DURATION_S + 0.01);
    } catch (err) {
      // 無音で続行
    }
  }

  /**
   * サイコロ1個分の着地音(短いノイズの「カッ」+高めサインの金属的余韻)。
   * @param {number} startTime - AudioContext時間軸での再生開始時刻
   */
  function playSingleDiceHit(startTime) {
    // ノイズの「カッ」
    const noise = audioCtx.createBufferSource();
    noise.buffer = createNoiseBuffer(0.03);
    const noiseGain = audioCtx.createGain();
    noiseGain.gain.setValueAtTime(0.6, startTime);
    noiseGain.gain.linearRampToValueAtTime(0.0001, startTime + 0.03);
    noise.connect(noiseGain);
    noiseGain.connect(masterGain);
    noise.start(startTime);
    noise.stop(startTime + 0.04);

    // 高めサインの金属的余韻(ピッチをランダムに散らす)
    const osc = audioCtx.createOscillator();
    const oscGain = audioCtx.createGain();
    osc.type = 'sine';
    const freq = 2000 + Math.random() * 1500; // 2000〜3500Hz
    osc.frequency.setValueAtTime(freq, startTime);
    oscGain.gain.setValueAtTime(0.0001, startTime);
    oscGain.gain.linearRampToValueAtTime(0.5, startTime + 0.005);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, startTime + SOUND_DICE_HIT_DURATION_S);
    osc.connect(oscGain);
    oscGain.connect(masterGain);
    osc.start(startTime);
    osc.stop(startTime + SOUND_DICE_HIT_DURATION_S + 0.01);
  }

  /**
   * サイコロ3個がお椀に落ちる「チリンチリン」音(3個を少しずつずらして鳴らす)。
   */
  function diceLand() {
    if (!isReady()) {
      return;
    }
    try {
      const now = audioCtx.currentTime;
      for (let i = 0; i < 3; i += 1) {
        const jitter = Math.random() * 0.03;
        playSingleDiceHit(now + i * SOUND_DICE_STAGGER_S + jitter);
      }
    } catch (err) {
      // 無音で続行
    }
  }

  /**
   * あみだくじの経路をたどる「トゥルッ」音(周波数を短時間でスライド)。
   */
  function amidaTrace() {
    if (!isReady()) {
      return;
    }
    try {
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(300, now);
      osc.frequency.exponentialRampToValueAtTime(900, now + SOUND_AMIDA_DURATION_S);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.5, now + 0.02);
      gain.gain.linearRampToValueAtTime(0.0001, now + SOUND_AMIDA_DURATION_S);

      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(now);
      osc.stop(now + SOUND_AMIDA_DURATION_S + 0.01);
    } catch (err) {
      // 無音で続行
    }
  }

  return {
    unlock,
    rouletteTick,
    cardSqueeze,
    diceLand,
    amidaTrace,
  };
}());
