/* ==========================================================================
   amidakuji.js — あみだくじ
   ========================================================================== */

'use strict';

/** 縦線の垂直方向の分割数(横線を配置できる高さレベルの数) */
const AMIDA_VERTICAL_LEVELS = 24;
/** 隣接する縦線間に生成する横線の最小本数 */
const AMIDA_MIN_RUNGS_PER_GAP = 2;
/** 隣接する縦線間に生成する横線の最大本数 */
const AMIDA_MAX_RUNGS_PER_GAP = 4;
/** キャンバスの余白(px) */
const AMIDA_PADDING = 20;
/** 線をたどるアニメーションの1レベルあたりの時間(ミリ秒。遅くしてハラハラ感を出す) */
const AMIDA_TRACE_STEP_MS = 170;
/** トレース完了から次の手番へ移るまでの間(ミリ秒) */
const AMIDA_TRACE_PLAYER_INTERVAL_MS = 700;
/** 選択フェーズで縦線の上端から見せる割合(残り中間はカバーで隠す。CSSカバーと一致させる) */
const AMIDA_STUB_TOP_RATIO = 0.2;
/** 選択フェーズで縦線の下端から見せる割合 */
const AMIDA_STUB_BOTTOM_RATIO = 0.2;

const AmidakujiState = {
  players: [],
  rungs: [], // { level, leftLineIndex } — leftLineIndex と leftLineIndex+1 を level の高さで結ぶ
  payerBottomIndex: -1,
  selections: [], // 上から順に選ばれたtopIndexの配列(playersと同じ並び)
  isRevealing: false, // reveal(タップでたどるモード)に入ったか
  isTracing: false, // 1人分のトレースアニメーション実行中か(二重実行防止)
  traceTurnIndex: 0, // タップでたどるモードの手番(0開始)
  payerName: null, // 爆弾に到達した支払者(トレース中に確定)
  completedTraces: [], // 各手番で描き終えた経路の折れ線(reveal後の再描画用)
  roundToken: 0,
};

/**
 * このラウンドがまだ有効か(画面離脱・別ラウンド開始で無効化されていないか)を返す。
 * @returns {boolean}
 */
function isAmidakujiRoundActive() {
  return AmidakujiState.roundToken === getCurrentRoundToken();
}

/**
 * 縦線間の各ギャップについて、重ならない高さレベルで横線をランダム生成する。
 * @param {number} lineCount - 縦線の本数(=参加者数)
 * @returns {{level: number, leftLineIndex: number}[]}
 */
function generateAmidaRungs(lineCount) {
  const gapCount = lineCount - 1;
  const usedLevelsByGap = [];
  for (let i = 0; i < gapCount; i += 1) {
    usedLevelsByGap.push(new Set());
  }

  const rungs = [];

  for (let gapIndex = 0; gapIndex < gapCount; gapIndex += 1) {
    const rungCountForGap = AMIDA_MIN_RUNGS_PER_GAP
      + Math.floor(Math.random() * (AMIDA_MAX_RUNGS_PER_GAP - AMIDA_MIN_RUNGS_PER_GAP + 1));

    let attempts = 0;
    let placed = 0;
    // レベル0とレベル(AMIDA_VERTICAL_LEVELS-1)は端すぎるので避け、間で生成する
    while (placed < rungCountForGap && attempts < rungCountForGap * 20) {
      attempts += 1;
      const level = 1 + Math.floor(Math.random() * (AMIDA_VERTICAL_LEVELS - 2));

      // 同じギャップ内で同じ高さ・隣接する高さの重なりを避ける(見た目の交差防止)
      const levelConflict = usedLevelsByGap[gapIndex].has(level)
        || usedLevelsByGap[gapIndex].has(level - 1)
        || usedLevelsByGap[gapIndex].has(level + 1);

      // 左右に隣接するギャップとも同じ高さで重ならないようにする(横線同士の交差防止)
      const leftGapConflict = gapIndex > 0 && usedLevelsByGap[gapIndex - 1].has(level);
      const rightGapConflict = gapIndex < gapCount - 1 && usedLevelsByGap[gapIndex + 1].has(level);

      if (levelConflict || leftGapConflict || rightGapConflict) {
        continue;
      }

      usedLevelsByGap[gapIndex].add(level);
      rungs.push({ level, leftLineIndex: gapIndex });
      placed += 1;
    }
  }

  return rungs;
}

