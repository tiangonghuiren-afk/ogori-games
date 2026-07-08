/* ==========================================================================
   chinchiro.js — チンチロ
   ========================================================================== */

'use strict';

/** サイコロの個数 */
const CHINCHIRO_DICE_COUNT = 3;
/** サイコロが転がるアニメーションの時間(ミリ秒) */
const CHINCHIRO_ROLL_ANIMATION_MS = 900;
/** アニメーション中の目の切り替え間隔(ミリ秒) */
const CHINCHIRO_ROLL_TICK_MS = 80;
/** 1人あたりの最大振り回数(目無しならこの回数まで振り直せる) */
const CHINCHIRO_MAX_ROLLS = 3;

/** 役の種類(強い順に並べておく。数値が小さいほど強い) */
const HAND_TYPE = {
  PINZORO: 0, // ピンゾロ (1,1,1)
  ZOROME: 1, // ゾロ目 (同じ目3つ、1,1,1以外)
  SHIGORO: 2, // シゴロ (4,5,6)
  NORMAL: 3, // 通常の目(2つ同じ+残り1つ)
  MENASHI: 4, // 目無し(役なし)
  HIFUMI: 5, // ヒフミ (1,2,3) ※目無しより弱い
};

const ChinchiroState = {
  players: [],
  currentPlayerIndex: 0,
  currentRollCount: 0, // 現在のプレイヤーがこれまで振った回数
  results: [], // { name, dice: [n,n,n], hand: {type, tiebreak, label} }
  isRolling: false,
  roundToken: 0,
};

/**
 * このラウンドがまだ有効か(画面離脱・別ラウンド開始で無効化されていないか)を返す。
 * @returns {boolean}
 */
function isChinchiroRoundActive() {
  return ChinchiroState.roundToken === getCurrentRoundToken();
}

/**
 * サイコロ3つの目から役を判定する。
 * @param {number[]} dice - 長さ3の配列(各1〜6)
 * @returns {{type: number, tiebreak: number, label: string}}
 */
function judgeChinchiroHand(dice) {
  const sortedDice = [...dice].sort((a, b) => a - b);
  const [a, b, c] = sortedDice;

  const isTripleSame = a === b && b === c;
  if (isTripleSame && a === 1) {
    return { type: HAND_TYPE.PINZORO, tiebreak: 0, label: 'ピンゾロ!!' };
  }
  if (isTripleSame) {
    return { type: HAND_TYPE.ZOROME, tiebreak: a, label: `ゾロ目(${a})` };
  }
  if (a === 4 && b === 5 && c === 6) {
    return { type: HAND_TYPE.SHIGORO, tiebreak: 0, label: 'シゴロ!' };
  }
  if (a === 1 && b === 2 && c === 3) {
    return { type: HAND_TYPE.HIFUMI, tiebreak: 0, label: 'ヒフミ…' };
  }

  // 2つ同じ + 残り1つ → 通常の目
  if (a === b) {
    return { type: HAND_TYPE.NORMAL, tiebreak: c, label: `${c}の目` };
  }
  if (b === c) {
    return { type: HAND_TYPE.NORMAL, tiebreak: a, label: `${a}の目` };
  }

  return { type: HAND_TYPE.MENASHI, tiebreak: 0, label: '目無し…' };
}

/**
 * 2つの役を比較する。
 * @returns {number} 負なら手1が強い、正なら手2が強い、0で同格
 */
function compareHandStrength(hand1, hand2) {
  if (hand1.type !== hand2.type) {
    return hand1.type - hand2.type; // typeが小さいほど強い
  }
  // 同じtype内では tiebreak が大きいほど強い(通常の目・ゾロ目)
  return hand2.tiebreak - hand1.tiebreak;
}

/**
 * 現在のプレイヤー名をターン表示に反映する。
 */
