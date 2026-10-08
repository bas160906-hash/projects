const SAMPLE_WORDS = [
  { en: 'serendipity', ru: 'счастливая случайность', pronunciation: '/ˌser.ənˈdɪp.ə.ti/' },
  { en: 'resilient', ru: 'стойкий; умеющий восстанавливаться', pronunciation: '/rɪˈzɪl.i.ənt/' },
  { en: 'subtle', ru: 'тонкий; едва заметный', pronunciation: '/ˈsʌt.əl/' },
  { en: 'to wander', ru: 'бродить; блуждать', pronunciation: '/ˈwɒn.dər/' },
  { en: 'to cherish', ru: 'дорожить; беречь', pronunciation: '/ˈtʃer.ɪʃ/' },
  { en: 'overwhelmed', ru: 'подавленный; перегруженный', pronunciation: '/ˌəʊ.vəˈwelmd/' },
  { en: 'to stumble', ru: 'споткнуться; запнуться', pronunciation: '/ˈstʌm.bəl/' },
  { en: 'reluctant', ru: 'неохотный; сомневающийся', pronunciation: '/rɪˈlʌk.tənt/' },
  { en: 'to enhance', ru: 'улучшать; усиливать', pronunciation: '/ɪnˈhɑːns/' },
  { en: 'genuine', ru: 'подлинный; искренний', pronunciation: '/ˈdʒen.ju.ɪn/' },
  { en: 'to glance', ru: 'взглянуть; бросить взгляд', pronunciation: '/ɡlɑːns/' },
  { en: 'shelter', ru: 'убежище; укрытие', pronunciation: '/ˈʃel.tər/' },
  { en: 'to afford', ru: 'позволить себе; быть в состоянии', pronunciation: '/əˈfɔːd/' },
  { en: 'mild', ru: 'мягкий; умеренный', pronunciation: '/maɪld/' },
  { en: 'to figure out', ru: 'разобраться; понять', pronunciation: '/ˈfɪɡ.ər aʊt/' },
  { en: 'concern', ru: 'беспокойство; касаться', pronunciation: '/kənˈsɜːn/' },
  { en: 'to postpone', ru: 'откладывать; переносить', pronunciation: '/pəˈspəʊn/' },
  { en: 'awkward', ru: 'неловкий; неудобный', pronunciation: '/ˈɔː.kwəd/' },
  { en: 'to pursue', ru: 'стремиться; преследовать', pronunciation: '/pəˈsjuː/' },
  { en: 'eventually', ru: 'в конце концов; со временем', pronunciation: '/ɪˈven.tʃu.ə.li/' }
];

const STORAGE_KEY = 'wordloop-v1';
const $ = (selector) => document.querySelector(selector);
const cardElement = $('#flashcard');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let state = loadState();
let toastTimer;
let drag = null;
let busy = false;
let motionToken = 0;
let suppressClickUntil = 0;
let storageWarningShown = false;
let selectedIds = new Set();
let pendingDeleteId = null;
let typedAttempt = { key: null, phase: 'answer' };