/**
 * あみだくじを上から下までたどり、到達する下端インデックスを求める。
 * @param {number} startTopIndex
 * @param {{level: number, leftLineIndex: number}[]} rungs
 * @param {number} lineCount
 * @returns {number} 到達した下端の縦線インデックス
 */
function traceAmidaPath(startTopIndex, rungs, lineCount) {
  let currentLine = startTopIndex;
  const sortedRungs = [...rungs].sort((a, b) => a.level - b.level);

  sortedRungs.forEach((rung) => {
    if (rung.leftLineIndex === currentLine) {
      currentLine += 1;
    } else if (rung.leftLineIndex + 1 === currentLine) {
      currentLine -= 1;
    }
  });

  return Math.min(Math.max(currentLine, 0), lineCount - 1);
}

/**
 * あみだくじ(縦線と、必要に応じて横線)をcanvasに描画する。
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} lineCount
 * @param {{level: number, leftLineIndex: number}[]} rungs
 * @param {boolean} includeRungs - trueなら横線も描く(reveal後)。falseなら縦線のみ
 * @param {boolean} [stubsOnly=false] - trueなら縦線を上端/下端のスタブ部分だけ描く(選択フェーズ)
 */
function drawAmidaLadder(ctx, lineCount, rungs, includeRungs, stubsOnly) {
  const canvasWidth = ctx.canvas.width;
  const canvasHeight = ctx.canvas.height;
  const usableWidth = canvasWidth - AMIDA_PADDING * 2;
  const usableHeight = canvasHeight - AMIDA_PADDING * 2;
  const lineSpacing = usableWidth / (lineCount - 1);
  const levelSpacing = usableHeight / (AMIDA_VERTICAL_LEVELS - 1);

  const topY = AMIDA_PADDING;
  const bottomY = canvasHeight - AMIDA_PADDING;
  const lineHeight = bottomY - topY;
  const topStubEndY = topY + lineHeight * AMIDA_STUB_TOP_RATIO;
  const bottomStubStartY = bottomY - lineHeight * AMIDA_STUB_BOTTOM_RATIO;

  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.strokeStyle = '#5c56a0';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';

  // 縦線(stubsOnly時は上端・下端のスタブ部分のみ描き、中間は描かない)
  for (let i = 0; i < lineCount; i += 1) {
    const x = AMIDA_PADDING + lineSpacing * i;
    if (stubsOnly) {
      ctx.beginPath();
      ctx.moveTo(x, topY);
      ctx.lineTo(x, topStubEndY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, bottomStubStartY);
      ctx.lineTo(x, bottomY);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(x, topY);
      ctx.lineTo(x, bottomY);
      ctx.stroke();
    }
  }

  // 横線(reveal後のみ描画する。初期状態では隠しておく)
  if (includeRungs) {
    ctx.strokeStyle = '#37e6c5';
    rungs.forEach((rung) => {
      const y = AMIDA_PADDING + levelSpacing * rung.level;
      const x1 = AMIDA_PADDING + lineSpacing * rung.leftLineIndex;
      const x2 = AMIDA_PADDING + lineSpacing * (rung.leftLineIndex + 1);
      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.lineTo(x2, y);
      ctx.stroke();
    });
  }
}

/**
 * トレース経路(ハイライト用の折れ線座標)を計算する。
 * @param {number} startTopIndex
 * @param {{level: number, leftLineIndex: number}[]} rungs
 * @param {number} lineCount
 * @param {number} lineSpacing
 * @param {number} levelSpacing
 * @returns {{x: number, y: number}[]}
 */
function buildTracePoints(startTopIndex, rungs, lineCount, lineSpacing, levelSpacing) {
  const sortedRungs = [...rungs].sort((a, b) => a.level - b.level);
  let currentLine = startTopIndex;
  const points = [{ x: AMIDA_PADDING + lineSpacing * currentLine, y: AMIDA_PADDING }];

  sortedRungs.forEach((rung) => {
    const y = AMIDA_PADDING + levelSpacing * rung.level;
    if (rung.leftLineIndex === currentLine) {
      points.push({ x: AMIDA_PADDING + lineSpacing * currentLine, y });
      currentLine += 1;
      points.push({ x: AMIDA_PADDING + lineSpacing * currentLine, y });
    } else if (rung.leftLineIndex + 1 === currentLine) {
      points.push({ x: AMIDA_PADDING + lineSpacing * currentLine, y });
      currentLine -= 1;
      points.push({ x: AMIDA_PADDING + lineSpacing * currentLine, y });
    }
  });

  const canvasHeight = AMIDA_PADDING * 2 + levelSpacing * (AMIDA_VERTICAL_LEVELS - 1);
  points.push({ x: AMIDA_PADDING + lineSpacing * currentLine, y: canvasHeight - AMIDA_PADDING });
  return points;
}