function renderChinchiroTurn() {
  const turnLabelEl = document.getElementById('chinchiro-turn-label');
  const currentName = ChinchiroState.players[ChinchiroState.currentPlayerIndex];
  turnLabelEl.textContent = `${currentName}さんの番`;
}

/**
 * サイコロの見た目(数字)を更新する。
 * @param {number[]} diceValues
 */
function renderDiceValues(diceValues) {
  for (let i = 0; i < CHINCHIRO_DICE_COUNT; i += 1) {
    const dieEl = document.getElementById(`chinchiro-die-${i}`);
    dieEl.textContent = String(diceValues[i]);
  }
}

/**
 * サイコロに転がりアニメーションのクラスを付け外しする。
 * @param {boolean} isRolling
 */
function setDiceRollingClass(isRolling) {
  for (let i = 0; i < CHINCHIRO_DICE_COUNT; i += 1) {
    const dieEl = document.getElementById(`chinchiro-die-${i}`);
    dieEl.classList.toggle('is-rolling', isRolling);
  }
}

/**
 * 結果一覧を再描画する。
 */
function renderChinchiroResultList() {
  const listEl = document.getElementById('chinchiro-result-list');
  listEl.innerHTML = '';

  ChinchiroState.results.forEach((result) => {
    const itemEl = document.createElement('li');
    itemEl.className = 'draw-result-item';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = `${result.name}(${result.dice.join(',')})`;
    const handSpan = document.createElement('span');
    handSpan.textContent = result.hand.label;
    itemEl.appendChild(nameSpan);
    itemEl.appendChild(handSpan);
    listEl.appendChild(itemEl);
  });
}

/**
 * 最下位(最弱の役)を集計する。同格が複数いれば全員返る。
 * @returns {{name: string, hand: object}[]}
 */
function findWeakestChinchiroResults() {
  let weakest = [ChinchiroState.results[0]];
  for (let i = 1; i < ChinchiroState.results.length; i += 1) {
    const current = ChinchiroState.results[i];
    const comparison = compareHandStrength(current.hand, weakest[0].hand);
    if (comparison > 0) {
      weakest = [current];
    } else if (comparison === 0) {
      weakest.push(current);
    }
  }
  return weakest;
}

/**
 * 全員振り終わったあとの判定処理。
 */
function finishChinchiroRound() {
  const weakestResults = findWeakestChinchiroResults();
  const statusEl = document.getElementById('chinchiro-status');

  if (weakestResults.length === 1) {
    statusEl.textContent = `${weakestResults[0].name}さんが最弱でした…`;
    setTimeout(() => {
      if (!isChinchiroRoundActive()) {
        return;
      }
      showResult(weakestResults[0].name);
    }, 900);
    return;
  }

  const tiedNames = weakestResults.map((r) => r.name);
  statusEl.textContent = `同格!${tiedNames.join('・')}さんで振り直し`;
  setTimeout(() => {
    if (!isChinchiroRoundActive()) {
      return;
    }
    // 振り直しは同じラウンド世代のまま継続する(トークンを引き継ぐ)
    startChinchiroRound(tiedNames, ChinchiroState.roundToken);
  }, 1200);
}

/**
 * サイコロを振るアニメーションを実行し、結果を確定する。
 */
