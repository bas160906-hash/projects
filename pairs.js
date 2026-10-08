// Matching has its own progress; recognizing a pair never marks a flashcard known.
let pairSelection = { left: null, right: null, first: null };

function shufflePairs(values) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function newMatching(set) {
  return { pending: shufflePairs(set.words.map((_, i) => i)), retry: [], seen: [],
    left: [], right: [], solved: [], review: null, repeating: false, complete: false };
}
function matchingState(set) {
  const match = set.matching;
  const valid = match && ['pending', 'retry', 'seen', 'left', 'right', 'solved'].every(key =>
    Array.isArray(match[key]) && match[key].every(i => Number.isInteger(i) && i >= 0 && i < set.words.length));
  if (!valid) set.matching = newMatching(set);
  return set.matching;
}
function pairWordsConflict(a, b) {
  // Shared translations and shared synonyms cannot form an unambiguous round.
  return ['en', 'ru'].some(language => {
    const first = a[language], second = b[language];
    if (matchesAnswer(first, second) || matchesAnswer(second, first)) return true;
    // Also check overlap between alternative answers in both entries.
    const variants = first.split(/[;,]/).map(value => value.trim()).filter(Boolean);
    return variants.some(value => matchesAnswer(value, second));
  });
}
function nextPairRound(set, match) {
  pairSelection = { left: null, right: null, first: null };
  match.review = null;
  if (!match.pending.length && match.retry.length) {
    match.pending = shufflePairs([...new Set(match.retry)]);
    match.retry = [];
    match.repeating = true;
  }
  if (!match.pending.length) {
    match.complete = true;
    match.left = []; match.right = []; match.solved = [];
    return;
  }
  const chosen = [];
  const deferred = [];
  for (const index of match.pending) {
    if (chosen.length < 5 && !chosen.some(other => pairWordsConflict(set.words[index], set.words[other]))) chosen.push(index);
    else deferred.push(index);
  }
  match.pending = deferred;
  match.left = shufflePairs(chosen);
  match.right = shufflePairs(chosen);
  for (let attempt = 0; attempt < 16 && chosen.length > 1 && match.right.some((index, i) => index === match.left[i]); attempt++) {
    match.right = shufflePairs(chosen);
  }
  if (chosen.length > 1 && match.right.some((index, i) => index === match.left[i])) {
    const shift = 1 + Math.floor(Math.random() * (chosen.length - 1));
    match.right = [...match.left.slice(shift), ...match.left.slice(0, shift)];
  }
  match.solved = [];
  match.complete = false;
}
function renderPairs() {
  const set = activeSet();
  const match = set ? matchingState(set) : null;
  if (match && !match.left.length && !match.complete) nextPairRound(set, match);
  const finished = !match || match.complete;
  const total = set?.words.length || 0;
  const done = match?.seen.length || 0;
  $('#progress-count').textContent = `${done} / ${total}`;
  $('#progress-fill').style.width = `${total ? done / total * 100 : 0}%`;
  $('#progress-track').setAttribute('aria-label', 'Сопоставленные слова');
  $('#progress-track').setAttribute('aria-valuenow', done);
  $('#progress-track').setAttribute('aria-valuemax', total);
  $('#pairs-complete').classList.toggle('hidden', !finished);
  $('#pairs-complete-title').textContent = set ? 'Готово' : 'Добавь набор';
  $('#pairs-check').classList.toggle('hidden', !set);
  $('#pairs-reset').textContent = set ? 'Ещё раз' : 'Загрузить .md';
  $('#pairs-grid').classList.toggle('hidden', finished);
  $('#pairs-feedback').classList.toggle('hidden', !match?.review);
  $('#pairs-phase').textContent = !finished && match.repeating ? 'Повтор ошибок' : '';
  const grid = $('#pairs-grid');
  grid.replaceChildren();
  if (finished) return;
  const englishLeft = state.direction === 'en-ru';
  for (const side of ['left', 'right']) {
    const english = side === 'left' ? englishLeft : !englishLeft;
    const column = document.createElement('div');
    column.className = 'pairs-column';
    column.setAttribute('role', 'group');
    column.setAttribute('aria-label', english ? 'Английские слова' : 'Русские слова');
    const label = document.createElement('span'); label.className = 'pairs-language'; label.textContent = english ? 'EN' : 'RU';
    column.append(label);
    for (const index of match[side]) {
      const tile = document.createElement('button');
      tile.className = 'pair-tile'; tile.type = 'button'; tile.lang = english ? 'en' : 'ru';
      tile.textContent = set.words[index][english ? 'en' : 'ru'];
      tile.dataset.side = side; tile.dataset.index = index;
      const solved = match.solved.includes(index);
      tile.classList.toggle('pair-gone', solved);
      tile.classList.toggle('pair-selected', pairSelection[side] === index);
      tile.setAttribute('aria-pressed', String(pairSelection[side] === index));
      tile.disabled = solved || busy || !!match.review;
      if (solved) tile.setAttribute('aria-hidden', 'true');
      if (match.review && match.review[side] === index) tile.classList.add('pair-wrong');
      tile.addEventListener('click', () => selectPair(side, index));
      column.append(tile);
    }
    grid.append(column);
  }
  if (match.review) {
    const word = set.words[match.review.target];
    $('#pairs-correction').textContent = `${englishLeft ? word.en : word.ru} — ${englishLeft ? word.ru : word.en}`;
  }
}
async function selectPair(side, index) {
  const set = activeSet();
  if (state.mode !== 'pairs' || !set || busy || dialogOpen()) return;
  const match = matchingState(set);
  if (match.complete || match.review || match.solved.includes(index)) return;
  pairSelection[side] = pairSelection[side] === index ? null : index;
  if (pairSelection.left === null && pairSelection.right === null) pairSelection.first = null;
  else if (!pairSelection.first || pairSelection[pairSelection.first] === null) pairSelection.first = side;
  if (pairSelection.left === null || pairSelection.right === null) {
    renderPairs();
    // Recreated tiles retain a useful keyboard focus, including Space/Enter navigation.
    focusPair(side, index);
    return;
  }
  const { left, right, first } = pairSelection;
  if (left !== right) {
    const target = pairSelection[first];
    match.review = { left, right, target };
    for (const failed of [left, right]) if (!match.retry.includes(failed)) match.retry.push(failed);
    renderPairs(); save();
    $('#pairs-next').focus({ preventScroll: true });
    return;
  }
  busy = true; setLocked(true);
  const token = ++motionToken;
  renderPairs();
  const tiles = [...$('#pairs-grid').querySelectorAll(`.pair-tile[data-index="${index}"]`)];
  tiles.forEach(tile => tile.classList.add('pair-correct'));
  const animations = tiles.map(tile => tile.animate([
    { opacity: 1, transform: 'scale(1)' },
    { opacity: 1, transform: 'scale(1)', offset: .6 },
    { opacity: 0, transform: reducedMotion.matches ? 'none' : 'scale(.94)' }
  ], { duration: reducedMotion.matches ? 100 : 520, easing: 'ease-out', fill: 'forwards' }));
  try { await Promise.all(animations.map(animation => animation.finished)); } catch { return; }
  if (token !== motionToken) return;
  match.solved.push(index);
  if (!match.seen.includes(index)) match.seen.push(index);
  pairSelection = { left: null, right: null, first: null };
  if (match.solved.length === match.left.length) nextPairRound(set, match);
  busy = false; setLocked(false); render(); save();
  $('#pairs-grid').querySelector('.pair-tile:not(:disabled)')?.focus({ preventScroll: true });
}
function focusPair(side, index) {
  $('#pairs-grid').querySelector(`.pair-tile[data-side="${side}"][data-index="${index}"]`)?.focus({ preventScroll: true });
}
function resetPairs() {
  const set = activeSet();
  if (!set) return;
  set.matching = newMatching(set);
  pairSelection = { left: null, right: null, first: null };
  render(); save();
}
function switchMode(mode) {
  cancelInteraction();
  pairSelection = { left: null, right: null, first: null };
  state.mode = mode;
  render(); save();
}
$('#cards-mode').addEventListener('click', () => switchMode('cards'));
$('#pairs-mode').addEventListener('click', () => switchMode('pairs'));
$('#pairs-next').addEventListener('click', () => {
  const set = activeSet();
  if (!set || busy) return;
  matchingState(set).review = null;
  pairSelection = { left: null, right: null, first: null };
  render(); save();
  $('#pairs-grid').querySelector('.pair-tile:not(:disabled)')?.focus({ preventScroll: true });
});
$('#pairs-reset').addEventListener('click', () => activeSet() ? resetRound() : $('#import-dialog').showModal());
$('#pairs-check').addEventListener('click', () => {
  const set = activeSet();
  if (!set || busy) return;
  cancelInteraction();
  const sourceIds = set.sourceIds || [set.id];
  const words = set.words.map(word => ({ ...word, sourceSetId: word.sourceSetId || set.id }));
  // A separate session checks all words, including final pairs chosen by elimination.
  state.session = { ...freshSet('', words), sourceIds };
  state.session.queue = shufflePairs(state.session.queue);
  state.mode = 'cards'; state.typing = true;
  resetTypedAttempt(); render(); save();
  $('#typed-answer').focus({ preventScroll: true });
});
render();
save();