/**
 * 上部の選択ボタンを生成する。
 */
function renderAmidaTopButtons() {
  const containerEl = document.getElementById('amidakuji-top-buttons');
  containerEl.innerHTML = '';

  AmidakujiState.players.forEach((name, topIndex) => {
    const btnEl = document.createElement('button');
    btnEl.type = 'button';
    btnEl.className = 'amida-top-btn';
    btnEl.textContent = '選ぶ';
    btnEl.dataset.topIndex = String(topIndex);
    btnEl.addEventListener('click', () => handleAmidaTopButtonClick(topIndex));
    containerEl.appendChild(btnEl);
  });
}

/**
 * 下部のラベルを初期化する。支払い位置には最初から💣、他はセーフ(✅)を見せる。
 * どの上の枠がその爆弾につながるかは横線しだいで分からない設計。
 */
function renderAmidaBottomLabels() {
  const containerEl = document.getElementById('amidakuji-bottom-labels');
  containerEl.innerHTML = '';

  for (let i = 0; i < AmidakujiState.players.length; i += 1) {
    const labelEl = document.createElement('span');
    labelEl.className = 'amida-bottom-label';
    const isPayerSlot = i === AmidakujiState.payerBottomIndex;
    labelEl.textContent = isPayerSlot ? '💣' : '✅';
    if (isPayerSlot) {
      labelEl.classList.add('is-bomb');
    }
    labelEl.id = `amida-bottom-${i}`;
    containerEl.appendChild(labelEl);
  }
}

/**
 * 全員選択済みかどうかを見て「結果を見る」ボタンの有効状態を更新する。
 */
function updateRevealButtonState() {
  const revealBtn = document.getElementById('amidakuji-reveal-btn');
  const allSelected = AmidakujiState.selections.length === AmidakujiState.players.length;
  revealBtn.disabled = !allSelected;
}

/**
 * 上部ボタンがタップされたときの処理。
 * 選択フェーズ(reveal前)なら「自分の枠を選ぶ」、
 * タップでたどるモード(reveal後)なら「自分の経路をたどる」に振り分ける。
 * @param {number} topIndex
 */
function handleAmidaTopButtonClick(topIndex) {
  if (AmidakujiState.isRevealing) {
    handleAmidaTraceButtonClick(topIndex);
    return;
  }
  handleAmidaSelectButtonClick(topIndex);
}

/**
 * 選択フェーズ: 自分の枠を選ぶ処理。
 * @param {number} topIndex
 */
function handleAmidaSelectButtonClick(topIndex) {
  const currentPlayerIndex = AmidakujiState.selections.length;
  if (currentPlayerIndex >= AmidakujiState.players.length) {
    return;
  }

  const containerEl = document.getElementById('amidakuji-top-buttons');
  const btnEl = containerEl.querySelector(`[data-top-index="${topIndex}"]`);
  if (!btnEl || btnEl.disabled) {
    return;
  }

  const currentName = AmidakujiState.players[currentPlayerIndex];
  btnEl.textContent = currentName;
  btnEl.disabled = true;
  btnEl.classList.add('is-selected');

  AmidakujiState.selections.push(topIndex);

  const statusEl = document.getElementById('amidakuji-status');
  if (AmidakujiState.selections.length < AmidakujiState.players.length) {
    const nextName = AmidakujiState.players[AmidakujiState.selections.length];
    statusEl.textContent = `${nextName}さんの番。枠を選んでね`;
  } else {
    statusEl.textContent = '全員選んだ!「結果を見る」を押そう';
  }

  updateRevealButtonState();
}

/**
 * 経路を線でハイライトしながらトレースするアニメーション(1人分)。
 * @param {number} topIndex
 * @returns {Promise<number>} 到達した下端インデックス
 */
