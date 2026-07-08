/* ==========================================================================
   app.js — 画面遷移・参加者管理・共通結果画面
   ========================================================================== */

'use strict';

/** 参加者の最小人数 */
const MIN_PLAYERS = 2;
/** 参加者の最大人数 */
const MAX_PLAYERS = 12;
/** 紙吹雪の枚数 */
const CONFETTI_COUNT = 40;
/** 紙吹雪の色パレット */
const CONFETTI_COLORS = ['#ff4d8d', '#ffc93c', '#37e6c5', '#7c5cff', '#ff8a3d'];

/**
 * アプリ全体の状態
 * players: 参加者名の配列
 * currentGame: 現在選択中のゲームID ('roulette' | 'high-low' | 'chinchiro' | 'amidakuji')
 * roundToken: ラウンド世代トークン。ゲーム開始・ゲーム画面からの離脱のたびに増え、
 *             古いラウンドの非同期処理(setTimeout / requestAnimationFrame)を無効化するために使う
 */
const AppState = {
  players: [],
  currentGame: null,
  roundToken: 0,
};

/**
 * 現在のラウンド世代トークンを返す。
 * 各ゲームはラウンド開始時にこの値を控え、非同期コールバック内で
 * この関数の戻り値と一致するか確認してから処理を続けること。
 * @returns {number}
 */
function getCurrentRoundToken() {
  return AppState.roundToken;
}

/**
 * 進行中のラウンドを無効化する(トークンをインクリメントする)。
 * ゲーム開始時と、ゲーム画面から離脱するときに呼ぶ。
 */
function invalidateCurrentRound() {
  AppState.roundToken += 1;
}

/** ゲームIDとゲームモジュールの対応表(各ゲームJSがロード時に登録する) */
const GameRegistry = {};

/**
 * ゲームモジュールを登録する。各ゲームのJSファイルから呼ばれる。
 * @param {string} gameId
 * @param {{ start: function(string[]): void }} moduleApi
 */
function registerGame(gameId, moduleApi) {
  GameRegistry[gameId] = moduleApi;
}

/* -------------------------------------------------------------------------
   画面遷移
   ------------------------------------------------------------------------- */

/**
 * 指定した画面IDだけを表示し、他を隠す。
 * @param {string} screenId - 'screen-xxx' のID
 */
function showScreen(screenId) {
  const screens = document.querySelectorAll('.screen');
  screens.forEach((screenEl) => {
    screenEl.classList.toggle('is-active', screenEl.id === screenId);
  });
}

/* -------------------------------------------------------------------------
   参加者管理(①参加者入力画面)
   ------------------------------------------------------------------------- */

/**
 * 参加者名の重複をチェックし、重複していれば「名前(2)」のように連番を付与する。
 * @param {string} rawName
 * @returns {string} 重複解消済みの名前
 */
function resolveDuplicateName(rawName) {
  const existingNames = AppState.players;
  if (!existingNames.includes(rawName)) {
    return rawName;
  }
  let suffix = 2;
  let candidate = `${rawName}(${suffix})`;
  while (existingNames.includes(candidate)) {
    suffix += 1;
    candidate = `${rawName}(${suffix})`;
  }
  return candidate;
}

/**
 * 入力エラーメッセージを表示する。
 * @param {string} message - 空文字なら非表示扱い
 */
function setPlayerError(message) {
  const errorEl = document.getElementById('player-error');
  errorEl.textContent = message;
}

/**
 * 参加者を追加する。バリデーション込み。
 */
function addPlayer() {
  const inputEl = document.getElementById('player-name-input');
  const rawValue = inputEl.value.trim();

  setPlayerError('');

  if (rawValue === '') {
    setPlayerError('名前を入力してください');
    return;
  }
  if (AppState.players.length >= MAX_PLAYERS) {
    setPlayerError(`参加者は最大${MAX_PLAYERS}人までです`);
    return;
  }

  const resolvedName = resolveDuplicateName(rawValue);
  AppState.players.push(resolvedName);
  inputEl.value = '';
  inputEl.focus();
  renderPlayerList();
}

/**
 * 参加者を削除する。
 * @param {number} index
 */
function removePlayer(index) {
  AppState.players.splice(index, 1);
  renderPlayerList();
}

/**
 * 参加者リストのDOMを再描画し、人数表示・ボタン有効状態を更新する。
 */
