/* ==========================================================================
   high-low.js — ハイ&ロー / カード引き
   ========================================================================== */

'use strict';

/** トランプのスート */
const CARD_SUITS = ['♠', '♥', '♦', '♣'];
/** 赤色で表示するスート */
const CARD_RED_SUITS = ['♥', '♦'];
/** トランプのランク(表示順) */
const CARD_RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
/** カードが下から絞って開くアニメーション時間(ミリ秒。CSSの遷移時間と一致させる) */
const CARD_FLIP_ANIMATION_MS = 1200;

const HighLowState = {
  players: [],
  deck: [],
  currentPlayerIndex: 0,
  results: [], // { name, rank, suit, value }
  isAnimating: false,
  roundToken: 0,
};

/**
 * このラウンドがまだ有効か(画面離脱・別ラウンド開始で無効化されていないか)を返す。
 * @returns {boolean}
 */
function isHighLowRoundActive() {
  return HighLowState.roundToken === getCurrentRoundToken();
}

/**
 * ランク文字列から強さの数値を得る(2が最弱=2、Aが最強=14)。
 * @param {string} rank
 * @returns {number}
 */
function getRankValue(rank) {
  const rankIndex = CARD_RANKS.indexOf(rank);
  return rankIndex + 2; // '2' -> 2, ... 'A' -> 14
}

/**
 * 52枚のシャッフル済み山札を作る。
 * @returns {{rank: string, suit: string, value: number}[]}
 */
