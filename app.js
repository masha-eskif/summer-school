/* =========================================================================
   Лето с Машей — основная логика
   =========================================================================
   Загружает PROGRAM, SAILING, BONUSES из data.js.
   Состояние сохраняется в localStorage под ключом 'summer-school-state'.
   ========================================================================= */

const STORAGE_KEY = 'summer-school-state';
const DEFAULT_STATE = {
  startDate: PROGRAM.startDateISO,        // дата старта программы (понедельник)
  problemsPerDay: 3,                       // настраиваемое
  history: [],                             // [{date, dayKey, week, dayNum, subject, topic, grade, percent, bonusType, bonusText}]
  todayAnswers: {},                        // {dayKey: {idx: {value, correct}}}
  viewedDayKey: null                       // какой день показывать в табе «Сегодня»
};

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch (e) {
    return { ...DEFAULT_STATE };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* ============ Вычисление текущего дня программы ============ */

function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function todayDate() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function getProgramDay(date) {
  const start = parseISO(state.startDate);
  start.setHours(0, 0, 0, 0);
  const diff = Math.floor((date - start) / 86400000);
  if (diff < 0) return { beforeStart: true, daysUntil: -diff };

  const weekIdx = Math.floor(diff / 7);
  const dow = date.getDay(); // 0=вс ... 6=сб
  if (weekIdx >= PROGRAM.weeks.length) return { afterEnd: true };

  if (dow === 0 || dow === 6) {
    return { weekend: true, weekIdx };
  }

  // Понедельник=1 → dayNum=1; ... Пятница=5 → dayNum=5
  const dayNum = dow;
  return { weekIdx, dayNum, dayKey: `w${weekIdx + 1}d${dayNum}` };
}

function dayByKey(key) {
  const m = key.match(/^w(\d+)d(\d+)$/);
  if (!m) return null;
  const wIdx = Number(m[1]) - 1;
  const dNum = Number(m[2]);
  if (!PROGRAM.weeks[wIdx]) return null;
  return PROGRAM.weeks[wIdx].days.find(d => d.dayNum === dNum);
}

function getCurrentOrViewedDay() {
  if (state.viewedDayKey) {
    const d = dayByKey(state.viewedDayKey);
    if (d) return { key: state.viewedDayKey, day: d };
  }
  const info = getProgramDay(todayDate());
  if (info.dayKey) {
    const d = dayByKey(info.dayKey);
    if (d) return { key: info.dayKey, day: d };
  }
  // fallback — первый день
  return { key: 'w1d1', day: PROGRAM.weeks[0].days[0] };
}

/* ============ Микро-повторение (5 минут старого) ============ */

function getReviewProblems(currentKey) {
  // Берём по 1 задаче из 2-3 предыдущих дней (если есть)
  const m = currentKey.match(/^w(\d+)d(\d+)$/);
  const wIdx = Number(m[1]) - 1;
  const dNum = Number(m[2]);
  const linear = wIdx * 5 + (dNum - 1);
  const picks = [];
  for (let back = 1; back <= 3; back++) {
    const pos = linear - back;
    if (pos < 0) break;
    const pw = Math.floor(pos / 5);
    const pd = (pos % 5) + 1;
    const day = PROGRAM.weeks[pw]?.days.find(x => x.dayNum === pd);
    if (day && day.problems && day.problems.length > 0) {
      // Берём первую задачу
      picks.push({ fromTopic: day.topic, fromDate: `Неделя ${pw + 1}, день ${pd}`, problem: day.problems[0] });
    }
  }
  return picks;
}

/* ============ Парусный «факт дня» ============ */

function getSailingForDay(currentKey) {
  // Распределяем 4 категории на 12 недель: каждые 3 недели — новая категория
  const m = currentKey.match(/^w(\d+)d(\d+)$/);
  const wIdx = Number(m[1]) - 1;
  const dNum = Number(m[2]);
  const catIdx = Math.min(Math.floor(wIdx / 3), SAILING.categories.length - 1);
  const cat = SAILING.categories[catIdx];
  // Внутри 3 недель = 15 дней, у нас 5 уроков → каждый урок на 3 дня
  const lessonsCount = cat.lessons.length;
  const dayInCategory = (wIdx % 3) * 5 + (dNum - 1);
  const lessonIdx = Math.min(Math.floor(dayInCategory / Math.ceil(15 / lessonsCount)), lessonsCount - 1);
  return { category: cat, lesson: cat.lessons[lessonIdx] };
}

/* ============ Проверка ответов ============ */

function normalizeText(s) {
  return String(s).toLowerCase().trim().replace(/[\s.,!?;:()«»"']+/g, ' ').replace(/ё/g, 'е').trim();
}

function checkAnswer(problem, userValue) {
  if (problem.type === 'number') {
    const n = parseFloat(String(userValue).replace(',', '.'));
    if (isNaN(n)) return false;
    return Math.abs(n - problem.answer) <= (problem.tolerance ?? 0.001);
  }
  if (problem.type === 'text') {
    const u = normalizeText(userValue);
    return problem.accept.some(a => {
      const an = normalizeText(a);
      return u === an || u.includes(an) || an.includes(u);
    });
  }
  if (problem.type === 'choice') {
    return Number(userValue) === problem.correct;
  }
  return false;
}

function gradeFromPercent(percent) {
  if (percent >= 90) return 5;
  if (percent >= 70) return 4;
  if (percent >= 50) return 3;
  return 2;
}

/* ============ Рендер: вкладки ============ */

const TABS = ['today', 'sailing', 'diary', 'progress', 'settings'];
const TAB_LABELS = {
  today: '📚 Сегодня',
  sailing: '⛵ Парус',
  diary: '📓 Дневник',
  progress: '📈 Прогресс',
  settings: '⚙️ Настройки'
};

let currentTab = 'today';

function renderTabs() {
  const nav = document.getElementById('tabs');
  nav.innerHTML = TABS.map(t =>
    `<button data-tab="${t}" class="${t === currentTab ? 'active' : ''}">${TAB_LABELS[t]}</button>`
  ).join('');
  nav.querySelectorAll('button').forEach(b => {
    b.onclick = () => { currentTab = b.dataset.tab; render(); };
  });
}

function renderHeader() {
  const d = todayDate();
  const opts = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  const todayStr = d.toLocaleDateString('ru-RU', opts);

  const info = getProgramDay(d);
  let progressStr = '';
  if (info.beforeStart) progressStr = `Программа начнётся через ${info.daysUntil} дн.`;
  else if (info.afterEnd) progressStr = 'Программа завершена 🎉';
  else if (info.weekend) progressStr = `Выходной (неделя ${info.weekIdx + 1})`;
  else progressStr = `Неделя ${info.weekIdx + 1}, день ${info.dayNum} из 5`;

  document.getElementById('header-info').innerHTML = `
    <h1>⛵ Летнее обучение — Маша</h1>
    <div class="sub">${todayStr} · ${progressStr}</div>
  `;
}

/* ============ Вкладка «Сегодня» ============ */

function renderToday() {
  const { key, day } = getCurrentOrViewedDay();
  const m = key.match(/^w(\d+)d(\d+)$/);
  const wIdx = Number(m[1]) - 1;
  const dNum = Number(m[2]);
  const week = PROGRAM.weeks[wIdx];

  const review = getReviewProblems(key);
  const sailing = getSailingForDay(key);
  const subjectBadge = day.subject === 'physics' ? '⚡ Физика' : '📐 Математика';
  const subjectCls   = day.subject === 'physics' ? 'physics' : 'math';

  // Кнопки навигации между днями
  const linear = wIdx * 5 + (dNum - 1);
  const prevKey = linear > 0 ? `w${Math.floor((linear - 1) / 5) + 1}d${((linear - 1) % 5) + 1}` : null;
  const nextKey = linear < PROGRAM.weeks.length * 5 - 1 ? `w${Math.floor((linear + 1) / 5) + 1}d${((linear + 1) % 5) + 1}` : null;

  const problemsToShow = day.problems.slice(0, state.problemsPerDay);

  const html = `
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
        <div>
          <span class="badge">Неделя ${wIdx + 1}</span>
          <span class="badge">${day.weekday}, день ${dNum}</span>
          <span class="badge ${subjectCls}">${subjectBadge}</span>
        </div>
        <div>
          <button class="secondary" id="prev-day" ${prevKey ? '' : 'disabled'}>← Назад</button>
          <button class="secondary" id="next-day" ${nextKey ? '' : 'disabled'}>Вперёд →</button>
          <button class="secondary" id="goto-today">Сегодня</button>
        </div>
      </div>
      <h2 style="margin-top:0.8rem;">${day.topic}</h2>
      <div class="theory">${day.theory}</div>
      <div style="font-size:0.85rem; color:var(--muted); margin-top:0.4rem;">📖 ${day.reference || ''}</div>
      <a class="video-btn" href="${day.videoUrl}" target="_blank" rel="noopener">▶ Посмотреть видео по теме</a>
    </div>

    ${review.length > 0 ? `
    <div class="card">
      <h2>🔁 Микро-повторение (5 минут)</h2>
      <p style="color:var(--muted); margin:0 0 0.5rem;">Освежи в памяти, что было раньше:</p>
      ${review.map((r, i) => `
        <div class="problem" data-review-idx="${i}">
          <div class="q"><strong>${r.fromTopic}</strong> <span class="badge">${r.fromDate}</span></div>
          <div class="q">${r.problem.q}</div>
          ${renderProblemInput(r.problem, `review-${i}`)}
          <button class="secondary check-review-btn" data-idx="${i}">Проверить</button>
          <div class="feedback-area"></div>
        </div>
      `).join('')}
    </div>` : ''}

    <div class="card">
      <h2>⛵ Парус сегодня — ${sailing.category.icon} ${sailing.category.name}</h2>
      <h3>${sailing.lesson.title}</h3>
      <div class="theory">${sailing.lesson.theory}</div>
      <div class="physics-link">${sailing.lesson.physicsLink}</div>
      <br><a class="video-btn" href="${sailing.lesson.videoUrl}" target="_blank" rel="noopener">▶ Видео</a>
    </div>

    <div class="card">
      <h2>📝 Домашнее задание</h2>
      <p style="color:var(--muted); margin:0 0 0.5rem;">Заполни ответы и нажми «Проверить ДЗ» внизу.</p>
      ${problemsToShow.map((p, i) => `
        <div class="problem" data-prob-idx="${i}">
          <div class="q">№${i + 1}. ${p.q}</div>
          ${renderProblemInput(p, `prob-${i}`)}
          <div class="feedback-area"></div>
        </div>
      `).join('')}
      <button class="primary" id="check-all-btn">Проверить ДЗ</button>
      <div id="result-area"></div>
    </div>
  `;

  document.getElementById('view').innerHTML = html;

  // Навигация
  if (prevKey) document.getElementById('prev-day').onclick = () => { state.viewedDayKey = prevKey; saveState(); render(); };
  if (nextKey) document.getElementById('next-day').onclick = () => { state.viewedDayKey = nextKey; saveState(); render(); };
  document.getElementById('goto-today').onclick = () => { state.viewedDayKey = null; saveState(); render(); };

  // Проверка повторения
  document.querySelectorAll('.check-review-btn').forEach(btn => {
    btn.onclick = () => {
      const idx = Number(btn.dataset.idx);
      const r = review[idx];
      const value = getProblemValue(r.problem, `review-${idx}`);
      const ok = checkAnswer(r.problem, value);
      const parent = btn.closest('.problem');
      parent.classList.remove('correct', 'wrong');
      parent.classList.add(ok ? 'correct' : 'wrong');
      const fb = parent.querySelector('.feedback-area');
      fb.innerHTML = `<div class="feedback ${ok ? 'ok' : 'bad'}">${ok ? '✅ Верно!' : '❌ Ошибка'}${r.problem.hint && !ok ? ` <div class="hint">💡 ${r.problem.hint}</div>` : ''}</div>`;
    };
  });

  // Проверка всего ДЗ
  document.getElementById('check-all-btn').onclick = () => checkAllProblems(key, day, problemsToShow);
}

function renderProblemInput(p, idPrefix) {
  if (p.type === 'choice') {
    return `<div class="choices">${p.options.map((o, i) =>
      `<label><input type="radio" name="${idPrefix}" value="${i}"> ${o}</label>`
    ).join('')}</div>`;
  }
  const ph = p.type === 'number' ? 'Введи число' : 'Введи ответ';
  const units = p.units ? `<span class="units">${p.units}</span>` : '';
  return `<div style="display:flex; align-items:center; gap:0.4rem;">
    <input type="text" id="${idPrefix}" placeholder="${ph}" />${units}
  </div>`;
}

function getProblemValue(p, idPrefix) {
  if (p.type === 'choice') {
    const sel = document.querySelector(`input[name="${idPrefix}"]:checked`);
    return sel ? sel.value : null;
  }
  return document.getElementById(idPrefix)?.value || '';
}

function checkAllProblems(dayKey, day, problemsToShow) {
  let correct = 0;
  problemsToShow.forEach((p, i) => {
    const value = getProblemValue(p, `prob-${i}`);
    const ok = checkAnswer(p, value);
    const parent = document.querySelector(`.problem[data-prob-idx="${i}"]`);
    parent.classList.remove('correct', 'wrong');
    parent.classList.add(ok ? 'correct' : 'wrong');
    const fb = parent.querySelector('.feedback-area');
    fb.innerHTML = `<div class="feedback ${ok ? 'ok' : 'bad'}">${ok ? '✅ Верно' : '❌ Ошибка'}${p.hint && !ok ? ` <div class="hint">💡 ${p.hint}</div>` : ''}</div>`;
    if (ok) correct++;
  });

  const percent = Math.round((correct / problemsToShow.length) * 100);
  const grade = gradeFromPercent(percent);

  // Бонус если ≥70%
  let bonusHtml = '';
  let bonusType = null, bonusText = null;
  if (percent >= 70) {
    ({ bonusType, bonusText } = randomBonus());
    bonusHtml = `<div class="bonus"><strong>🎁 Бонус (${bonusType}):</strong><br>${bonusText}</div>`;
  }

  document.getElementById('result-area').innerHTML = `
    <div class="grade-card">
      <p class="grade">${grade}</p>
      <p class="score">Правильно: ${correct} из ${problemsToShow.length} (${percent}%)</p>
    </div>
    ${bonusHtml}
  `;

  // Сохраняем в дневник
  const today = isoDate(new Date());
  // Удалим предыдущую запись за этот же день+dayKey, если есть
  state.history = state.history.filter(h => !(h.date === today && h.dayKey === dayKey));
  state.history.push({
    date: today,
    dayKey,
    week: Number(dayKey.match(/w(\d+)/)[1]),
    dayNum: Number(dayKey.match(/d(\d+)/)[1]),
    subject: day.subject,
    topic: day.topic,
    grade,
    percent,
    bonusType,
    bonusText
  });
  saveState();
}

function randomBonus() {
  const kinds = ['joke', 'quote', 'medal'];
  const kind = kinds[Math.floor(Math.random() * kinds.length)];
  if (kind === 'joke') return { bonusType: 'анекдот', bonusText: BONUSES.jokes[Math.floor(Math.random() * BONUSES.jokes.length)] };
  if (kind === 'quote') return { bonusType: 'цитата', bonusText: BONUSES.quotes[Math.floor(Math.random() * BONUSES.quotes.length)] };
  return { bonusType: 'медалька', bonusText: BONUSES.medals[Math.floor(Math.random() * BONUSES.medals.length)] };
}

/* ============ Вкладка «Парус» ============ */

let openSailingCats = new Set();

function renderSailing() {
  const html = `
    <div class="card">
      <h2>⛵ Парусный спорт — теория</h2>
      <p style="color:var(--muted);">Все 4 раздела с теорией, ссылками на видео и мини-тестами. Кликни по разделу, чтобы раскрыть.</p>
      ${SAILING.categories.map(cat => `
        <div class="sailing-cat ${openSailingCats.has(cat.id) ? 'open' : ''}" data-cat="${cat.id}">
          <div class="sailing-cat-head">
            <span>${cat.icon} ${cat.name}</span>
            <span>${openSailingCats.has(cat.id) ? '▼' : '▶'}</span>
          </div>
          <div class="sailing-cat-body">
            ${cat.lessons.map((l, i) => `
              <div class="sailing-lesson">
                <h4>${i + 1}. ${l.title}</h4>
                <div class="theory" style="margin-top:0.3rem;">${l.theory}</div>
                <div class="physics-link">${l.physicsLink}</div>
                <br><a class="video-btn" href="${l.videoUrl}" target="_blank" rel="noopener">▶ Видео</a>
              </div>
            `).join('')}
            <h3>🧪 Мини-тест</h3>
            ${cat.test.map((p, i) => `
              <div class="problem" data-cat="${cat.id}" data-test-idx="${i}">
                <div class="q">${p.q}</div>
                ${renderProblemInput(p, `sail-${cat.id}-${i}`)}
                <button class="secondary check-sail-btn" data-cat="${cat.id}" data-idx="${i}">Проверить</button>
                <div class="feedback-area"></div>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
  document.getElementById('view').innerHTML = html;

  document.querySelectorAll('.sailing-cat-head').forEach(h => {
    h.onclick = () => {
      const id = h.parentElement.dataset.cat;
      if (openSailingCats.has(id)) openSailingCats.delete(id);
      else openSailingCats.add(id);
      renderSailing();
    };
  });

  document.querySelectorAll('.check-sail-btn').forEach(btn => {
    btn.onclick = () => {
      const cid = btn.dataset.cat;
      const idx = Number(btn.dataset.idx);
      const cat = SAILING.categories.find(c => c.id === cid);
      const p = cat.test[idx];
      const value = getProblemValue(p, `sail-${cid}-${idx}`);
      const ok = checkAnswer(p, value);
      const parent = btn.closest('.problem');
      parent.classList.remove('correct', 'wrong');
      parent.classList.add(ok ? 'correct' : 'wrong');
      parent.querySelector('.feedback-area').innerHTML = `<div class="feedback ${ok ? 'ok' : 'bad'}">${ok ? '✅ Верно!' : '❌ Попробуй ещё'}</div>`;
    };
  });
}

/* ============ Вкладка «Дневник» ============ */

function renderDiary() {
  const sorted = [...state.history].sort((a, b) => (a.date + a.dayKey) < (b.date + b.dayKey) ? 1 : -1);

  if (sorted.length === 0) {
    document.getElementById('view').innerHTML = `
      <div class="card"><h2>📓 Дневник</h2><p class="empty">Пока пусто — реши первое ДЗ во вкладке «Сегодня».</p></div>
    `;
    return;
  }

  const rows = sorted.map(h => {
    const dateRu = parseISO(h.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
    const subj = h.subject === 'physics' ? '⚡ Физика' : '📐 Математика';
    return `<tr>
      <td>${dateRu}</td>
      <td>Н${h.week}д${h.dayNum}</td>
      <td>${subj}</td>
      <td>${h.topic}</td>
      <td class="grade-cell g${h.grade}">${h.grade} (${h.percent}%)</td>
      <td>${h.bonusType || '—'}</td>
    </tr>`;
  }).join('');

  document.getElementById('view').innerHTML = `
    <div class="card">
      <h2>📓 Дневник успеваемости</h2>
      <p style="color:var(--muted); margin:0 0 0.6rem;">Всего записей: ${sorted.length}</p>
      <div style="overflow-x:auto;">
        <table>
          <thead>
            <tr><th>Дата</th><th>День</th><th>Предмет</th><th>Тема</th><th>Оценка</th><th>Бонус</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

/* ============ Вкладка «Прогресс» (график на canvas) ============ */

function renderProgress() {
  if (state.history.length === 0) {
    document.getElementById('view').innerHTML = `
      <div class="card"><h2>📈 Прогресс</h2><p class="empty">Пока нет данных. Реши хотя бы одно ДЗ.</p></div>
    `;
    return;
  }

  // Подсчёты
  const total = state.history.length;
  const avgGrade = (state.history.reduce((s, h) => s + h.grade, 0) / total).toFixed(2);
  const fiveCount = state.history.filter(h => h.grade === 5).length;
  const bonusCount = state.history.filter(h => h.bonusType).length;

  document.getElementById('view').innerHTML = `
    <div class="card">
      <h2>📈 Прогресс</h2>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:0.7rem; margin-bottom:0.8rem;">
        <div class="theory"><strong>Сделано ДЗ:</strong><br>${total}</div>
        <div class="theory"><strong>Средняя оценка:</strong><br>${avgGrade}</div>
        <div class="theory"><strong>Пятёрок:</strong><br>${fiveCount}</div>
        <div class="theory"><strong>Бонусов получено:</strong><br>${bonusCount}</div>
      </div>
      <div class="chart-wrap">
        <h3>Оценки по дням</h3>
        <canvas id="progress-chart"></canvas>
      </div>
      <div class="chart-wrap">
        <h3>Сводка по неделям (средняя оценка)</h3>
        <canvas id="weekly-chart"></canvas>
      </div>
    </div>
  `;

  drawDailyChart();
  drawWeeklyChart();
}

function drawDailyChart() {
  const c = document.getElementById('progress-chart');
  const ctx = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = c.offsetWidth;
  const h = 280;
  c.width = w * dpr;
  c.height = h * dpr;
  ctx.scale(dpr, dpr);

  const sorted = [...state.history].sort((a, b) => a.date < b.date ? -1 : 1);
  const padding = 40;
  const chartW = w - padding * 2;
  const chartH = h - padding * 2;

  // Оси
  ctx.strokeStyle = '#d5e3eb';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, padding);
  ctx.lineTo(padding, h - padding);
  ctx.lineTo(w - padding, h - padding);
  ctx.stroke();

  // Горизонтальные линии для оценок 2-5
  ctx.fillStyle = '#6b7c8a';
  ctx.font = '12px sans-serif';
  for (let g = 2; g <= 5; g++) {
    const y = h - padding - ((g - 2) / 3) * chartH;
    ctx.fillText(g.toString(), padding - 18, y + 4);
    ctx.strokeStyle = '#eef3f6';
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(w - padding, y);
    ctx.stroke();
  }

  if (sorted.length === 0) return;

  // Точки
  const stepX = sorted.length > 1 ? chartW / (sorted.length - 1) : 0;
  sorted.forEach((h2, i) => {
    const x = padding + i * stepX;
    const y = h - padding - ((h2.grade - 2) / 3) * chartH;
    ctx.fillStyle = h2.subject === 'physics' ? '#1e6091' : '#b85700';
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    if (i > 0) {
      const px = padding + (i - 1) * stepX;
      const ph = sorted[i - 1].grade;
      const py = h - padding - ((ph - 2) / 3) * chartH;
      ctx.strokeStyle = '#3aa6b9';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  });

  // Легенда
  ctx.font = '12px sans-serif';
  ctx.fillStyle = '#1e6091';
  ctx.fillText('● Физика', padding, padding - 10);
  ctx.fillStyle = '#b85700';
  ctx.fillText('● Математика', padding + 80, padding - 10);
}

function drawWeeklyChart() {
  const c = document.getElementById('weekly-chart');
  const ctx = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = c.offsetWidth;
  const h = 240;
  c.width = w * dpr;
  c.height = h * dpr;
  ctx.scale(dpr, dpr);

  // Группировка по неделям
  const byWeek = {};
  state.history.forEach(h2 => {
    if (!byWeek[h2.week]) byWeek[h2.week] = [];
    byWeek[h2.week].push(h2.grade);
  });

  const weeks = Object.keys(byWeek).map(Number).sort((a, b) => a - b);
  const padding = 40;
  const chartW = w - padding * 2;
  const chartH = h - padding * 2;
  const barW = chartW / Math.max(weeks.length, 1) * 0.7;
  const gap = chartW / Math.max(weeks.length, 1) * 0.3;

  // Оси
  ctx.strokeStyle = '#d5e3eb';
  ctx.beginPath();
  ctx.moveTo(padding, padding);
  ctx.lineTo(padding, h - padding);
  ctx.lineTo(w - padding, h - padding);
  ctx.stroke();

  ctx.fillStyle = '#6b7c8a';
  ctx.font = '12px sans-serif';
  for (let g = 2; g <= 5; g++) {
    const y = h - padding - ((g - 2) / 3) * chartH;
    ctx.fillText(g.toString(), padding - 18, y + 4);
  }

  weeks.forEach((wk, i) => {
    const grades = byWeek[wk];
    const avg = grades.reduce((a, b) => a + b, 0) / grades.length;
    const x = padding + i * (barW + gap) + gap / 2;
    const barH = ((avg - 2) / 3) * chartH;
    const y = h - padding - barH;
    ctx.fillStyle = '#3aa6b9';
    ctx.fillRect(x, y, barW, barH);
    ctx.fillStyle = '#0a3d62';
    ctx.fillText(`Н${wk}`, x + barW / 2 - 10, h - padding + 16);
    ctx.fillText(avg.toFixed(1), x + barW / 2 - 10, y - 5);
  });
}

/* ============ Вкладка «Настройки» ============ */

function renderSettings() {
  document.getElementById('view').innerHTML = `
    <div class="card">
      <h2>⚙️ Настройки</h2>

      <div class="settings-row">
        <label><strong>Задач в ДЗ за день</strong><br><small>От 1 до 5 (в данных дня может быть меньше).</small></label>
        <input type="number" id="set-ppd" min="1" max="5" value="${state.problemsPerDay}">
      </div>

      <div class="settings-row">
        <label><strong>Дата старта программы</strong><br><small>По умолчанию 1 июня 2026 (понедельник).</small></label>
        <input type="date" id="set-start" value="${state.startDate}">
      </div>

      <div class="settings-row">
        <label><strong>Применить настройки</strong></label>
        <button class="primary" id="save-settings">Сохранить</button>
      </div>

      <h3 style="margin-top:1.4rem;">📦 Резервная копия</h3>
      <button class="secondary" id="export-btn">⬇ Экспорт в JSON</button>
      <button class="secondary" id="import-btn">⬆ Импорт из JSON</button>
      <input type="file" id="import-file" accept=".json" style="display:none;">

      <h3 style="margin-top:1.4rem;">⚠️ Сброс</h3>
      <p style="color:var(--muted); margin:0 0 0.5rem;">Удаляет всю историю и настройки. Восстановить нельзя.</p>
      <button class="danger" id="reset-btn">Сбросить весь прогресс</button>
    </div>
  `;

  document.getElementById('save-settings').onclick = () => {
    const ppd = Math.max(1, Math.min(5, Number(document.getElementById('set-ppd').value)));
    const start = document.getElementById('set-start').value;
    state.problemsPerDay = ppd;
    if (start) state.startDate = start;
    saveState();
    alert('Настройки сохранены');
    render();
  };

  document.getElementById('export-btn').onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `summer-school-backup-${isoDate(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  document.getElementById('import-btn').onclick = () => document.getElementById('import-file').click();
  document.getElementById('import-file').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (confirm('Заменить текущий прогресс данными из файла?')) {
          state = { ...DEFAULT_STATE, ...data };
          saveState();
          alert('Импорт успешен');
          render();
        }
      } catch (err) {
        alert('Ошибка чтения файла: ' + err.message);
      }
    };
    reader.readAsText(file);
  };

  document.getElementById('reset-btn').onclick = () => {
    if (confirm('Точно сбросить ВСЁ? Это удалит всю историю и оценки.')) {
      localStorage.removeItem(STORAGE_KEY);
      state = { ...DEFAULT_STATE };
      alert('Сброшено');
      render();
    }
  };
}

/* ============ Основной рендер ============ */

function render() {
  renderHeader();
  renderTabs();
  if (currentTab === 'today')    renderToday();
  if (currentTab === 'sailing')  renderSailing();
  if (currentTab === 'diary')    renderDiary();
  if (currentTab === 'progress') renderProgress();
  if (currentTab === 'settings') renderSettings();
}

document.addEventListener('DOMContentLoaded', render);