function animateAmidaTrace(topIndex) {
  return new Promise((resolve) => {
    const canvas = document.getElementById('amidakuji-canvas');
    const ctx = canvas.getContext('2d');
    const lineCount = AmidakujiState.players.length;
    const usableWidth = canvas.width - AMIDA_PADDING * 2;
    const usableHeight = canvas.height - AMIDA_PADDING * 2;
    const lineSpacing = usableWidth / (lineCount - 1);
    const levelSpacing = usableHeight / (AMIDA_VERTICAL_LEVELS - 1);

    const tracePoints = buildTracePoints(topIndex, AmidakujiState.rungs, lineCount, lineSpacing, levelSpacing);

    let pointIndex = 1;

    function drawStep() {
      // 画面離脱・別ラウンド開始で無効化されていたらアニメーションを打ち切る
      if (!isAmidakujiRoundActive()) {
        resolve(null);
        return;
      }

      // 縦線全体+横線を描き、これまでに描き終えた経路も残す
      drawAmidaLadder(ctx, lineCount, AmidakujiState.rungs, true, false);
      drawCompletedTraces(ctx);

      // 現在たどっている経路(進行中)を上書き描画
      ctx.strokeStyle = '#ff4d8d';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(tracePoints[0].x, tracePoints[0].y);
      for (let i = 1; i <= pointIndex && i < tracePoints.length; i += 1) {
        ctx.lineTo(tracePoints[i].x, tracePoints[i].y);
      }
      ctx.stroke();

      if (pointIndex < tracePoints.length - 1) {
        pointIndex += 1;
        setTimeout(drawStep, AMIDA_TRACE_STEP_MS);
      } else {
        const bottomIndex = traceAmidaPath(topIndex, AmidakujiState.rungs, lineCount);
        // 描き終えた経路を記録し、以降の再描画で残す
        AmidakujiState.completedTraces.push(tracePoints);
        resolve(bottomIndex);
      }
    }

    drawStep();
  });
}

/**
 * これまでに描き終えた経路をすべて再描画する(手番が進んでも前の線を残すため)。
 * @param {CanvasRenderingContext2D} ctx
 */
function drawCompletedTraces(ctx) {
  ctx.strokeStyle = '#ffb0cd';
  ctx.lineWidth = 4;
  AmidakujiState.completedTraces.forEach((points) => {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
  });
}

/**
 * タップでたどるモードで、現在の手番の人の枠だけを有効化・強調してタップを促す。
 * 他のボタンは無効のままにする。
 */
function promptAmidaTraceTurn() {
  const containerEl = document.getElementById('amidakuji-top-buttons');
  const buttons = containerEl.querySelectorAll('.amida-top-btn');
  const activeTopIndex = AmidakujiState.selections[AmidakujiState.traceTurnIndex];

  buttons.forEach((btnEl) => {
    const topIndex = Number(btnEl.dataset.topIndex);
    const isActive = topIndex === activeTopIndex;
    btnEl.disabled = !isActive;
    btnEl.classList.toggle('is-trace-active', isActive);
  });

  const currentName = AmidakujiState.players[AmidakujiState.traceTurnIndex];
  const statusEl = document.getElementById('amidakuji-status');
  statusEl.textContent = `${currentName}さんの番: 自分の選んだ枠をタップ!`;
}

/**
 * タップでたどるモード用の全ボタン無効化(トレースアニメ実行中に使う)。
 */
function disableAllAmidaTopButtons() {
  const containerEl = document.getElementById('amidakuji-top-buttons');
  const buttons = containerEl.querySelectorAll('.amida-top-btn');
  buttons.forEach((btnEl) => {
    btnEl.disabled = true;
    btnEl.classList.remove('is-trace-active');
  });
}

/**
 * タップでたどるモードで、現在の手番の人の枠がタップされたときの処理。
 * その人の経路をトレースし、爆弾到達なら支払者記録、次の手番へ進める。
 * @param {number} topIndex
 */