function createShuffledDeck() {
  const deck = [];
  CARD_SUITS.forEach((suit) => {
    CARD_RANKS.forEach((rank) => {
      deck.push({ rank, suit, value: getRankValue(rank) });
    });
  });

  // Fisher-Yatesシャッフル
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/**
 * 現在のプレイヤー名をターン表示に反映する。
 */
function renderHighLowTurn() {
  const turnLabelEl = document.getElementById('high-low-turn-label');
  const currentName = HighLowState.players[HighLowState.currentPlayerIndex];
  turnLabelEl.textContent = `${currentName}さんの番`;
}

/**
 * カードの表面テキスト(ランク+スート)をDOMへ反映する。
 * @param {{rank: string, suit: string}} card
 */
function renderCardFace(card) {
  const frontEl = document.getElementById('high-low-card-front');
  frontEl.textContent = `${card.rank}${card.suit}`;
  frontEl.classList.toggle('is-red', CARD_RED_SUITS.includes(card.suit));
}

/**
 * 引いた結果一覧を再描画する。
 */
function renderHighLowResultList() {
  const listEl = document.getElementById('high-low-result-list');
  listEl.innerHTML = '';

  HighLowState.results.forEach((result) => {
    const itemEl = document.createElement('li');
    itemEl.className = 'draw-result-item';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = result.name;
    const cardSpan = document.createElement('span');
    cardSpan.textContent = `${result.rank}${result.suit}`;
    itemEl.appendChild(nameSpan);
    itemEl.appendChild(cardSpan);
    listEl.appendChild(itemEl);
  });
}

/**
 * カードボタンをめくれる/めくれない状態に切り替える。
 * @param {boolean} isFlippable
 */
function setCardButtonFlippable(isFlippable) {
  const cardBtn = document.getElementById('high-low-card-btn');
  cardBtn.classList.toggle('is-disabled', !isFlippable);
}

/**
 * カードを裏向き状態にリセットする。
 */
function resetCardVisual() {
  const cardBtn = document.getElementById('high-low-card-btn');
  const frontEl = document.getElementById('high-low-card-front');
  // 次のプレイヤーへ切り替える際は、閉じるアニメーションを見せず即座に裏向きへ戻す
  frontEl.classList.add('no-transition');
  cardBtn.classList.remove('is-flipped');
  frontEl.textContent = '';
  // 強制リフローで即時反映してからトランジションを戻す
  void frontEl.offsetWidth;
  frontEl.classList.remove('no-transition');
}

/**
 * 最下位(最弱カード)を集計する。同点があれば複数返る。
 * @param {{name: string, value: number}[]} results
 * @returns {{name: string, value: number}[]}
 */
function findLowestResults(results) {
  const minValue = Math.min(...results.map((r) => r.value));
  return results.filter((r) => r.value === minValue);
}

/**
 * 全員がカードを引き終わったあとの判定処理。
 */
function finishHighLowRound() {
  const lowestResults = findLowestResults(HighLowState.results);

  if (lowestResults.length === 1) {
    const statusEl = document.getElementById('high-low-status');
    statusEl.textContent = `${lowestResults[0].name}さんが最弱でした…`;
    setTimeout(() => {
      if (!isHighLowRoundActive()) {
        return;
      }
      showResult(lowestResults[0].name);
    }, 900);
    return;
  }

  // 同点最下位 → 該当者のみで引き直し
  const tiedNames = lowestResults.map((r) => r.name);
  const statusEl = document.getElementById('high-low-status');
  statusEl.textContent = `同点!${tiedNames.join('・')}さんで引き直し`;

  setTimeout(() => {
    if (!isHighLowRoundActive()) {
      return;
    }
    // 引き直しは同じラウンド世代のまま継続する(トークンを引き継ぐ)
    startHighLowRound(tiedNames, HighLowState.roundToken);
  }, 1200);
}

/**
 * カードをめくる処理(1人分)。
 */
function handleHighLowCardClick() {
  SoundFx.unlock();
  if (HighLowState.isAnimating) {
    return;
  }
  // 全員めくり終わったあとの待ち時間中(結果遷移・引き直し前)の再タップを防ぐ
  if (HighLowState.currentPlayerIndex >= HighLowState.players.length) {
    return;
  }
  HighLowState.isAnimating = true;
  setCardButtonFlippable(false);

  const card = HighLowState.deck.pop();
  const currentName = HighLowState.players[HighLowState.currentPlayerIndex];

  renderCardFace(card);
  const cardBtn = document.getElementById('high-low-card-btn');
  // めくり開始(下から絞って開く)に合わせてスライド音を鳴らす
  SoundFx.cardSqueeze();
  cardBtn.classList.add('is-flipped');

  setTimeout(() => {
    if (!isHighLowRoundActive()) {
      HighLowState.isAnimating = false;
      return;
    }

    HighLowState.results.push({
      name: currentName,
      rank: card.rank,
      suit: card.suit,
      value: card.value,
    });
    renderHighLowResultList();

    HighLowState.currentPlayerIndex += 1;

    if (HighLowState.currentPlayerIndex >= HighLowState.players.length) {
      HighLowState.isAnimating = false;
      finishHighLowRound();
      return;
    }

    setTimeout(() => {
      if (!isHighLowRoundActive()) {
        HighLowState.isAnimating = false;
        return;
      }
      resetCardVisual();
      renderHighLowTurn();
      HighLowState.isAnimating = false;
      setCardButtonFlippable(true);
    }, 700);
  }, CARD_FLIP_ANIMATION_MS);
}

/**
 * ハイ&ローの1ラウンドを開始する(通常開始・引き直し共通)。
 * @param {string[]} players
 * @param {number} roundToken - このラウンドが属する世代トークン
 */
function startHighLowRound(players, roundToken) {
  HighLowState.players = players;
  HighLowState.deck = createShuffledDeck();
  HighLowState.currentPlayerIndex = 0;
  HighLowState.results = [];
  HighLowState.isAnimating = false;
  HighLowState.roundToken = roundToken;

  resetCardVisual();
  renderHighLowResultList();
  renderHighLowTurn();
  setCardButtonFlippable(true);

  const statusEl = document.getElementById('high-low-status');
  statusEl.textContent = 'カードをタップしてめくろう!';
}

/**
 * ハイ&ローゲームを最初から開始する(ゲーム選択・もう一回から呼ばれるエントリポイント)。
 * @param {string[]} players
 */
function startHighLowGame(players) {
  startHighLowRound(players, getCurrentRoundToken());
}

function initHighLowEvents() {
  const cardBtn = document.getElementById('high-low-card-btn');
  cardBtn.addEventListener('click', handleHighLowCardClick);
}

document.addEventListener('DOMContentLoaded', () => {
  initHighLowEvents();
  registerGame('high-low', { start: startHighLowGame });
});