function handleChinchiroRollClick() {
  SoundFx.unlock();
  if (ChinchiroState.isRolling) {
    return;
  }
  ChinchiroState.isRolling = true;
  const rollBtn = document.getElementById('chinchiro-roll-btn');
  rollBtn.disabled = true;
  setDiceRollingClass(true);

  const finalDice = [];
  for (let i = 0; i < CHINCHIRO_DICE_COUNT; i += 1) {
    finalDice.push(1 + Math.floor(Math.random() * 6));
  }

  const tickIntervalId = setInterval(() => {
    const randomDice = [];
    for (let i = 0; i < CHINCHIRO_DICE_COUNT; i += 1) {
      randomDice.push(1 + Math.floor(Math.random() * 6));
    }
    renderDiceValues(randomDice);
  }, CHINCHIRO_ROLL_TICK_MS);

  setTimeout(() => {
    clearInterval(tickIntervalId);

    if (!isChinchiroRoundActive()) {
      ChinchiroState.isRolling = false;
      setDiceRollingClass(false);
      return;
    }

    setDiceRollingClass(false);
    renderDiceValues(finalDice);
    // サイコロ着地音(3個が少しずつずれて鳴る)
    SoundFx.diceLand();

    ChinchiroState.currentRollCount += 1;

    const hand = judgeChinchiroHand(finalDice);
    const currentName = ChinchiroState.players[ChinchiroState.currentPlayerIndex];
    const statusEl = document.getElementById('chinchiro-status');

    // 目無しで、かつまだ振り直せる場合は確定させず同じプレイヤーで振り直す
    const canReroll = hand.type === HAND_TYPE.MENASHI
      && ChinchiroState.currentRollCount < CHINCHIRO_MAX_ROLLS;

    if (canReroll) {
      const remaining = CHINCHIRO_MAX_ROLLS - ChinchiroState.currentRollCount;
      statusEl.textContent = `${currentName}さん: ${hand.label} あと${remaining}回振れる`;
      setTimeout(() => {
        if (!isChinchiroRoundActive()) {
          ChinchiroState.isRolling = false;
          return;
        }
        renderDiceValues(['?', '?', '?']);
        ChinchiroState.isRolling = false;
        rollBtn.disabled = false;
      }, 900);
      return;
    }

    // ここに来たら確定(役が出た or 目無しでも3回目に達した)
    ChinchiroState.results.push({ name: currentName, dice: finalDice, hand });
    renderChinchiroResultList();
    statusEl.textContent = `${currentName}さん: ${hand.label}`;

    ChinchiroState.currentPlayerIndex += 1;
    ChinchiroState.currentRollCount = 0;

    setTimeout(() => {
      if (!isChinchiroRoundActive()) {
        ChinchiroState.isRolling = false;
        return;
      }
      if (ChinchiroState.currentPlayerIndex >= ChinchiroState.players.length) {
        ChinchiroState.isRolling = false;
        finishChinchiroRound();
        return;
      }
      renderChinchiroTurn();
      renderDiceValues(['?', '?', '?']);
      ChinchiroState.isRolling = false;
      rollBtn.disabled = false;
    }, 900);
  }, CHINCHIRO_ROLL_ANIMATION_MS);
}

/**
 * チンチロの1ラウンドを開始する(通常開始・振り直し共通)。
 * @param {string[]} players
 * @param {number} roundToken - このラウンドが属する世代トークン
 */
function startChinchiroRound(players, roundToken) {
  ChinchiroState.players = players;
  ChinchiroState.currentPlayerIndex = 0;
  ChinchiroState.currentRollCount = 0;
  ChinchiroState.results = [];
  ChinchiroState.isRolling = false;
  ChinchiroState.roundToken = roundToken;

  renderDiceValues(['?', '?', '?']);
  renderChinchiroResultList();
  renderChinchiroTurn();

  const statusEl = document.getElementById('chinchiro-status');
  statusEl.textContent = 'サイコロを振ろう!';

  const rollBtn = document.getElementById('chinchiro-roll-btn');
  rollBtn.disabled = false;
}

/**
 * チンチロゲームを最初から開始する(ゲーム選択・もう一回から呼ばれるエントリポイント)。
 * @param {string[]} players
 */
function startChinchiroGame(players) {
  startChinchiroRound(players, getCurrentRoundToken());
}

function initChinchiroEvents() {
  const rollBtn = document.getElementById('chinchiro-roll-btn');
  rollBtn.addEventListener('click', handleChinchiroRollClick);
}

document.addEventListener('DOMContentLoaded', () => {
  initChinchiroEvents();
  registerGame('chinchiro', { start: startChinchiroGame });
});