function freshSet(name, words = SAMPLE_WORDS) {
  return { id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, name, words, known: [], queue: words.map((_, i) => i), current: 0, revealed: false };
}
function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(saved?.sets) && saved.sets.every(set => Array.isArray(set.words) && set.words.length)) {
      saved.sets.forEach(set => {
        set.known ||= [];
        set.queue ||= set.words.map((_, i) => i).filter(i => !set.known.includes(i));
        set.current = Math.min(set.current || 0, Math.max(0, set.queue.length - 1));
      });
      const session = saved.session && Array.isArray(saved.session.sourceIds) && saved.session.sourceIds.every(id => saved.sets.some(set => set.id === id)) ? saved.session : null;
      return { mode: saved.mode === 'pairs' ? 'pairs' : 'cards', sets: saved.sets, activeId: saved.activeId, session, typing: saved.typing === true, order: saved.order === 'random' ? 'random' : 'source', direction: saved.direction === 'ru-en' ? 'ru-en' : 'en-ru' };
    }
  } catch { /* Start with the demo when browser storage is unavailable. */ }
  const first = freshSet('Первый набор');
  return { mode: 'cards', sets: [first], activeId: first.id, typing: false, order: 'source', direction: 'en-ru' };
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch {
    if (!storageWarningShown) { storageWarningShown = true; toast('Браузер не сохранил изменения'); }
  }
}
function activeSet() { return state.session || state.sets.find(set => set.id === state.activeId) || state.sets[0]; }
function dialogOpen() { return $('#import-dialog').open || $('#sets-dialog').open || $('#delete-dialog').open; }
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 2600);
}
function render() {
  const set = activeSet();
  if (set && !state.session) state.activeId = set.id;
  const sources = state.session ? state.sets.filter(item => state.session.sourceIds.includes(item.id)) : (set ? [set] : []);
  $('#sets-title').textContent = sources.length > 1 ? `Наборы · ${sources.length}` : sources[0]?.name || 'Наборы';
  $('#direction-select').value = state.direction;
  const pairing = state.mode === 'pairs';
  $('#cards-mode').setAttribute('aria-pressed', String(!pairing));
  $('#pairs-mode').setAttribute('aria-pressed', String(pairing));
  $('#pairs-stage').classList.toggle('hidden', !pairing);
  $('.card-stage').classList.toggle('hidden', pairing);
  $('#typing-toggle').classList.toggle('hidden', pairing);
  $('#order-select').classList.toggle('hidden', pairing);
  if (pairing && typeof renderPairs === 'function') {
    $('.app').classList.remove('typing-mode');
    $('#card-actions').classList.add('hidden');
    $('#reset-button').disabled = !set;
    renderPairs();
    return;
  }
  $('#order-select').value = state.order;
  $('#progress-track').setAttribute('aria-label', 'Знакомые слова');
  const total = set?.words.length || 0;
  const done = set?.known.length || 0;
  $('#progress-count').textContent = `${done} / ${total}`;
  $('#progress-fill').style.width = `${total ? done / total * 100 : 0}%`;
  $('#progress-track').setAttribute('aria-valuenow', done);
  $('#progress-track').setAttribute('aria-valuemax', total);
  const finished = !set?.queue.length;
  $('.app').classList.toggle('typing-mode', state.typing);
  $('#typing-toggle').setAttribute('aria-pressed', String(state.typing));
  $('#typed-form').classList.toggle('hidden', !state.typing || finished);
  $('#typed-submit').classList.toggle('hidden', !state.typing || finished);
  cardElement.setAttribute('role', state.typing ? 'group' : 'button');
  cardElement.setAttribute('tabindex', state.typing ? '-1' : '0');
  $('#empty-title').textContent = set ? 'Готово' : 'Добавь набор';
  $('#empty-reset').textContent = set ? 'Ещё раз' : 'Загрузить .md';
  $('#reset-button').disabled = !set;
  $('#empty-state').classList.toggle('hidden', !finished);
  $('#card-actions').classList.toggle('hidden', finished || state.typing);
  cardElement.classList.toggle('hidden', finished);
  $('#next-card').classList.toggle('hidden', finished);
  $('.stack-back').classList.toggle('hidden', finished);
  if (finished) return;
  const card = set.words[set.queue[set.current]];
  const attemptKey = `${set.id}:${set.queue[set.current]}:${state.direction}`;
  if (typedAttempt.key !== attemptKey) resetTypedAttempt(attemptKey);
  const isEnglish = state.direction === 'en-ru';
  const question = isEnglish ? card.en : card.ru;
  $('#card-language').textContent = isEnglish ? 'EN' : 'RU';
  $('#word').textContent = question;
  $('#word').lang = isEnglish ? 'en' : 'ru';
  $('#word').classList.toggle('long', question.length > 22);
  $('#pronunciation').textContent = isEnglish ? (card.pronunciation || '') : '';
  $('#pronunciation').classList.toggle('hidden', !isEnglish || !card.pronunciation);
  $('#answer').textContent = isEnglish ? card.ru : card.en;
  $('#answer').lang = isEnglish ? 'ru' : 'en';
  const review = state.typing && typedAttempt.phase === 'review';
  const revealed = state.typing ? review : set.revealed;
  $('#answer-block').classList.toggle('revealed', revealed);
  $('#answer-block').setAttribute('aria-hidden', String(!revealed));
  $('#answer-feedback').classList.toggle('hidden', !review);
  $('#tap-hint').textContent = state.typing || revealed ? '' : 'Нажми, чтобы открыть';
  cardElement.setAttribute('aria-label', `${question}. ${state.typing ? 'Введи перевод' : revealed ? $('#answer').textContent : 'Открыть перевод'}`);
  if (state.typing) cardElement.removeAttribute('aria-pressed');
  else cardElement.setAttribute('aria-pressed', String(!!revealed));
  $('#typed-answer').placeholder = isEnglish ? 'Перевод на русский' : 'Перевод на английский';
  $('#typed-answer').lang = isEnglish ? 'ru' : 'en';
  $('#typed-answer').setAttribute('aria-invalid', String(review));
  if (review) $('#typed-answer').setAttribute('aria-describedby', 'answer-block');
  else $('#typed-answer').removeAttribute('aria-describedby');
  $('#typed-submit').textContent = review ? 'Дальше' : 'Проверить';
  if (review) $('#typed-submit').setAttribute('aria-describedby', 'answer-block');
  else $('#typed-submit').removeAttribute('aria-describedby');
  syncTypedControls();
  const nextIndex = set.queue.length > 1 ? set.queue[(set.current + 1) % set.queue.length] : set.queue[set.current];
  $('#next-word').textContent = isEnglish ? set.words[nextIndex].en : set.words[nextIndex].ru;
}
function reveal() {
  const set = activeSet();
  if (state.mode === 'pairs' || state.typing || busy || drag || dialogOpen() || !set?.queue.length) return;
  set.revealed = !set.revealed;
  render(); save();
}
function setLocked(locked) {
  for (const selector of ['#again-button', '#know-button', '#sets-button', '#direction-select', '#order-select', '#reset-button', '#import-button', '#typing-toggle', '#cards-mode', '#pairs-mode']) $(selector).disabled = locked;
  cardElement.setAttribute('aria-disabled', String(locked));
  syncTypedControls();
}
function setLight(x) {
  const intensity = Math.min(Math.abs(x) / 110, 1);
  const style = document.documentElement.style;
  style.setProperty('--positive', x > 0 ? intensity : 0);
  style.setProperty('--negative', x < 0 ? intensity : 0);
  style.setProperty('--travel', intensity);
}
function transformFor(x, y = 0) { return `translate3d(${x}px, ${y}px, 0) rotate(${x / 22}deg)`; }
function clearMotion() {
  cardElement.style.transform = '';
  cardElement.style.transition = '';
  setLight(0);
}
function cancelInteraction() {
  motionToken++;
  drag = null;
  for (const element of [cardElement, ...document.querySelectorAll('.pair-tile')]) {
    for (const animation of element.getAnimations()) animation.cancel();
  }
  busy = false;
  clearMotion();
  setLocked(false);
}
async function rate(known, from = { x: 0, y: 0 }) {
  const set = activeSet();
  if (state.mode === 'pairs' || busy || !set?.queue.length || dialogOpen()) return;
  if (state.typing && typedAttempt.phase !== (known ? 'correct' : 'review')) return;
  busy = true; drag = null; setLocked(true);
  const token = ++motionToken;
  const sign = known ? 1 : -1;
  setLight(sign * 110);
  const outgoing = cardElement.animate([
    { transform: transformFor(from.x, from.y), opacity: 1 },
    { transform: reducedMotion.matches ? 'none' : `translate3d(${sign * (innerWidth + 250)}px, 24px, 0) rotate(${sign * 18}deg)`, opacity: 0 }
  ], { duration: reducedMotion.matches ? 80 : 280, easing: 'cubic-bezier(.32,.02,.48,1)', fill: 'forwards' });
  try { await outgoing.finished; } catch { return; }
  if (token !== motionToken) return;
  const [index] = set.queue.splice(set.current, 1);
  if (known) { if (!set.known.includes(index)) set.known.push(index); }
  else set.queue.push(index);
  if (set.current >= set.queue.length) set.current = 0;
  set.revealed = false;
  resetTypedAttempt();
  render(); save();
  outgoing.cancel(); clearMotion();
  if (set.queue.length) {
    const incoming = cardElement.animate([
      { transform: reducedMotion.matches ? 'none' : 'translateY(8px) scale(.975)', opacity: .5 },
      { transform: 'none', opacity: 1 }
    ], { duration: reducedMotion.matches ? 60 : 180, easing: 'ease-out' });
    try { await incoming.finished; } catch { return; }
  }
  if (token !== motionToken) return;
  busy = false; setLocked(false);
  if (state.typing && set.queue.length && !dialogOpen()) $('#typed-answer').focus({ preventScroll: true });
}
function resetTypedAttempt(key = null) {
  typedAttempt = { key, phase: 'answer' };
  $('#typed-answer').value = '';
}
function syncTypedControls() {
  const review = typedAttempt.phase === 'review';
  $('#typed-answer').readOnly = busy || review;
  $('#typed-submit').disabled = busy || (!review && !$('#typed-answer').value.trim());
}
function toggleTyping() {
  cancelInteraction();
  state.typing = !state.typing;
  resetTypedAttempt();
  if (activeSet()) activeSet().revealed = false;
  render(); save();
  if (state.typing && activeSet()?.queue.length) $('#typed-answer').focus({ preventScroll: true });
}
function normalizeAnswer(value) {
  return value.normalize('NFKC').toLowerCase().replace(/ё/g, 'е').replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ').trim().replace(/^[«»“”"]+|[«»“”".!?;:]+$/g, '').trim();
}
function matchesAnswer(value, expected) {
  const input = normalizeAnswer(value);
  if (!input) return false;
  const variants = [expected];
  let part = ''; let depth = 0;
  for (const char of expected) {
    if (char === '(' || char === '[') depth++;
    if (char === ')' || char === ']') depth = Math.max(0, depth - 1);
    if ((char === ';' || char === ',') && depth === 0) { variants.push(part); part = ''; }
    else part += char;
  }
  variants.push(part);
  return variants.some(variant => normalizeAnswer(variant) === input);
}
async function submitTypedAnswer() {
  const set = activeSet();
  if (!state.typing || busy || dialogOpen() || !set?.queue.length) return;
  if (typedAttempt.phase === 'review') return rate(false);
  if (typedAttempt.phase !== 'answer' || !$('#typed-answer').value.trim()) return;
  const word = set.words[set.queue[set.current]];
  const expected = state.direction === 'en-ru' ? word.ru : word.en;
  if (matchesAnswer($('#typed-answer').value, expected)) {
    typedAttempt.phase = 'correct';
    return rate(true);
  }
  typedAttempt.phase = 'review';
  render();
  $('#typed-submit').focus({ preventScroll: true });
}
$('#typing-toggle').addEventListener('click', toggleTyping);
$('#typed-answer').addEventListener('input', syncTypedControls);
$('#typed-form').addEventListener('submit', event => { event.preventDefault(); submitTypedAnswer(); });
// Enter while choosing an IME composition must not submit a partial answer.
$('#typed-answer').addEventListener('keydown', event => { if (event.key === 'Enter' && event.isComposing) event.preventDefault(); });

