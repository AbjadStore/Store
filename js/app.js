/* ==========================================================
   مكتبة أبجد — منطق التطبيق
   - كل البيانات تأتي من: data/products.json و data/exercises.json
   - لا يوجد سيرفر: ما يختاره العميل يُحفظ في متصفحه (localStorage)
   ========================================================== */
(() => {
  'use strict';

  /* ---------- أدوات صغيرة ---------- */

  const KEYS = {
    profile: 'abgad.profile.v1',
    cart: 'abgad.cart.v1',
    checkout: 'abgad.checkout.v1',
    data: 'abgad.data.v1',
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const toArr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
  const esc = (v) =>
    String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // توحيد الحروف العربية لتعمل شاشة البحث بدقة (أ/إ/آ، ة/ه، ى/ي، التشكيل)
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[ً-ٰٟ]/g, '')
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .trim();

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }
  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) { /* التخزين غير متاح: نتجاهل */ }
  }

  /* ---------- الحالة ---------- */

  const state = {
    data: null,
    products: [],
    exercises: [],
    gradeMap: new Map(),
    subjectMap: new Map(),
    productMap: new Map(),
    exMap: new Map(),
    raw: '',
    loadedAt: 0,

    profile: read(KEYS.profile, null),
    cart: new Set(toArr(read(KEYS.cart, []))),
    checkout: Object.assign({ mode: 'pickup', address: '' }, read(KEYS.checkout, {})),
    paid: false,
    sent: false,

    view: 'notebooks',
    scope: 'mine', // mine | all
    subjectFilter: '',
    search: '',

    onb: null,
    installEvent: null,
    lastFocus: null,
  };

  const lib = () => state.data.library;
  const money = (n) => `${n} ${lib().currency || 'جنيه'}`;
  const gradeName = (id) => (state.gradeMap.get(id) || {}).name || id || '';
  const subjectName = (id) => (state.subjectMap.get(id) || {}).name || id || '';

  /* ---------- تحميل البيانات ---------- */

  async function fetchText(path) {
    // ?t= يتجاوز الكاش حتى تظهر التعديلات سريعًا
    const res = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${path} ${res.status}`);
    return res.text();
  }

  function parseOr(text, fallbackText, label) {
    try {
      return { obj: JSON.parse(text), text };
    } catch (err) {
      console.error(`خطأ في ملف ${label}: تأكد من الفواصل والأقواس. تم استخدام آخر نسخة سليمة.`, err);
      if (fallbackText) {
        try { return { obj: JSON.parse(fallbackText), text: fallbackText }; } catch (_) { /* لا شيء */ }
      }
      return null;
    }
  }

  // يرجع: { ok, changed }
  async function loadData() {
    const cached = read(KEYS.data, null) || {};
    let pText = null;
    let eText = null;
    try { pText = await fetchText('data/products.json'); } catch (_) { pText = cached.p || null; }
    try { eText = await fetchText('data/exercises.json'); } catch (_) { eText = cached.e || null; }

    if (pText == null) return { ok: false, changed: false };

    const p = parseOr(pText, cached.p, 'products.json');
    if (!p) return { ok: false, changed: false };
    const e = eText != null ? parseOr(eText, cached.e, 'exercises.json') : null;

    const raw = p.text + '|' + (e ? e.text : '');
    state.loadedAt = Date.now();
    if (raw === state.raw) return { ok: true, changed: false };

    state.raw = raw;
    write(KEYS.data, { p: p.text, e: e ? e.text : '' });
    applyData(p.obj, e ? e.obj : { exercises: [] });
    return { ok: true, changed: true };
  }

  function applyData(p, e) {
    const library = Object.assign(
      { name: 'أبجد', tagline: '', whatsapp: '', deliveryFee: 10, currency: 'جنيه', instapay: {} },
      p.library || {}
    );
    const grades = toArr(p.grades);
    const subjects = toArr(p.subjects);
    const stages = toArr(p.stages);
    state.data = { library, grades, subjects, stages };

    state.gradeMap = new Map(grades.map((g, i) => [g.id, { ...g, order: i }]));
    state.subjectMap = new Map(subjects.map((s, i) => [s.id, { ...s, order: i }]));
    const gOrder = (id) => (state.gradeMap.has(id) ? state.gradeMap.get(id).order : 999);
    const sOrder = (id) => (state.subjectMap.has(id) ? state.subjectMap.get(id).order : 999);

    state.products = toArr(p.products)
      .filter((x) => x && x.id && x.available !== false)
      .map((x, i) => ({
        id: String(x.id),
        name: String(x.name || ''),
        grade: x.grade,
        subject: x.subject,
        price: Number(x.price) || 0,
        grades: [x.grade],
        _i: i,
      }))
      .sort((a, b) => gOrder(a.grade) - gOrder(b.grade) || sOrder(a.subject) - sOrder(b.subject) || a._i - b._i);
    state.productMap = new Map(state.products.map((x) => [x.id, x]));

    state.exercises = toArr(e && e.exercises)
      .filter((x) => x && x.id && x.file && x.available !== false)
      .map((x, i) => ({
        id: String(x.id),
        title: String(x.title || ''),
        description: String(x.description || ''),
        subject: x.subject,
        grades: toArr(x.grade).filter(Boolean),
        file: String(x.file),
        _i: i,
      }))
      .sort(
        (a, b) =>
          gOrder(a.grades[0]) - gOrder(b.grades[0]) || sOrder(a.subject) - sOrder(b.subject) || a._i - b._i
      );
    state.exMap = new Map(state.exercises.map((x) => [x.id, x]));

    // تنظيف السلة من ملازم لم تعد موجودة
    for (const id of [...state.cart]) if (!state.productMap.has(id)) state.cart.delete(id);
    write(KEYS.cart, [...state.cart]);

    // تنظيف الاهتمامات من صفوف لم تعد موجودة
    if (state.profile) {
      state.profile.grades = toArr(state.profile.grades).filter((id) => state.gradeMap.has(id));
      state.profile.subjects = toArr(state.profile.subjects);
      if (!state.profile.grades.length) state.profile = null;
      else write(KEYS.profile, state.profile);
    }
  }

  /* ---------- الاهتمامات والتصفية ---------- */

  function inScope(item) {
    if (state.scope === 'all' || !state.profile) return true;
    const pr = state.profile;
    const gradeOk = !item.grades.length || item.grades.some((g) => pr.grades.includes(g));
    const subjectOk = !pr.subjects.length || pr.subjects.includes(item.subject);
    return gradeOk && subjectOk;
  }

  // المواد الموجودة فعليًا للصفوف المختارة
  function availableSubjects(gradeIds) {
    const ids = new Set();
    const take = (it) => {
      if (!it.grades.length || it.grades.some((g) => gradeIds.includes(g))) ids.add(it.subject);
    };
    state.products.forEach(take);
    state.exercises.forEach(take);
    const list = state.data.subjects.filter((s) => ids.has(s.id));
    ids.forEach((id) => {
      if (id && !state.subjectMap.has(id)) list.push({ id, name: id });
    });
    return list.length ? list : state.data.subjects;
  }

  function subjectChoices() {
    const pr = state.profile;
    if (pr.subjects.length) return pr.subjects.map((id) => ({ id, name: subjectName(id) }));
    return availableSubjects(pr.grades);
  }

  function productsInView() {
    let list = state.products.filter(inScope);
    if (state.scope === 'mine' && state.subjectFilter) {
      list = list.filter((p) => p.subject === state.subjectFilter);
    }
    if (state.scope === 'all' && state.search.trim()) {
      const q = norm(state.search);
      list = list.filter((p) => norm(`${p.name} ${subjectName(p.subject)} ${gradeName(p.grade)}`).includes(q));
    }
    return list;
  }

  const exercisesInView = () => state.exercises.filter(inScope);

  /* ---------- السلة ---------- */

  const cartItems = () => [...state.cart].map((id) => state.productMap.get(id)).filter(Boolean);

  function totals(items) {
    const subtotal = items.reduce((s, p) => s + p.price, 0);
    const delivery = state.checkout.mode === 'delivery';
    const fee = delivery ? Number(lib().deliveryFee) || 0 : 0;
    return { subtotal, delivery, fee, total: subtotal + fee };
  }

  function countLabel(n) {
    if (n === 1) return 'ملزمة واحدة';
    if (n === 2) return 'ملزمتان';
    if (n <= 10) return `${n} ملازم`;
    return `${n} ملزمة`;
  }

  function toggleCart(id, on) {
    if (on) state.cart.add(id);
    else state.cart.delete(id);
    write(KEYS.cart, [...state.cart]);
    state.sent = false;
    renderCartBar();
  }

  function renderCartBar() {
    const bar = $('#cartbar');
    const items = cartItems();
    if (!items.length || state.view === 'cart' || !state.profile) {
      bar.hidden = true;
      bar.innerHTML = '';
      return;
    }
    if (!bar.firstElementChild) {
      bar.innerHTML = `
        <div class="cartbar-inner">
          <div class="cartbar-info"><b></b><span></span></div>
          <a class="btn marker" href="#cart">مراجعة الطلب</a>
        </div>`;
    }
    $('b', bar).textContent = countLabel(items.length);
    $('span', bar).textContent = money(items.reduce((s, p) => s + p.price, 0));
    bar.hidden = false;
  }

  /* ---------- مكونات HTML ---------- */

  const checkSvg = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5"/></svg>';

  function rowHTML(p) {
    return `
      <label class="row">
        <input type="checkbox" data-add="${esc(p.id)}" ${state.cart.has(p.id) ? 'checked' : ''}>
        <span class="tick">${checkSvg}</span>
        <span class="row-text">
          <span class="row-name"><span>${esc(p.name)}</span></span>
          <span class="row-sub">${esc(subjectName(p.subject))}</span>
        </span>
        <span class="price">${p.price} <small>${esc(lib().currency)}</small></span>
      </label>`;
  }

  function groupedRows(items) {
    const out = [];
    let last = null;
    items.forEach((p) => {
      if (p.grade !== last) {
        out.push(`<div class="grade-head">${esc(gradeName(p.grade))}</div>`);
        last = p.grade;
      }
      out.push(rowHTML(p));
    });
    return out.join('');
  }

  function gradeChips(selected, act) {
    const stages = state.data.stages.length ? state.data.stages : [{ id: '*', name: 'الصفوف الدراسية' }];
    return stages
      .map((st) => {
        const gs = state.data.grades.filter((g) => st.id === '*' || g.stage === st.id);
        if (!gs.length) return '';
        return `
          <fieldset class="stage">
            <legend>${esc(st.name)}</legend>
            <div class="chips">
              ${gs
                .map(
                  (g) => `<button type="button" class="chip" data-act="${act}" data-id="${esc(g.id)}"
                    aria-pressed="${selected.includes(g.id)}" aria-label="${esc(g.name)}">${esc(g.short || g.name)}</button>`
                )
                .join('')}
            </div>
          </fieldset>`;
      })
      .join('');
  }

  function subjectChips(selected, avail, act) {
    return `
      <div class="chips">
        <button type="button" class="chip" data-act="${act}" data-id="*" aria-pressed="${selected.length === 0}">كل المواد</button>
        ${avail
          .map(
            (s) => `<button type="button" class="chip" data-act="${act}" data-id="${esc(s.id)}"
              aria-pressed="${selected.includes(s.id)}">${esc(s.name)}</button>`
          )
          .join('')}
      </div>`;
  }

  function segmentHTML(mineLabel, allLabel) {
    return `
      <div class="segment" role="group" aria-label="نطاق العرض">
        <button type="button" data-act="scope" data-id="mine" aria-pressed="${state.scope === 'mine'}">${mineLabel}</button>
        <button type="button" data-act="scope" data-id="all" aria-pressed="${state.scope === 'all'}">${allLabel}</button>
      </div>`;
  }

  /* ---------- الصفحات ---------- */

  function viewNotebooks() {
    const mine = state.scope === 'mine';
    let tools = '';
    if (mine) {
      const subs = subjectChoices();
      if (!subs.some((s) => s.id === state.subjectFilter)) state.subjectFilter = '';
      if (subs.length > 1) {
        tools = `
          <div class="chip-scroll" role="group" aria-label="تصفية حسب المادة">
            <button type="button" class="chip" data-act="filter" data-id="" aria-pressed="${!state.subjectFilter}">الكل</button>
            ${subs
              .map(
                (s) => `<button type="button" class="chip" data-act="filter" data-id="${esc(s.id)}"
                  aria-pressed="${state.subjectFilter === s.id}">${esc(s.name)}</button>`
              )
              .join('')}
          </div>`;
      }
    } else {
      tools = `
        <label class="field">
          <span class="sr-only">ابحث عن ملزمة</span>
          <input class="input" type="search" id="search" placeholder="ابحث باسم الملزمة أو المادة"
            value="${esc(state.search)}" autocomplete="off">
        </label>`;
    }
    return `
      <h1 class="page-title">الملازم</h1>
      <p class="page-lead">اضغط على الملزمة لتضاف إلى طلبك.</p>
      ${segmentHTML('ملازمي', 'كل الملازم')}
      ${tools}
      <div id="list"></div>`;
  }

  function renderList() {
    const el = $('#list');
    if (!el) return;
    const items = productsInView();
    if (!items.length) {
      el.innerHTML =
        state.scope === 'mine'
          ? `<div class="empty">
               <h2>لا توجد ملازم لهذا الاختيار بعد</h2>
               <p>تُضاف ملازم جديدة باستمرار. يمكنك الآن تصفح كل الملازم.</p>
               <div class="actions">
                 <button type="button" class="btn small" data-act="scope" data-id="all">عرض كل الملازم</button>
                 <a class="btn secondary small" href="#me">تغيير اهتماماتي</a>
               </div>
             </div>`
          : `<div class="empty">
               <h2>لا توجد نتائج</h2>
               <p>جرّب كلمة أخرى للبحث.</p>
               <div class="actions"><button type="button" class="btn small" data-act="clear-search">مسح البحث</button></div>
             </div>`;
      return;
    }
    el.innerHTML = `<div class="sheet">${groupedRows(items)}</div>`;
  }

  function viewExercises() {
    const list = exercisesInView();
    let body;
    if (!list.length) {
      body =
        state.scope === 'mine'
          ? `<div class="empty">
               <h2>لا توجد تدريبات لهذا الاختيار بعد</h2>
               <p>نضيف تدريبات جديدة باستمرار. يمكنك الآن تصفح كل التدريبات.</p>
               <div class="actions">
                 <button type="button" class="btn small" data-act="scope" data-id="all">عرض كل التدريبات</button>
                 <a class="btn secondary small" href="#me">تغيير اهتماماتي</a>
               </div>
             </div>`
          : `<div class="empty"><h2>لا توجد تدريبات حاليًا</h2><p>سنضيف تدريبات قريبًا.</p></div>`;
    } else {
      body = `<div class="ex-list">${list
        .map((x) => {
          const where = [subjectName(x.subject), x.grades.map(gradeName).join('، ')].filter(Boolean).join(' - ');
          return `
            <article class="ex-card">
              <div>
                <h3>${esc(x.title)}</h3>
                <p>${esc(where)}</p>
                ${x.description ? `<p>${esc(x.description)}</p>` : ''}
              </div>
              <button type="button" class="btn marker small" data-act="open-ex" data-id="${esc(x.id)}">ابدأ التدريب</button>
            </article>`;
        })
        .join('')}</div>`;
    }
    return `
      <h1 class="page-title">التدريبات</h1>
      <p class="page-lead">تدريبات تفاعلية تعرف نتيجتها فور الإجابة.</p>
      ${segmentHTML('تدريباتي', 'كل التدريبات')}
      ${body}`;
  }

  function cartRowHTML(p) {
    return `
      <div class="row cart-row">
        <button type="button" class="remove-x" data-act="remove" data-id="${esc(p.id)}"
          aria-label="حذف ${esc(p.name)} من الطلب">×</button>
        <div class="row-text">
          <span class="row-name"><span>${esc(p.name)}</span></span>
          <span class="row-sub">${esc(gradeName(p.grade))}</span>
        </div>
        <span class="price">${p.price} <small>${esc(lib().currency)}</small></span>
      </div>`;
  }

  function viewCart() {
    const items = cartItems();
    if (!items.length) {
      return `
        <a class="back" href="#notebooks">رجوع إلى الملازم</a>
        <div class="card empty">
          <h2>لم تختر ملازم بعد</h2>
          <p>اختر الملازم التي تريد طباعتها وسنجهزها لك.</p>
          <div class="actions"><a class="btn" href="#notebooks">تصفح الملازم</a></div>
        </div>`;
    }
    const t = totals(items);
    const ip = lib().instapay || {};
    const name = (state.profile && state.profile.name) || '';

    const payBox = t.delivery
      ? `
        <div class="pay-box">
          <h3>الدفع عبر انستاباي</h3>
          <p>المبلغ المطلوب تحويله</p>
          <div class="pay-amount">${esc(money(t.total))}</div>
          <div class="pay-address">
            <code>${esc(ip.address || '')}</code>
            <button type="button" class="btn secondary small" data-act="copy" data-id="${esc(ip.address || '')}">نسخ</button>
          </div>
          ${ip.accountName ? `<p class="fine">اسم الحساب: ${esc(ip.accountName)}</p>` : ''}
          <ol class="pay-steps">
            <li>حوّل المبلغ إلى العنوان أعلاه.</li>
            <li>اضغط «إرسال الطلب عبر واتساب».</li>
            <li>أرسل صورة التحويل في المحادثة.</li>
          </ol>
          <label class="check">
            <input type="checkbox" id="f-paid" ${state.paid ? 'checked' : ''}>
            <span>حوّلت المبلغ بالفعل</span>
          </label>
        </div>`
      : '';

    return `
      <a class="back" href="#notebooks">رجوع إلى الملازم</a>
      <h1 class="page-title">طلبك</h1>

      ${
        state.sent
          ? `<div class="notice">
               <b>فتحنا واتساب برسالة جاهزة</b>
               اضغط إرسال داخل المحادثة لإتمام الطلب.${t.delivery ? ' ولا تنس إرسال صورة التحويل.' : ''}
               <div class="mt"><button type="button" class="btn secondary small" data-act="clear-cart">بدء طلب جديد</button></div>
             </div>`
          : ''
      }

      <div class="sheet">${items.map(cartRowHTML).join('')}</div>

      <h2 class="section-title">بياناتك</h2>
      <label class="field">
        <span class="label">الاسم</span>
        <input class="input" id="f-name" autocomplete="name" value="${esc(name)}" placeholder="اسم ولي الأمر أو الطالب">
      </label>

      <h2 class="section-title">طريقة الاستلام</h2>
      <div class="options" role="radiogroup" aria-label="طريقة الاستلام">
        <label class="option">
          <input type="radio" name="mode" value="pickup" ${t.delivery ? '' : 'checked'}>
          <div><b>استلام من المكتبة</b><small>بدون رسوم</small></div>
        </label>
        <label class="option">
          <input type="radio" name="mode" value="delivery" ${t.delivery ? 'checked' : ''}>
          <div><b>توصيل إلى العنوان</b><small>تضاف ${esc(money(Number(lib().deliveryFee) || 0))} على الطلب كله، ويُدفع المبلغ مقدمًا</small></div>
        </label>
      </div>

      ${
        t.delivery
          ? `<label class="field mt">
               <span class="label">العنوان بالتفصيل</span>
               <textarea class="textarea" id="f-address" placeholder="المحافظة، المنطقة، الشارع، رقم المبنى">${esc(state.checkout.address)}</textarea>
             </label>
             ${payBox}`
          : ''
      }

      <div class="summary">
        <div><span>الملازم (${items.length})</span><span>${esc(money(t.subtotal))}</span></div>
        ${t.delivery ? `<div><span>رسوم التوصيل</span><span>${esc(money(t.fee))}</span></div>` : ''}
        <div class="total"><span>الإجمالي</span><span>${esc(money(t.total))}</span></div>
      </div>

      <p class="error-text" id="cart-error" role="alert" hidden></p>
      <button type="button" class="btn marker block mt" data-act="send">إرسال الطلب عبر واتساب</button>
      <p class="send-note">سيفتح واتساب برسالة جاهزة، اضغط إرسال داخل المحادثة.</p>
      <div class="center"><button type="button" class="link-btn" data-act="clear-cart">إفراغ الطلب</button></div>`;
  }

  function installCardHTML() {
    if (isStandalone()) return '';
    return `
      <div class="card">
        <h2>ثبّت التطبيق</h2>
        <p>أضف أبجد إلى شاشة موبايلك لتفتحه بضغطة واحدة.</p>
        <button type="button" class="btn" data-act="open-install">${state.installEvent ? 'تثبيت التطبيق' : 'طريقة التثبيت'}</button>
      </div>`;
  }

  function viewMe() {
    const pr = state.profile;
    const avail = availableSubjects(pr.grades);
    return `
      <h1 class="page-title">حسابي</h1>
      <p class="page-lead">اختر الصف والمواد، وسنعرض لك ما يخصك فقط.</p>

      <div class="card">
        <label class="field" style="margin:0">
          <span class="label">الاسم</span>
          <input class="input" id="me-name" autocomplete="name" value="${esc(pr.name || '')}" placeholder="اسم ولي الأمر أو الطالب">
        </label>
      </div>

      <div class="card">
        <h2>الصف الدراسي</h2>
        <p class="fine" style="margin:0 0 12px">يمكنك اختيار أكثر من صف.</p>
        ${gradeChips(pr.grades, 'm-grade')}
      </div>

      <div class="card">
        <h2>المواد التي تهمك</h2>
        <p class="fine" style="margin:0 0 12px">اختر «كل المواد» لعرض كل شيء.</p>
        ${subjectChips(pr.subjects, avail, 'm-subject')}
      </div>

      ${installCardHTML()}

      <div class="card">
        <h2>القائمة</h2>
        <p>تتحدث الملازم والتدريبات تلقائيًا عند تغيير القائمة في المكتبة.</p>
        <button type="button" class="btn secondary" data-act="refresh">تحديث القائمة الآن</button>
      </div>`;
  }

  const VIEWS = { notebooks: viewNotebooks, exercises: viewExercises, me: viewMe, cart: viewCart };

  /* ---------- العرض والتنقل ---------- */

  function route() {
    const h = location.hash.replace('#', '');
    return VIEWS[h] ? h : 'notebooks';
  }

  function whoLabel() {
    const g = state.profile.grades;
    if (g.length === 1) return gradeName(g[0]);
    if (g.length === 2) return 'صفّان دراسيان';
    return `${g.length} صفوف دراسية`;
  }

  function renderView(focusSel) {
    if (!state.profile) return;
    state.view = route();
    $('#view').innerHTML = VIEWS[state.view]();
    if (state.view === 'notebooks') renderList();

    document.querySelectorAll('.tabs a').forEach((a) => {
      const active = a.dataset.tab === (state.view === 'cart' ? 'notebooks' : state.view);
      if (active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    const who = $('#who');
    who.textContent = whoLabel();
    who.setAttribute('aria-label', `تغيير الصف والمواد. الاختيار الحالي: ${whoLabel()}`);

    renderCartBar();
    if (focusSel) {
      const el = $(focusSel);
      if (el) el.focus({ preventScroll: true });
    }
  }

  window.addEventListener('hashchange', () => {
    if (state.onb) return;
    renderView();
    window.scrollTo(0, 0);
    $('#view').focus({ preventScroll: true });
  });

  /* ---------- الطبقات المنبثقة ---------- */

  function setOverlay(html, focusSel) {
    $('#overlay').innerHTML = html;
    document.body.style.overflow = html ? 'hidden' : '';
    if (html && focusSel) {
      const el = $(focusSel, $('#overlay'));
      if (el) el.focus({ preventScroll: true });
    }
  }

  function closeOverlay() {
    setOverlay('');
    if (state.lastFocus && document.contains(state.lastFocus)) state.lastFocus.focus({ preventScroll: true });
    state.lastFocus = null;
  }

  /* ---------- شاشة الترحيب (الخطوات الأولى) ---------- */

  function startOnboarding() {
    const pr = state.profile || {};
    state.onb = {
      step: 1,
      grades: toArr(pr.grades).slice(),
      subjects: toArr(pr.subjects).slice(),
      name: pr.name || '',
      shown: false,
    };
    renderOnboarding();
  }

  function renderOnboarding(focusSel) {
    const o = state.onb;
    let card = '';
    if (o.step === 1) {
      card = `
        <p class="step-count">الخطوة 1 من 3</p>
        <h1 id="onb-title">اختر الصف الدراسي</h1>
        <p class="lead">يمكنك اختيار أكثر من صف إذا كان لديك أكثر من طالب.</p>
        ${gradeChips(o.grades, 'o-grade')}
        <div class="step-actions single">
          <button type="button" class="btn block" id="onb-next" data-act="o-next" ${o.grades.length ? '' : 'disabled'}>التالي</button>
        </div>`;
    } else if (o.step === 2) {
      card = `
        <p class="step-count">الخطوة 2 من 3</p>
        <h1 id="onb-title">ما المواد التي تهمك؟</h1>
        <p class="lead">سنعرض لك ملازم هذه المواد فقط. يمكنك تغييرها لاحقًا من «حسابي».</p>
        ${subjectChips(o.subjects, availableSubjects(o.grades), 'o-subject')}
        <div class="step-actions">
          <button type="button" class="btn secondary" data-act="o-back">رجوع</button>
          <button type="button" class="btn" data-act="o-next">التالي</button>
        </div>`;
    } else {
      card = `
        <p class="step-count">الخطوة 3 من 3</p>
        <h1 id="onb-title">ما اسمك؟</h1>
        <p class="lead">نكتبه في رسالة الطلب حتى نعرف صاحب الطلب. يمكنك تركه فارغًا الآن.</p>
        <input class="input" id="onb-name" autocomplete="name" placeholder="اسم ولي الأمر أو الطالب" value="${esc(o.name)}">
        <div class="step-actions">
          <button type="button" class="btn secondary" data-act="o-back">رجوع</button>
          <button type="button" class="btn marker" data-act="o-finish">ابدأ</button>
        </div>`;
    }

    setOverlay(
      `<div class="welcome" role="dialog" aria-modal="true" aria-labelledby="onb-title">
         <div class="welcome-inner">
           <div class="wordmark${o.shown ? ' still' : ''}" aria-label="${esc(lib().name)}"><span>${esc(lib().name)}</span></div>
           <p class="tagline">${esc(lib().tagline || 'اختر ملازمك ونحن نطبعها لك')}</p>
           <section class="step-card">${card}</section>
         </div>
       </div>`,
      focusSel
    );
    o.shown = true;
  }

  function finishOnboarding() {
    const o = state.onb;
    const avail = new Set(availableSubjects(o.grades).map((s) => s.id));
    state.profile = {
      grades: o.grades.slice(),
      subjects: o.subjects.filter((id) => avail.has(id)),
      name: o.name.trim(),
    };
    write(KEYS.profile, state.profile);
    state.onb = null;
    state.scope = 'mine';
    state.subjectFilter = '';
    setOverlay('');
    $('#app').hidden = false;
    history.replaceState(null, '', '#notebooks');
    renderView();
    window.scrollTo(0, 0);
    setTimeout(openInstallSheet, 400); // بعد استكمال البيانات نعرض خطوة التثبيت
  }

  /* ---------- تثبيت التطبيق ---------- */

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = () =>
    /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.installEvent = e;
    if (state.view === 'me') renderView();
  });
  window.addEventListener('appinstalled', () => {
    state.installEvent = null;
    if ($('#overlay .install-panel')) closeOverlay();
    if (state.profile && state.view === 'me') renderView();
    toast('تم تثبيت التطبيق');
  });

  function openInstallSheet() {
    if (isStandalone() || state.onb) return;
    let body;
    let action = '';
    if (state.installEvent) {
      body = '<p>ثبّت التطبيق على موبايلك لتفتحه في أي وقت من الشاشة الرئيسية.</p>';
      action = '<button type="button" class="btn marker" data-act="install">تثبيت التطبيق</button>';
    } else if (isIOS()) {
      body = `<p>لتثبيت التطبيق على الآيفون:</p>
        <ol>
          <li>اضغط زر المشاركة في شريط المتصفح.</li>
          <li>اختر «إضافة إلى الشاشة الرئيسية».</li>
          <li>اضغط «إضافة».</li>
        </ol>`;
    } else {
      body = `<p>لتثبيت التطبيق افتح قائمة المتصفح، ثم اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».</p>`;
    }
    state.lastFocus = document.activeElement;
    setOverlay(
      `<div class="sheet-modal" role="dialog" aria-modal="true" aria-labelledby="inst-title">
         <div class="panel install-panel">
           <h2 id="inst-title">ثبّت أبجد على موبايلك</h2>
           ${body}
           <div class="actions">
             ${action}
             <button type="button" class="btn secondary" data-act="close-overlay">ليس الآن</button>
           </div>
         </div>
       </div>`,
      '.install-panel .btn'
    );
  }

  async function runInstall() {
    const ev = state.installEvent;
    if (!ev) return;
    ev.prompt();
    try { await ev.userChoice; } catch (_) { /* لا شيء */ }
    state.installEvent = null;
    closeOverlay();
    if (state.view === 'me') renderView();
  }

  /* ---------- التدريبات ---------- */

  function openExercise(id) {
    const ex = state.exMap.get(id);
    if (!ex) return;
    state.lastFocus = document.activeElement;
    setOverlay(
      `<div class="viewer" role="dialog" aria-modal="true" aria-label="${esc(ex.title)}">
         <div class="viewer-bar">
           <h2>${esc(ex.title)}</h2>
           <a href="${esc(ex.file)}" target="_blank" rel="noopener">فتح في صفحة مستقلة</a>
           <button type="button" class="close" data-act="close-overlay">إغلاق</button>
         </div>
         <iframe src="${esc(ex.file)}" title="${esc(ex.title)}"></iframe>
       </div>`,
      '.viewer .close'
    );
  }

  /* ---------- إرسال الطلب عبر واتساب ---------- */

  function waNumber() {
    let n = String(lib().whatsapp || '').replace(/\D/g, '');
    if (n.startsWith('00')) n = n.slice(2);
    if (n.startsWith('0')) n = '2' + n; // 01012345678 -> 201012345678
    return n;
  }

  function buildMessage(items) {
    const t = totals(items);
    const name = (state.profile && state.profile.name) || '';
    const lines = [];
    lines.push(`طلب طباعة ملازم - مكتبة ${lib().name}`);
    lines.push(`الاسم: ${name}`);
    lines.push('');
    lines.push('الملازم المطلوبة:');
    items.forEach((p, i) => lines.push(`${i + 1}) ${p.name} - ${gradeName(p.grade)} (${money(p.price)})`));
    lines.push('');
    lines.push(`عدد الملازم: ${items.length}`);
    if (t.delivery) {
      lines.push('طريقة الاستلام: توصيل');
      lines.push(`العنوان: ${state.checkout.address.trim()}`);
      lines.push(`رسوم التوصيل: ${money(t.fee)}`);
    } else {
      lines.push('طريقة الاستلام: من المكتبة');
    }
    lines.push(`الإجمالي: ${money(t.total)}`);
    if (t.delivery) {
      lines.push('');
      lines.push('تم تحويل المبلغ عبر انستاباي، وسأرسل صورة التحويل في هذه المحادثة.');
    }
    return lines.join('\n');
  }

  function cartError(msg, el) {
    const box = $('#cart-error');
    box.textContent = msg;
    box.hidden = false;
    if (el) {
      el.classList.add('invalid');
      el.focus();
    } else {
      box.scrollIntoView({ block: 'center' });
    }
  }

  function sendOrder() {
    const items = cartItems();
    if (!items.length) return;
    const t = totals(items);
    const nameEl = $('#f-name');
    const name = nameEl.value.trim();

    if (!name) return cartError('اكتب اسمك حتى نعرف صاحب الطلب.', nameEl);
    if (!waNumber()) return cartError('رقم واتساب المكتبة غير مضبوط. أبلغ المكتبة بالمشكلة.');
    if (t.delivery) {
      const addrEl = $('#f-address');
      if (!state.checkout.address.trim()) return cartError('اكتب عنوان التوصيل بالتفصيل.', addrEl);
      if (!state.paid) return cartError('حوّل المبلغ عبر انستاباي أولًا، ثم علّم على «حوّلت المبلغ بالفعل».', $('#f-paid'));
    }

    const url = `https://wa.me/${waNumber()}?text=${encodeURIComponent(buildMessage(items))}`;
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();

    state.sent = true;
    renderView();
    window.scrollTo(0, 0);
  }

  /* ---------- إشعار صغير ونسخ ---------- */

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) { /* لا شيء */ }
      ta.remove();
      return ok;
    }
  }

  /* ---------- الأحداث ---------- */

  function toggleIn(arr, id) {
    const i = arr.indexOf(id);
    if (i === -1) arr.push(id);
    else arr.splice(i, 1);
  }

  const actions = {
    scope(el) {
      state.scope = el.dataset.id;
      renderView();
    },
    filter(el) {
      state.subjectFilter = el.dataset.id;
      document.querySelectorAll('[data-act="filter"]').forEach((b) =>
        b.setAttribute('aria-pressed', String(b.dataset.id === state.subjectFilter))
      );
      renderList();
    },
    'clear-search'() {
      state.search = '';
      renderView('#search');
    },

    // الخطوات الأولى
    'o-grade'(el) {
      toggleIn(state.onb.grades, el.dataset.id);
      el.setAttribute('aria-pressed', String(state.onb.grades.includes(el.dataset.id)));
      $('#onb-next').disabled = state.onb.grades.length === 0;
    },
    'o-subject'(el) {
      const o = state.onb;
      if (el.dataset.id === '*') o.subjects = [];
      else toggleIn(o.subjects, el.dataset.id);
      renderOnboarding(`[data-act="o-subject"][data-id="${CSS.escape(el.dataset.id)}"]`);
    },
    'o-next'() {
      const o = state.onb;
      if (o.step === 1 && !o.grades.length) return;
      if (o.step === 1) {
        const avail = new Set(availableSubjects(o.grades).map((s) => s.id));
        o.subjects = o.subjects.filter((id) => avail.has(id));
      }
      o.step += 1;
      renderOnboarding('#onb-title');
      $('#onb-title').setAttribute('tabindex', '-1');
      $('#onb-title').focus({ preventScroll: true });
    },
    'o-back'() {
      state.onb.step -= 1;
      renderOnboarding();
      $('#onb-title').setAttribute('tabindex', '-1');
      $('#onb-title').focus({ preventScroll: true });
    },
    'o-finish': finishOnboarding,

    // حسابي
    'm-grade'(el) {
      const pr = state.profile;
      const id = el.dataset.id;
      if (pr.grades.includes(id) && pr.grades.length === 1) return toast('اختر صفًا دراسيًا واحدًا على الأقل');
      toggleIn(pr.grades, id);
      const avail = new Set(availableSubjects(pr.grades).map((s) => s.id));
      pr.subjects = pr.subjects.filter((s) => avail.has(s));
      write(KEYS.profile, pr);
      state.subjectFilter = '';
      renderView(`[data-act="m-grade"][data-id="${CSS.escape(id)}"]`);
    },
    'm-subject'(el) {
      const pr = state.profile;
      if (el.dataset.id === '*') pr.subjects = [];
      else toggleIn(pr.subjects, el.dataset.id);
      write(KEYS.profile, pr);
      state.subjectFilter = '';
      renderView(`[data-act="m-subject"][data-id="${CSS.escape(el.dataset.id)}"]`);
    },
    refresh: async () => {
      const r = await loadData();
      if (r.changed) renderView();
      toast(r.ok ? 'القائمة محدّثة' : 'تعذر التحديث. تحقق من الاتصال بالإنترنت');
    },

    // الطلب
    remove(el) {
      toggleCart(el.dataset.id, false);
      renderView();
    },
    'clear-cart'() {
      state.cart.clear();
      write(KEYS.cart, []);
      state.sent = false;
      state.paid = false;
      renderView();
      toast('تم إفراغ الطلب');
    },
    send: sendOrder,
    async copy(el) {
      const ok = await copyText(el.dataset.id);
      toast(ok ? 'تم نسخ العنوان' : 'تعذر النسخ، انسخه يدويًا');
    },

    // التدريبات والتثبيت
    'open-ex'(el) { openExercise(el.dataset.id); },
    'open-install'() {
      if (state.installEvent) runInstall();
      else openInstallSheet();
    },
    install: runInstall,
    'close-overlay': closeOverlay,
    retry() { boot(); },
  };

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    const fn = actions[el.dataset.act];
    if (fn) fn(el, ev);
  });

  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.matches('input[data-add]')) {
      toggleCart(t.dataset.add, t.checked);
    } else if (t.matches('input[name="mode"]')) {
      state.checkout.mode = t.value;
      write(KEYS.checkout, { mode: state.checkout.mode, address: state.checkout.address });
      state.paid = false;
      renderView(`input[name="mode"][value="${t.value}"]`);
    } else if (t.id === 'f-paid') {
      state.paid = t.checked;
      $('#cart-error').hidden = true;
    }
  });

  document.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.id === 'search') {
      state.search = t.value;
      renderList();
    } else if (t.id === 'f-name' || t.id === 'me-name' || t.id === 'onb-name') {
      const v = t.value;
      if (t.id === 'onb-name') state.onb.name = v;
      else {
        state.profile.name = v;
        write(KEYS.profile, state.profile);
      }
      t.classList.remove('invalid');
      const box = $('#cart-error');
      if (box) box.hidden = true;
    } else if (t.id === 'f-address') {
      state.checkout.address = t.value;
      write(KEYS.checkout, { mode: state.checkout.mode, address: t.value });
      t.classList.remove('invalid');
      $('#cart-error').hidden = true;
    }
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && $('#overlay .viewer, #overlay .install-panel')) closeOverlay();
    if (ev.key === 'Enter' && ev.target.id === 'onb-name') {
      ev.preventDefault();
      finishOnboarding();
    }
  });

  /* ---------- التحديث التلقائي ---------- */

  async function refreshQuietly() {
    if (!state.profile || state.onb) return;
    const r = await loadData();
    if (!r.changed) return;
    const a = document.activeElement;
    const typing = a && $('#view').contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName);
    if (state.profile) {
      if (!typing) renderView();
    } else {
      startOnboarding(); // الصفوف المختارة لم تعد موجودة
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - state.loadedAt > 15000) refreshQuietly();
  });
  window.addEventListener('online', refreshQuietly);
  setInterval(() => { if (!document.hidden) refreshQuietly(); }, 60000);

  /* ---------- التشغيل ---------- */

  async function boot() {
    setOverlay('<div class="welcome"><div class="welcome-inner"><p class="tagline" style="margin-top:30vh">جارٍ التحميل…</p></div></div>');
    const r = await loadData();
    if (!r.ok) {
      setOverlay(`
        <div class="welcome"><div class="welcome-inner">
          <div class="step-card" style="margin-top:20vh">
            <h1>تعذر تحميل القائمة</h1>
            <p class="lead">تأكد من اتصالك بالإنترنت ثم حاول مرة أخرى.</p>
            <div class="step-actions single"><button type="button" class="btn block" data-act="retry">إعادة المحاولة</button></div>
          </div>
        </div></div>`);
      return;
    }
    if (!state.profile) {
      startOnboarding();
      return;
    }
    setOverlay('');
    $('#app').hidden = false;
    renderView();
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* يعمل الموقع بدونه */ });
    });
  }

  boot();
})();