async function handleAmidaTraceButtonClick(topIndex) {
  // トレースアニメ実行中は無視(二重実行防止)
  if (AmidakujiState.isTracing) {
    return;
  }
  // 現在の手番の人が選んだ枠以外は反応しない
  const activeTopIndex = AmidakujiState.selections[AmidakujiState.traceTurnIndex];
  if (topIndex !== activeTopIndex) {
    return;
  }

  AmidakujiState.isTracing = true;
  disableAllAmidaTopButtons();

  const playerName = AmidakujiState.players[AmidakujiState.traceTurnIndex];
  const statusEl = document.getElementById('amidakuji-status');
  statusEl.textContent = `${playerName}さんの経路をたどり中…`;
  SoundFx.amidaTrace();

  const bottomIndex = await animateAmidaTrace(topIndex);

  // 途中で画面離脱・別ラウンド開始されたら打ち切る
  if (bottomIndex === null || !isAmidakujiRoundActive()) {
    AmidakujiState.isTracing = false;
    return;
  }

  if (bottomIndex === AmidakujiState.payerBottomIndex) {
    AmidakujiState.payerName = playerName;
  }

  AmidakujiState.traceTurnIndex += 1;
  AmidakujiState.isTracing = false;

  // 全員たどり終えたら支払者を確定して結果画面へ
  if (AmidakujiState.traceTurnIndex >= AmidakujiState.selections.length) {
    if (AmidakujiState.payerName) {
      statusEl.textContent = `${AmidakujiState.payerName}さんが支払いを引きました…`;
    }
    setTimeout(() => {
      if (!isAmidakujiRoundActive()) {
        return;
      }
      showResult(AmidakujiState.payerName);
    }, 900);
    return;
  }

  // 次の手番へ(少し間を置いてから枠を有効化)
  setTimeout(() => {
    if (!isAmidakujiRoundActive()) {
      return;
    }
    promptAmidaTraceTurn();
  }, AMIDA_TRACE_PLAYER_INTERVAL_MS);
}

/**
 * 「結果を見る」ボタン押下時の処理。
 */
function handleAmidaRevealClick() {
  SoundFx.unlock();
  if (AmidakujiState.isRevealing) {
    return;
  }
  if (AmidakujiState.selections.length < AmidakujiState.players.length) {
    return;
  }
  AmidakujiState.isRevealing = true;

  const revealBtn = document.getElementById('amidakuji-reveal-btn');
  revealBtn.disabled = true;

  // reveal時に中間の覆いを外し、縦線全体+横線を出現させる
  const coverEl = document.getElementById('amidakuji-cover');
  coverEl.classList.add('is-hidden');
  const canvas = document.getElementById('amidakuji-canvas');
  const ctx = canvas.getContext('2d');
  drawAmidaLadder(ctx, AmidakujiState.players.length, AmidakujiState.rungs, true, false);

  // 自動トレースせず「タップでたどるモード」に入る。先頭の手番の枠を有効化・強調する
  AmidakujiState.traceTurnIndex = 0;
  promptAmidaTraceTurn();
}

/**
 * あみだくじゲームを開始する。
 * @param {string[]} players
 */
function startAmidakujiGame(players) {
  const lineCount = players.length;
  AmidakujiState.players = players;
  AmidakujiState.rungs = generateAmidaRungs(lineCount);
  AmidakujiState.payerBottomIndex = Math.floor(Math.random() * lineCount);
  AmidakujiState.selections = [];
  AmidakujiState.isRevealing = false;
  AmidakujiState.isTracing = false;
  AmidakujiState.traceTurnIndex = 0;
  AmidakujiState.payerName = null;
  AmidakujiState.completedTraces = [];
  AmidakujiState.roundToken = getCurrentRoundToken();

  const canvas = document.getElementById('amidakuji-canvas');
  const ctx = canvas.getContext('2d');
  // 選択フェーズは縦線の上端/下端スタブのみ描画し、中間は覆いで隠す
  drawAmidaLadder(ctx, lineCount, AmidakujiState.rungs, false, true);
  // 「もう一回」で戻ったときも中間が隠れた状態から始まるよう覆いを再表示する
  const coverEl = document.getElementById('amidakuji-cover');
  coverEl.classList.remove('is-hidden');

  renderAmidaTopButtons();
  renderAmidaBottomLabels();
  updateRevealButtonState();

  const statusEl = document.getElementById('amidakuji-status');
  const firstName = players[0];
  statusEl.textContent = `${firstName}さんの番。上の「選ぶ」から枠を選んでね`;
}

function initAmidakujiEvents() {
  const revealBtn = document.getElementById('amidakuji-reveal-btn');
  revealBtn.addEventListener('click', handleAmidaRevealClick);
}

document.addEventListener('DOMContentLoaded', () => {
  initAmidakujiEvents();
  registerGame('amidakuji', { start: startAmidakujiGame });
});