function orderQueue(queue) {
  const ordered = [...queue];
  if (state.order === 'random') {
    for (let i = ordered.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    }
  } else ordered.sort((a, b) => a - b);
  return ordered;
}
function changeOrder(order) {
  cancelInteraction();
  resetTypedAttempt();
  state.order = order === 'random' ? 'random' : 'source';
  const set = activeSet();
  if (set) {
    set.queue = orderQueue(set.queue);
    set.current = 0;
    set.revealed = false;
  }
  render(); save();
}
function resetRound() {
  cancelInteraction();
  resetTypedAttempt();
  const set = activeSet();
  if (!set) return;
  if (state.mode === 'pairs' && typeof resetPairs === 'function') { resetPairs(); return; }
  set.queue = orderQueue(set.words.map((_, i) => i));
  set.known = []; set.current = 0; set.revealed = false;
  render(); save();
}
function parseFile(text, filename = '') {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const md = /\.md|\.markdown/i.test(filename) || lines.some((line) => /^\|?\s*-{3,}/.test(line));
  const rows = [];
  for (const line of lines) {
    if (/^\s*(#|<!--)/.test(line) || /^\s*\|?\s*:?-{3,}/.test(line)) continue;
    let cells;
    if (md || line.includes('|')) {
      cells = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((part) => part.trim().replace(/^\*\*(.*)\*\*$/, '$1').replace(/^`(.*)`$/, '$1'));
    } else cells = splitDelimited(line, line.includes('\t') ? '\t' : line.includes(';') && !line.includes(',') ? ';' : ',');
    if (cells.length < 2) continue;
    const en = cells[0].trim(); const ru = cells[1].trim();
    if (!en || !ru || (/(english|англ)/i.test(en) && /(russian|рус)/i.test(ru)) || /^(слово|en)$/i.test(en) || /^(перевод|ru)$/i.test(ru)) continue;
    rows.push({ en, ru, pronunciation: cells[2] || '' });
  }
  const unique = []; const seen = new Set();
  for (const row of rows) { const key = `${row.en.toLowerCase()}\0${row.ru.toLowerCase()}`; if (!seen.has(key)) { seen.add(key); unique.push(row); } }
  return unique;
}
function splitDelimited(line, delimiter) {
  const result = []; let cell = ''; let quoted = false;
  for (let i = 0; i < line.length; i++) { const char = line[i]; if (char === '"' && line[i + 1] === '"' && quoted) { cell += '"'; i++; } else if (char === '"') quoted = !quoted; else if (char === delimiter && !quoted) { result.push(cell.trim()); cell = ''; } else cell += char; }
  result.push(cell.trim()); return result;
}
function importWords(words, filename = '') {
  if (!words.length) { toast('Не нашёл пары слов в таблице'); return; }
  cancelInteraction();
  const name = $('#import-name').value.trim() || filename.replace(/\.(csv|tsv|txt|md|markdown)$/i, '').replace(/[_-]+/g, ' ').trim() || `Набор ${state.sets.length + 1}`;
  const set = freshSet(name, words);
  set.queue = orderQueue(set.queue);
  state.sets.unshift(set); state.activeId = set.id; state.session = null;
  if (typeof pairSelection !== 'undefined') pairSelection = { left: null, right: null, first: null };
  render(); save();
  $('#import-dialog').close(); $('#file-input').value = ''; $('#paste-input').value = ''; $('#import-name').value = '';
}
async function importFile(file) {
  if (!file) return;
  try { importWords(parseFile(await file.text(), file.name), file.name); }
  catch { toast('Не удалось прочитать файл'); }
  finally { $('#file-input').value = ''; }
}

function openSets() {
  cancelInteraction();
  selectedIds = new Set(state.session?.sourceIds || (activeSet() ? [activeSet().id] : []));
  renderSets();
  $('#sets-dialog').showModal();
}
function updateSelection() {
  const count = state.sets.filter(set => selectedIds.has(set.id)).reduce((sum, set) => sum + set.words.length, 0);
  $('#selection-count').textContent = `${count} слов`;
  $('#start-training').disabled = count === 0;
}
function renameSet(id, name) {
  const set = state.sets.find(item => item.id === id);
  if (!set) return;
  if (name.trim()) set.name = name.trim().slice(0, 80);
  render(); save();
  return set.name;
}
function renderSets() {
  $('#sets-list').replaceChildren(...state.sets.map(set => {
    const row = document.createElement('div'); row.className = 'set-row';
    const check = document.createElement('input'); check.type = 'checkbox'; check.checked = selectedIds.has(set.id);
    check.setAttribute('aria-label', `Выбрать ${set.name}`);
    check.addEventListener('change', () => { if (check.checked) selectedIds.add(set.id); else selectedIds.delete(set.id); updateSelection(); });
    const fields = document.createElement('div'); fields.className = 'set-fields';
    const name = document.createElement('input'); name.type = 'text'; name.value = set.name; name.maxLength = 80; name.className = 'set-name-input';
    name.setAttribute('aria-label', `Название набора ${set.name}`);
    name.addEventListener('change', () => { name.value = renameSet(set.id, name.value); check.setAttribute('aria-label', `Выбрать ${name.value}`); });
    const count = document.createElement('span'); count.className = 'muted'; count.textContent = `${set.words.length} слов`;
    fields.append(name, count);
    const remove = document.createElement('button'); remove.className = 'icon-button delete-set'; remove.setAttribute('aria-label', `Удалить ${set.name}`);
    remove.textContent = '×';
    remove.addEventListener('click', () => { pendingDeleteId = set.id; $('#delete-name').textContent = set.name; $('#delete-dialog').showModal(); });
    row.append(check, fields, remove); return row;
  }));
  $('#no-sets').classList.toggle('hidden', state.sets.length > 0);
  updateSelection();
}
function startTraining(ids) {
  const sets = state.sets.filter(set => ids.includes(set.id));
  if (typeof pairSelection !== 'undefined') pairSelection = { left: null, right: null, first: null };
  if (!sets.length) return;
  cancelInteraction();
  if (sets.length === 1) {
    state.session = null; state.activeId = sets[0].id; resetRound();
  } else {
    const words = sets.flatMap(set => set.words.map(word => ({ ...word, sourceSetId: set.id })));
    state.session = { ...freshSet('', words), sourceIds: sets.map(set => set.id) };
    state.session.queue = orderQueue(state.session.queue);
    render(); save();
  }
  $('#sets-dialog').close();
}
function deleteSet(id) {
  cancelInteraction();
  resetTypedAttempt();
  state.sets = state.sets.filter(set => set.id !== id);
  selectedIds.delete(id);
  if (typeof pairSelection !== 'undefined') pairSelection = { left: null, right: null, first: null };
  if (state.session?.sourceIds.includes(id)) {
    const session = state.session;
    delete session.matching;
    const remap = new Map();
    const words = [];
    session.words.forEach((word, index) => { if (word.sourceSetId !== id) { remap.set(index, words.length); words.push(word); } });
    const queue = [...session.queue.slice(session.current), ...session.queue.slice(0, session.current)];
    session.words = words;
    session.queue = queue.filter(index => remap.has(index)).map(index => remap.get(index));
    session.known = session.known.filter(index => remap.has(index)).map(index => remap.get(index));
    session.sourceIds = session.sourceIds.filter(source => source !== id);
    session.current = 0; session.revealed = false;
    if (!words.length) state.session = null;
  }
  if (state.activeId === id) state.activeId = state.sets[0]?.id || null;
  render(); save(); renderSets();
}
$('#start-training').addEventListener('click', () => startTraining([...selectedIds]));
$('#cancel-delete').addEventListener('click', () => $('#delete-dialog').close());
$('#confirm-delete').addEventListener('click', () => { deleteSet(pendingDeleteId); pendingDeleteId = null; $('#delete-dialog').close(); });

cardElement.addEventListener('click', () => {
  if (performance.now() < suppressClickUntil) return;
  reveal();
});
cardElement.addEventListener('keydown', event => {
  if (state.typing) return;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault(); event.stopPropagation(); reveal();
  }
});
cardElement.addEventListener('pointerdown', event => {
  if (state.typing || busy || drag || !event.isPrimary || event.button !== 0 || !activeSet()?.queue.length) return;
  drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, x: 0, y: 0, moved: false };
  cardElement.style.transition = 'none';
  cardElement.setPointerCapture(event.pointerId);
});
cardElement.addEventListener('pointermove', event => {
  if (!drag || event.pointerId !== drag.id) return;
  drag.x = event.clientX - drag.startX;
  drag.y = (event.clientY - drag.startY) * .16;
  drag.moved ||= Math.abs(drag.x) > 7 || Math.abs(event.clientY - drag.startY) > 10;
  if (drag.moved) {
    cardElement.style.transform = transformFor(drag.x, drag.y);
    setLight(drag.x);
  }
});
function finishDrag(event, cancelled = false) {
  if (!drag || event.pointerId !== drag.id) return;
  const end = drag;
  drag = null;
  if (end.moved) suppressClickUntil = performance.now() + 450;
  if (cardElement.hasPointerCapture(event.pointerId)) cardElement.releasePointerCapture(event.pointerId);
  const threshold = Math.min(90, cardElement.clientWidth * .24);
  if (!cancelled && Math.abs(end.x) >= threshold) rate(end.x > 0, end);
  else {
    cardElement.style.transition = reducedMotion.matches ? 'none' : 'transform .25s cubic-bezier(.2,.8,.2,1)';
    cardElement.style.transform = 'none';
    setLight(0);
  }
}
cardElement.addEventListener('pointerup', event => finishDrag(event));
cardElement.addEventListener('pointercancel', event => finishDrag(event, true));
cardElement.addEventListener('lostpointercapture', event => finishDrag(event, true));
$('#again-button').addEventListener('click', () => rate(false));
$('#know-button').addEventListener('click', () => rate(true));
$('#reset-button').addEventListener('click', resetRound);
$('#empty-reset').addEventListener('click', () => activeSet() ? resetRound() : $('#import-dialog').showModal());
$('#direction-select').addEventListener('change', event => {
  cancelInteraction(); if (typeof pairSelection !== 'undefined') pairSelection = { left: null, right: null, first: null }; state.direction = event.target.value; if (activeSet()) activeSet().revealed = false; render(); save();
});
$('#order-select').addEventListener('change', event => changeOrder(event.target.value));
$('#sets-button').addEventListener('click', openSets);
$('#import-button').addEventListener('click', () => { cancelInteraction(); $('#import-dialog').showModal(); });
$('#dialog-file-button').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', event => importFile(event.target.files[0]));
$('#paste-import').addEventListener('click', () => importWords(parseFile($('#paste-input').value)));
const dropZone = $('#drop-zone');
for (const type of ['dragenter', 'dragover']) dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.add('dragging'); });
for (const type of ['dragleave', 'drop']) dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.remove('dragging'); });
dropZone.addEventListener('drop', event => importFile(event.dataTransfer.files[0]));
document.addEventListener('keydown', event => {
  if (state.mode === 'pairs' || state.typing || dialogOpen() || event.target.closest('textarea,select,input,button,summary') || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); rate(event.key === 'ArrowRight'); }
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); reveal(); }
});
window.addEventListener('storage', event => {
  if (event.key === STORAGE_KEY) { cancelInteraction(); resetTypedAttempt(); if (typeof pairSelection !== 'undefined') pairSelection = { left: null, right: null, first: null }; state = loadState(); render(); if ($('#sets-dialog').open) { selectedIds = new Set([...selectedIds].filter(id => state.sets.some(set => set.id === id))); renderSets(); } if ($('#delete-dialog').open) $('#delete-dialog').close(); }
});
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('./sw.js?v=6').catch(() => { /* Online use remains available. */ });
}
