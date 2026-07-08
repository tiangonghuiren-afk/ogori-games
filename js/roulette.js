/* ==========================================================================
   roulette.js — 男気ルーレット
   ========================================================================== */

'use strict';

/** 最短の回転にかかる時間(ミリ秒) */
const ROULETTE_MIN_DURATION_MS = 3200;
/** 最長の回転にかかる時間(ミリ秒) */
const ROULETTE_MAX_DURATION_MS = 5000;
/** 演出のための最低回転数(周) */
const ROULETTE_MIN_SPINS = 4;
/** 演出のための追加回転数の振れ幅(周) */
const ROULETTE_EXTRA_SPINS_RANGE = 3;
/** セグメントの色パレット */
const ROULETTE_COLORS = ['#ff4d8d', '#ffc93c', '#37e6c5', '#7c5cff', '#ff8a3d', '#4dc0ff', '#ff6f6f', '#a3e635'];

const RouletteState = {
  players: [],
  isSpinning: false,
  rotationDeg: 0,
  roundToken: 0,
};

/**
 * このラウンドがまだ有効か(画面離脱・別ラウンド開始で無効化されていないか)を返す。
 * @returns {boolean}
 */
function isRouletteRoundActive() {
  return RouletteState.roundToken === getCurrentRoundToken();
}

/**
 * イージング関数(徐々に減速する)。
 * @param {number} t - 0〜1の進行度
 * @returns {number} 0〜1のイージング済み進行度
 */
function easeOutRoulette(t) {
  return 1 - Math.pow(1 - t, 4);
}

/**
 * ルーレットのセグメント(扇形)を描画する。
 * @param {CanvasRenderingContext2D} ctx
 * @param {string[]} players
 * @param {number} rotationDeg - 現在の回転角(度)
 */
function drawRouletteWheel(ctx, players, rotationDeg) {
  const canvasSize = ctx.canvas.width;
  const centerX = canvasSize / 2;
  const centerY = canvasSize / 2;
  const radius = canvasSize / 2 - 4;
  const segmentCount = players.length;
  const segmentAngle = (Math.PI * 2) / segmentCount;
  const rotationRad = (rotationDeg * Math.PI) / 180;

  ctx.clearRect(0, 0, canvasSize, canvasSize);

  for (let i = 0; i < segmentCount; i += 1) {
    const startAngle = i * segmentAngle + rotationRad;
    const endAngle = startAngle + segmentAngle;

    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = ROULETTE_COLORS[i % ROULETTE_COLORS.length];
    ctx.fill();
    ctx.strokeStyle = '#14121f';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 名前ラベル
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(startAngle + segmentAngle / 2);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#1a1a1a';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText(players[i], radius - 12, 0);
    ctx.restore();
  }

  // 中心の丸
  ctx.beginPath();
  ctx.arc(centerX, centerY, 18, 0, Math.PI * 2);
  ctx.fillStyle = '#14121f';
  ctx.fill();
}

/**
 * 指定したセグメントインデックスが、ポインター(上部/角度270度方向)に来るための
 * 最終回転角(度)を計算する。
 * @param {number} winningIndex
 * @param {number} segmentCount
 * @returns {number} 0〜360度の範囲での目標回転角(セグメント中心をポインターへ合わせる角度)
 */
function calcTargetRotationForSegment(winningIndex, segmentCount) {
  const segmentAngleDeg = 360 / segmentCount;
  // canvas描画は角度0を右方向(3時)からスタートし時計回り。
  // ポインターは真上(270度 = -90度)にあるため、
  // 「winningIndexのセグメント中心が270度に来る」ように必要な回転量を求める。
  const segmentCenterDeg = winningIndex * segmentAngleDeg + segmentAngleDeg / 2;
  const pointerDeg = 270;
  let rotationNeeded = pointerDeg - segmentCenterDeg;
  rotationNeeded = ((rotationNeeded % 360) + 360) % 360;
  return rotationNeeded;
}

/**
 * ルーレットを回すアニメーションを実行する。
 * @param {number} winningIndex - 事前に決めた当選インデックス
 */
function spinRouletteAnimation(winningIndex) {
  const canvas = document.getElementById('roulette-canvas');
  const ctx = canvas.getContext('2d');
  const spinBtn = document.getElementById('roulette-spin-btn');
  const statusEl = document.getElementById('roulette-status');

  const segmentCount = RouletteState.players.length;
  const baseTargetDeg = calcTargetRotationForSegment(winningIndex, segmentCount);
  const extraSpins = ROULETTE_MIN_SPINS + Math.floor(Math.random() * ROULETTE_EXTRA_SPINS_RANGE);
  const totalRotation = extraSpins * 360 + baseTargetDeg;
  const durationMs = ROULETTE_MIN_DURATION_MS + Math.random() * (ROULETTE_MAX_DURATION_MS - ROULETTE_MIN_DURATION_MS);

  const startRotation = RouletteState.rotationDeg;
  const startTime = performance.now();

  spinBtn.disabled = true;
  statusEl.textContent = '回転中…';

  function animateFrame(now) {
    // 画面離脱・別ラウンド開始で無効化されていたらアニメーションを打ち切る
    if (!isRouletteRoundActive()) {
      RouletteState.isSpinning = false;
      return;
    }

    const elapsed = now - startTime;
    const progress = Math.min(elapsed / durationMs, 1);
    const easedProgress = easeOutRoulette(progress);
    const currentRotation = startRotation + totalRotation * easedProgress;

    drawRouletteWheel(ctx, RouletteState.players, currentRotation);

    if (progress < 1) {
      requestAnimationFrame(animateFrame);
    } else {
      RouletteState.rotationDeg = (startRotation + totalRotation) % 360;
      RouletteState.isSpinning = false;
      const winnerName = RouletteState.players[winningIndex];
      statusEl.textContent = `${winnerName}さんに決定!`;
      setTimeout(() => {
        if (!isRouletteRoundActive()) {
          return;
        }
        showResult(winnerName);
      }, 900);
    }
  }

  requestAnimationFrame(animateFrame);
}

/**
 * 「回す」ボタン押下時の処理。
 */
function handleRouletteSpinClick() {
  if (RouletteState.isSpinning) {
    return;
  }
  RouletteState.isSpinning = true;
  const winningIndex = Math.floor(Math.random() * RouletteState.players.length);
  spinRouletteAnimation(winningIndex);
}

/**
 * ルーレットゲームを初期表示状態にする。
 * @param {string[]} players
 */
function startRouletteGame(players) {
  RouletteState.players = players;
  RouletteState.isSpinning = false;
  RouletteState.rotationDeg = 0;
  RouletteState.roundToken = getCurrentRoundToken();

  const canvas = document.getElementById('roulette-canvas');
  const ctx = canvas.getContext('2d');
  drawRouletteWheel(ctx, players, 0);

  const statusEl = document.getElementById('roulette-status');
  statusEl.textContent = '回してみよう!';

  const spinBtn = document.getElementById('roulette-spin-btn');
  spinBtn.disabled = false;
}

function initRouletteEvents() {
  const spinBtn = document.getElementById('roulette-spin-btn');
  spinBtn.addEventListener('click', handleRouletteSpinClick);
}

document.addEventListener('DOMContentLoaded', () => {
  initRouletteEvents();
  registerGame('roulette', { start: startRouletteGame });
});