function renderPlayerList() {
  const listEl = document.getElementById('player-list');
  listEl.innerHTML = '';

  AppState.players.forEach((name, index) => {
    const itemEl = document.createElement('li');
    itemEl.className = 'player-list-item';

    const nameEl = document.createElement('span');
    nameEl.className = 'player-list-item-name';
    nameEl.textContent = name;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'player-remove-btn';
    removeBtn.setAttribute('aria-label', `${name}を削除`);
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => removePlayer(index));

    itemEl.appendChild(nameEl);
    itemEl.appendChild(removeBtn);
    listEl.appendChild(itemEl);
  });

  const countEl = document.getElementById('player-count');
  countEl.textContent = `${AppState.players.length}人 / ${MIN_PLAYERS}〜${MAX_PLAYERS}人`;

  const goToGamesBtn = document.getElementById('go-to-games-btn');
  goToGamesBtn.disabled = AppState.players.length < MIN_PLAYERS;
}

/* -------------------------------------------------------------------------
   ②ゲーム選択画面
   ------------------------------------------------------------------------- */

/**
 * ゲーム選択画面から特定のゲーム画面を開始する。
 * @param {string} gameId
 */
function startGame(gameId) {
  const gameModule = GameRegistry[gameId];
  if (!gameModule || typeof gameModule.start !== 'function') {
    setPlayerError('');
    // eslint-disable-next-line no-console
    console.error(`ゲームモジュールが見つかりません: ${gameId}`);
    return;
  }
  AppState.currentGame = gameId;
  invalidateCurrentRound();
  gameModule.start(AppState.players.slice());
}

/* -------------------------------------------------------------------------
   ④結果画面
   ------------------------------------------------------------------------- */

/**
 * 紙吹雪DOMを生成するアニメーション演出。
 */
function launchConfetti() {
  const confettiEl = document.getElementById('result-confetti');
  confettiEl.innerHTML = '';

  for (let i = 0; i < CONFETTI_COUNT; i += 1) {
    const pieceEl = document.createElement('div');
    pieceEl.className = 'confetti-piece';
    const leftPercent = Math.random() * 100;
    const delaySeconds = Math.random() * 0.6;
    const durationSeconds = 1.8 + Math.random() * 1.4;
    const color = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];

    pieceEl.style.left = `${leftPercent}%`;
    pieceEl.style.backgroundColor = color;
    pieceEl.style.animationDelay = `${delaySeconds}s`;
    pieceEl.style.animationDuration = `${durationSeconds}s`;

    confettiEl.appendChild(pieceEl);
  }
}

/**
 * 結果画面に遷移し、支払者名を表示する。
 * @param {string} payerName
 */
function showResult(payerName) {
  const payerNameEl = document.getElementById('result-payer-name');
  payerNameEl.textContent = payerName;
  showScreen('screen-result');
  launchConfetti();
}

/* -------------------------------------------------------------------------
   初期化・イベントバインド
   ------------------------------------------------------------------------- */

function initPlayerScreenEvents() {
  const formEl = document.getElementById('player-form');
  formEl.addEventListener('submit', (event) => {
    event.preventDefault();
    addPlayer();
  });

  const goToGamesBtn = document.getElementById('go-to-games-btn');
  goToGamesBtn.addEventListener('click', () => {
    if (AppState.players.length < MIN_PLAYERS) {
      return;
    }
    showScreen('screen-games');
  });
}

function initGameScreenEvents() {
  const gameCards = document.querySelectorAll('.game-card');
  gameCards.forEach((cardEl) => {
    cardEl.addEventListener('click', () => {
      const gameId = cardEl.dataset.game;
      showScreen(`screen-${gameId}`);
      startGame(gameId);
    });
  });

  const backToPlayersBtn = document.getElementById('back-to-players-btn');
  backToPlayersBtn.addEventListener('click', () => {
    showScreen('screen-players');
  });
}

function initGameBackButtons() {
  const backButtons = document.querySelectorAll('.back-to-games-btn');
  backButtons.forEach((btnEl) => {
    btnEl.addEventListener('click', () => {
      // 進行中のラウンドの非同期処理(タイマー等)を無効化してから戻る
      invalidateCurrentRound();
      showScreen('screen-games');
    });
  });
}

function initResultScreenEvents() {
  const replayBtn = document.getElementById('result-replay-btn');
  replayBtn.addEventListener('click', () => {
    if (!AppState.currentGame) {
      showScreen('screen-games');
      return;
    }
    showScreen(`screen-${AppState.currentGame}`);
    startGame(AppState.currentGame);
  });

  const backToGamesBtn = document.getElementById('result-back-to-games-btn');
  backToGamesBtn.addEventListener('click', () => {
    showScreen('screen-games');
  });
}

function initApp() {
  initPlayerScreenEvents();
  initGameScreenEvents();
  initGameBackButtons();
  initResultScreenEvents();
  renderPlayerList();
}

document.addEventListener('DOMContentLoaded', initApp);
