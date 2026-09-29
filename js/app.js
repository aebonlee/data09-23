/*
 * 행복회로 버킷리스트 — 화면
 * 계산은 전부 HCLogic(js/logic.js)이 하고, 여기서는 입력을 받아 시나리오를 고치고 결과를 그립니다.
 * 입력칸(폼)은 index.html 에 고정해 두고, 목록·결과만 다시 그립니다(입력 중 포커스를 잃지 않게).
 */
(function () {
  'use strict';
  var L = window.HCLogic, X = window.HCExamples, Store = window.HCStore;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var money = function (n) { return '<span class="kor">' + esc(L.korWon(n)) + '</span> <span class="exact">' + esc(L.won(n)) + '</span>'; };

  var db, ui = { selMonth: null, editEntryId: null, editBucketId: null, showAll: false, preview: null, undo: null };

  // ── 저장 ──────────────────────────────────────────────────
  function cur() {
    for (var i = 0; i < db.scenarios.length; i++) if (db.scenarios[i].id === db.currentId) return db.scenarios[i];
    db.currentId = db.scenarios[0].id; return db.scenarios[0];
  }
  function save() {
    cur().updatedAt = new Date().toISOString();
    var r = Store.write(db), el = $('saveState');
    if (r === true) { var d = new Date(); el.textContent = '저장됨 ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); el.className = 'save-state'; }
    else { el.textContent = '저장 실패 — ' + r + '. JSON 으로 내보내 두세요.'; el.className = 'save-state bad'; }
  }
  function changed() { save(); render(); }
  function toast(msg, action) {
    var t = $('toast');
    t.innerHTML = esc(msg) + (action ? ' <button type="button" class="btn small" id="toastAct">' + esc(action.label) + '</button>' : '');
    t.hidden = false;
    if (action) $('toastAct').onclick = function () { action.fn(); t.hidden = true; };
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, action ? 7000 : 2500);
  }

  // ── 금액 입력칸 ────────────────────────────────────────────
  // 한글 단위(억·천만·만)를 받아 원 정수로 읽고, 바로 아래에 읽은 값을 보여 줍니다.
  function moneyField(inputId, helpId) {
    var v = L.parseKrw($(inputId).value), help = $(helpId);
    if (!$(inputId).value.trim()) { help.textContent = ''; return { empty: true, value: null }; }
    if (v == null) { help.textContent = '알아볼 수 없는 금액이에요 (예: 150만, 1억 8천만, 2,000,000)'; help.className = 'help bad'; return { value: null }; }
    help.textContent = '= ' + L.won(v) + (v >= 10000 ? ' (' + L.korWon(v) + ')' : ''); help.className = 'help';
    return { value: v };
  }
  function setMoney(inputId, helpId, n) { $(inputId).value = n ? L.comma(n) : (n === 0 ? '0' : ''); moneyField(inputId, helpId); }
  function setErr(id, msg) { var e = $(id); if (e) e.textContent = msg || ''; }

  // ── 당첨 건 폼 ────────────────────────────────────────────
  function fillProducts() {
    $('eProduct').innerHTML = L.PRODUCTS.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + '</option>'; }).join('');
    $('presetRow').innerHTML = '<span class="hint">조합 프리셋:</span> ' + L.PRESETS.map(function (p) {
      return '<button type="button" class="btn small" data-preset="' + p.id + '">' + esc(p.label) + '</button>';
    }).join(' ');
    fillRanks();
  }
  function fillRanks(keepCode) {
    var p = L.product($('eProduct').value);
    $('eRank').innerHTML = p.ranks.map(function (r) { return '<option value="' + r.code + '">' + esc(r.label) + '</option>'; }).join('');
    if (keepCode && L.rank(p.id, keepCode)) $('eRank').value = keepCode;
  }
  // 등수를 고르면 기획서 기준 값으로 채웁니다(수정 중이 아닐 때)
  function applyRankDefaults() {
    var p = L.product($('eProduct').value), r = L.rank(p.id, $('eRank').value), s = cur();
    $('eTitleWrap').hidden = p.id !== 'custom';
    $('ePayoutWrap').hidden = r.payout !== 'either';
    if (r.payout !== 'either') $('ePayout').value = r.payout;
    if (r.gross != null) setMoney('eAmount', 'eAmountHelp', r.gross); else setMoney('eAmount', 'eAmountHelp', null);
    $('eMode').value = 'gross';
    $('eMonths').value = r.months || ($('ePayout').value === 'monthly' ? 12 : '');
    if (!$('eReceipt').value) $('eReceipt').value = s.startMonth;
    if (!$('eFirst').value) $('eFirst').value = s.startMonth;
    syncEntryForm();
  }
  function factText(p, r) {
    if (r.avg) return '로또 1~3등의 최근 52회차 평균값 자동 수집은 2단계예요. 지금은 1게임당 금액을 직접 넣어 주세요. 넣은 금액은 실제 평균이 아니라 가정값으로 다룹니다.';
    if (r.gross == null) return '기획서에 이 등수의 금액이 없어 직접 넣어 주세요. 가정 시나리오로 계산합니다.';
    var t = '기획서 기준 값 · 확인일 ' + L.CHECKED_ON + ': 1' + p.unit + '당 세전 ' + (r.payout === 'monthly' ? '월 ' : '') + L.korWon(r.gross);
    if (r.payout === 'monthly') t += ', ' + r.months + '개월 월 지급';
    return t + '. 실제 금액과 다르면 고쳐 써 주세요.';
  }
  function readEntryForm() {
    var p = L.product($('eProduct').value), r = L.rank(p.id, $('eRank').value);
    var payout = r.payout === 'either' ? $('ePayout').value : r.payout;
    var amt = moneyField('eAmount', 'eAmountHelp');
    var q = $('eQty').value.trim() === '' ? NaN : Number($('eQty').value);
    return {
      id: ui.editEntryId || L.uid('w'), productId: p.id, rankCode: r.code, title: $('eTitle').value.trim(),
      quantity: q, inputMode: $('eMode').value, unitAmount: amt.value == null ? NaN : amt.value,
      payoutType: payout, receiptMonth: $('eReceipt').value, firstPaymentMonth: $('eFirst').value,
      paymentMonths: payout === 'monthly' ? Number($('eMonths').value) : 0,
      round: $('eRound').value.trim(), alias: $('eAlias').value.trim(), game: $('eGame').value.trim(), active: true,
      bundleId: '', presetVersion: '', taxRuleVersion: L.TAX_RULE.version
    };
  }
  function syncEntryForm() {
    var p = L.product($('eProduct').value), r = L.rank(p.id, $('eRank').value);
    var monthly = (r.payout === 'either' ? $('ePayout').value : r.payout) === 'monthly';
    $('eReceiptWrap').hidden = monthly; $('eFirstWrap').hidden = !monthly; $('eMonthsWrap').hidden = !monthly;
    $('eAmountLabel').textContent = '1' + p.unit + '당 ' + ($('eMode').value === 'net' ? '세후' : '세전') + (monthly ? ' 월 지급액' : ' 금액');
    $('eFact').textContent = factText(p, r);
    var e = readEntryForm(), err = L.validateEntry(e);
    setErr('eQtyErr', err.quantity); setErr('eAmountErr', $('eAmount').value.trim() ? err.unitAmount : '');
    setErr('eReceiptErr', err.receiptMonth); setErr('eFirstErr', err.firstPaymentMonth); setErr('eMonthsErr', err.paymentMonths);
    if (!L.ok(err)) { $('eCalc').textContent = '금액·수량을 넣으면 세전 합계, 예상 세금, 세후 합계를 바로 보여 드려요.'; return; }
    var t = L.entryTotals(e), unit = p.unit;
    $('eCalc').innerHTML = e.inputMode === 'net'
      ? '세후 1' + unit + ' ' + esc(L.won(e.unitAmount)) + ' × ' + e.quantity + ' = <strong>세후 ' + (monthly ? '월 ' : '') + esc(L.won(t.net)) + '</strong> (세후 직접 입력이라 세금을 다시 빼지 않아요)'
      : '세전 1' + unit + ' ' + esc(L.won(e.unitAmount)) + ' × ' + e.quantity + ' = ' + esc(L.won(t.gross)) +
        ' · 예상 세금 ' + esc(L.won(t.tax)) + ' · <strong>세후 ' + (monthly ? '월 합계 ' : '합계 ') + esc(L.won(t.net)) + '</strong>' +
        (monthly ? ' · ' + e.paymentMonths + '개월' : '');
  }
  function resetEntryForm() {
    ui.editEntryId = null;
    $('entryFormTitle').textContent = '당첨 건 추가'; $('eSubmit').textContent = '당첨 건 추가'; $('eCancel').hidden = true;
    $('eQty').value = 1; $('eTitle').value = ''; $('eRound').value = ''; $('eAlias').value = ''; $('eGame').value = '';
    $('eReceipt').value = cur().startMonth; $('eFirst').value = cur().startMonth; setErr('eFormErr', '');
    applyRankDefaults();
  }
  function editEntry(id) {
    var e = cur().entries.find(function (x) { return x.id === id; }); if (!e) return;
    ui.editEntryId = id;
    $('eProduct').value = e.productId; fillRanks(e.rankCode);
    $('eTitleWrap').hidden = e.productId !== 'custom'; $('eTitle').value = e.title || '';
    $('ePayoutWrap').hidden = L.rank(e.productId, e.rankCode).payout !== 'either'; $('ePayout').value = e.payoutType;
    $('eQty').value = e.quantity; $('eMode').value = e.inputMode; setMoney('eAmount', 'eAmountHelp', e.unitAmount);
    $('eReceipt').value = e.receiptMonth || cur().startMonth; $('eFirst').value = e.firstPaymentMonth || cur().startMonth;
    $('eMonths').value = e.paymentMonths || '';
    $('eRound').value = e.round || ''; $('eAlias').value = e.alias || ''; $('eGame').value = e.game || '';
    $('entryFormTitle').textContent = '당첨 건 수정'; $('eSubmit').textContent = '수정 저장'; $('eCancel').hidden = false;
    $('entryBox').open = true; syncEntryForm(); $('entryBox').scrollIntoView({ block: 'nearest' });
  }
  function submitEntry(ev) {
    ev.preventDefault();
    var s = cur(), e = readEntryForm(), err = L.validateEntry(e);
    if (!L.ok(err)) { setErr('eFormErr', '입력을 확인해 주세요: ' + err[Object.keys(err)[0]]); return; }
    var others = s.entries.filter(function (x) { return x.id !== e.id; });
    var dup = L.findDuplicateUnit(others, e);
    if (dup) { setErr('eFormErr', '같은 복권·게임(' + [e.round, e.alias, e.game].filter(Boolean).join(' · ') + ')이 이미 「' + L.entryLabel(dup) + '」로 들어 있어요. 한 게임은 가장 높은 등수 하나만 넣어 주세요.'); return; }
    if (!ui.editEntryId && s.entries.length >= L.LIMITS.entries) { setErr('eFormErr', '당첨 행은 100개까지 넣을 수 있어요.'); return; }
    var same = others.find(function (x) { return L.looksSame(x, e); });
    if (same && !ui.editEntryId && !window.confirm('조건이 똑같은 행(' + L.entryLabel(same) + ')이 이미 있어요. 같은 당첨을 두 번 넣은 게 아니라 별도 복권이 맞나요?\n(같은 조건이면 기존 행의 수량을 늘려도 돼요)')) return;
    if (ui.editEntryId) {
      var old = s.entries.find(function (x) { return x.id === e.id; });
      e.active = old.active; e.bundleId = old.bundleId; e.presetVersion = old.presetVersion;
      s.entries[s.entries.indexOf(old)] = e;
    } else s.entries.push(e);
    resetEntryForm(); changed(); toast('당첨 건을 저장했어요.');
  }

  // ── 버킷 폼 ───────────────────────────────────────────────
  function fillBucketSelects() {
    var opt = function (a) { return a.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join(''); };
    $('bCat').innerHTML = opt(L.CATEGORIES); $('bPri').innerHTML = opt(L.PRIORITIES); $('bPri').value = '하고 싶음';
    $('fCat').innerHTML = '<option value="">전체</option>' + opt(L.CATEGORIES);
    $('fPri').innerHTML = '<option value="">전체</option>' + opt(L.PRIORITIES);
  }
  function syncBucketForm() {
    var monthlyKind = $('bKind').value === 'monthly', monthlyMode = L.isMonthlyMode(cur());
    $('bTargetWrap').hidden = monthlyKind; $('bStartWrap').hidden = !monthlyKind; $('bEndWrap').hidden = !monthlyKind;
    $('bKindHint').textContent = monthlyKind
      ? (monthlyMode ? '시작 월과 종료 월을 모두 포함해 매월 빼요.' : '반복 지출은 월별 현금흐름에서 계산돼요. 지금 일시금 화면에는 들어가지 않으니, 매달 드는 돈은 「퇴사 후 월 생활비」에 넣거나 「월별로 보기」를 켜 주세요.')
      : (monthlyMode ? '지출 월에 한 번만 빼요. 미래 월이면 그달부터 잔액이 바뀌어요(예약 지출).' : '일시금 화면에서는 전체 계획에서 한 번 빼요. 지출 월은 월별 보기에서 쓰여요.');
    moneyField('bAmount', 'bAmountHelp');
  }
  function readBucketForm() {
    var amt = moneyField('bAmount', 'bAmountHelp'), kind = $('bKind').value;
    return { id: ui.editBucketId || L.uid('k'), title: $('bTitle').value.trim(), amount: amt.value == null ? NaN : amt.value,
      category: $('bCat').value, priority: $('bPri').value, active: true, kind: kind,
      targetMonth: kind === 'once' ? $('bTarget').value : '', startMonth: kind === 'monthly' ? $('bStart').value : '',
      endMonth: kind === 'monthly' ? $('bEnd').value : '', note: $('bNote').value.trim(), sortOrder: 0 };
  }
  function resetBucketForm() {
    ui.editBucketId = null; $('bucketForm').reset(); $('bPri').value = '하고 싶음';
    $('bTarget').value = cur().startMonth; $('bStart').value = cur().startMonth; $('bEnd').value = L.addMonths(cur().startMonth, 11);
    $('bucketFormTitle').textContent = '버킷 추가'; $('bSubmit').textContent = '버킷 추가'; $('bCancel').hidden = true;
    ['bTitleErr', 'bAmountErr', 'bTargetErr', 'bStartErr', 'bEndErr'].forEach(function (id) { setErr(id, ''); });
    syncBucketForm();
  }
  function editBucket(id) {
    var b = cur().buckets.find(function (x) { return x.id === id; }); if (!b) return;
    ui.editBucketId = id;
    $('bTitle').value = b.title; setMoney('bAmount', 'bAmountHelp', b.amount); $('bKind').value = b.kind;
    $('bTarget').value = b.targetMonth || cur().startMonth; $('bStart').value = b.startMonth || cur().startMonth; $('bEnd').value = b.endMonth || '';
    $('bCat').value = b.category; $('bPri').value = b.priority; $('bNote').value = b.note || '';
    $('bucketFormTitle').textContent = '버킷 수정'; $('bSubmit').textContent = '수정 저장'; $('bCancel').hidden = false;
    $('bucketBox').open = true; syncBucketForm(); $('bucketBox').scrollIntoView({ block: 'nearest' });
  }
  function submitBucket(ev) {
    ev.preventDefault();
    var s = cur(), b = readBucketForm(), err = L.validBucket(b, L.isMonthlyMode(s));
    setErr('bTitleErr', err.title); setErr('bAmountErr', err.amount); setErr('bTargetErr', err.targetMonth); setErr('bStartErr', err.startMonth); setErr('bEndErr', err.endMonth);
    if (!L.ok(err)) return;
    if (ui.editBucketId) {
      var old = s.buckets.find(function (x) { return x.id === b.id; });
      b.active = old.active; b.sortOrder = old.sortOrder; s.buckets[s.buckets.indexOf(old)] = b;
    } else {
      if (s.buckets.length >= L.LIMITS.buckets) { setErr('bTitleErr', '버킷은 500개까지 넣을 수 있어요.'); return; }
      b.sortOrder = s.buckets.reduce(function (m, x) { return Math.max(m, x.sortOrder || 0); }, 0) + 1; s.buckets.push(b);
    }
    resetBucketForm(); changed(); toast('버킷을 저장했어요.');
  }

  // ── 시나리오 ──────────────────────────────────────────────
  function fillSettings() {
    var s = cur();
    $('sTitle').value = s.title; $('sStart').value = s.startMonth; $('sForceMonthly').checked = !!s.forceMonthly;
    setMoney('sCash', 'sCashHelp', s.currentCash); setMoney('sReserve', 'sReserveHelp', s.reserveAmount);
    setMoney('rLiving', 'rLivingHelp', s.living || 0); $('rMonth').value = s.retireMonth || s.startMonth;
    setErr('sCashErr', ''); setErr('sReserveErr', '');
    ui.selMonth = null; ui.preview = null; ui.showAll = false;
    resetEntryForm(); resetBucketForm();
    $('fStart').value = s.startMonth;
  }
  function addScenario(s) { db.scenarios.push(s); db.currentId = s.id; fillSettings(); changed(); }
  function loadExample(id) {
    var s = X[id](); s.id = L.uid('s');
    // 예시의 행 id 는 고정값이라 여러 번 불러와도 겹치지 않게 새로 붙입니다
    s.entries.forEach(function (e) { e.id = L.uid('w'); }); s.buckets.forEach(function (b) { b.id = L.uid('k'); }); s.flows.forEach(function (f) { f.id = L.uid('f'); });
    addScenario(s); toast('예시를 새 시나리오로 불러왔어요.');
  }

  // ── 그리기 ────────────────────────────────────────────────
  function render() {
    var s = cur(), monthly = L.isMonthlyMode(s);
    $('scenarioSel').innerHTML = db.scenarios.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === s.id ? ' selected' : '') + '>' + esc(x.title) + '</option>'; }).join('');
    renderEntries(s); renderBuckets(s, monthly); renderFlows(s, monthly);
    renderResult(s, monthly); renderRetire(s, monthly); renderFuture(s, monthly); drawShare();
    syncBucketForm();
  }
  function examplesButtons() {
    return '<div class="btn-row">' + X.list.map(function (x) { return '<button type="button" class="btn small" data-example="' + x.id + '">예시: ' + esc(x.label) + '</button>'; }).join('') + '</div>';
  }

  function renderEntries(s) {
    var box = $('entryList');
    if (!s.entries.length) { box.innerHTML = '<div class="empty"><p><strong>당첨 건을 추가해 주세요.</strong> 당첨 수입은 지금 0원으로 계산돼요.</p>' + examplesButtons() + '</div>'; $('prizeTotals').innerHTML = ''; return; }
    box.innerHTML = '<ul class="rows">' + s.entries.map(function (e) {
      var err = L.validateEntry(e), bad = !L.ok(err), p = L.product(e.productId);
      var head = '<div class="row-head"><label class="check"><input type="checkbox" data-entry-active="' + esc(e.id) + '"' + (e.active !== false ? ' checked' : '') + '> 계산 포함</label>' +
        '<strong>' + esc(L.entryLabel(e)) + '</strong></div>';
      if (bad) return '<li class="row bad">' + head + '<p class="err">입력 확인 필요 — ' + esc(err[Object.keys(err)[0]]) + ' (계산에서 빠져 있어요)</p>' + entryButtons(e) + '</li>';
      var t = L.entryTotals(e), monthly = e.payoutType === 'monthly';
      var line1 = e.inputMode === 'net' ? '1' + p.unit + '당 세후 ' + L.won(e.unitAmount) + ' (직접 입력)'
        : '1' + p.unit + '당 세전 ' + (monthly ? '월 ' : '') + L.won(e.unitAmount) + ' · 예상 세금 ' + L.won(L.unitTax(e)) + ' · 세후 ' + L.won(L.unitNet(e));
      var line2 = monthly
        ? '세후 월 합계 <strong>' + money(t.net) + '</strong> · ' + esc(L.monthLabel(e.firstPaymentMonth)) + '부터 ' + e.paymentMonths + '개월 (마지막 ' + esc(L.monthLabel(t.endMonth)) + ')'
        : '세후 합계 <strong>' + money(t.net) + '</strong> · ' + esc(L.monthLabel(e.receiptMonth)) + ' 수령';
      return '<li class="row' + (e.active === false ? ' off' : '') + '">' + head + '<p class="small">' + esc(line1) + '</p><p>' + line2 + '</p>' + entryButtons(e) + '</li>';
    }).join('') + '</ul>';
    var pt = L.prizeTotals(s), sim = L.isMonthlyMode(s) ? L.simulate(s) : null;
    var first = sim ? sim.rows[0] : null;
    $('prizeTotals').innerHTML = '<div class="totals">' +
      '<div><span>일시금 합계 (세후)</span><b>' + money(pt.lumpNet) + '</b></div>' +
      (sim ? '<div><span>' + esc(L.monthLabel(s.startMonth)) + ' 연금·당첨 수입</span><b>' + money(first.prizeIncome) + '</b></div>' : '') +
      '</div><details class="sub"><summary>전체 기간 예상 수령 총액 (참고)</summary><p>세후 ' + money(pt.totalNet) +
      (pt.totalGross != null ? ' · 세전 ' + esc(L.won(pt.totalGross)) : '') + '</p><p class="hint">연금은 월액 × 지급개월 수를 모두 더한 명목 합계예요. <strong>현재 잔고나 쓸 수 있는 돈에 더하지 않아요.</strong> 연금은 받는 달에만 잔고에 들어옵니다.</p></details>';
  }
  function entryButtons(e) {
    return '<div class="btn-row"><button type="button" class="btn small" data-entry-edit="' + esc(e.id) + '">수정</button>' +
      '<button type="button" class="btn small" data-entry-copy="' + esc(e.id) + '">복제</button>' +
      '<button type="button" class="btn small ghost" data-entry-del="' + esc(e.id) + '">삭제</button></div>';
  }

  function renderBuckets(s, monthly) {
    var box = $('bucketList');
    if (!s.buckets.length) { box.innerHTML = '<div class="empty"><p><strong>첫 버킷을 추가해 보세요.</strong> 집, 여행, 가족 선물, 휴식… 하고 싶은 것을 비용과 함께 적어 주세요.</p>' + examplesButtons() + '</div>'; $('catTotals').innerHTML = ''; return; }
    var cat = $('fCat').value, pri = $('fPri').value, sort = $('fSort').value;
    var list = s.buckets.filter(function (b) { return (!cat || b.category === cat) && (!pri || b.priority === pri); });
    var mk = function (b) { return b.kind === 'once' ? (b.targetMonth || '9999-99') : b.startMonth; };
    list.sort(function (a, b) {
      if (sort === 'amount') return b.amount - a.amount;
      if (sort === 'month') return mk(a) < mk(b) ? -1 : mk(a) > mk(b) ? 1 : 0;
      return (a.sortOrder || 0) - (b.sortOrder || 0);
    });
    box.innerHTML = (list.length ? '' : '<p class="hint">이 조건에 맞는 버킷이 없어요.</p>') + '<ul class="rows">' + list.map(function (b) {
      var err = L.validBucket(b, monthly), held = b.active === false;
      var when = b.kind === 'once' ? (b.targetMonth ? L.monthLabel(b.targetMonth) + ' 한 번' : '지출 월 없음') : '매월 ' + L.monthLabel(b.startMonth) + '~' + L.monthLabel(b.endMonth);
      var h = '<li class="row' + (held ? ' off' : '') + '"><div class="row-head"><strong>' + esc(b.title) + '</strong>' +
        '<span class="chip">' + esc(b.category) + '</span><span class="chip">' + esc(b.priority) + '</span>' + (held ? '<span class="chip warn">보류 중 · 계산 제외</span>' : '') + '</div>' +
        '<p>' + money(b.amount) + (b.kind === 'monthly' ? ' / 월' : '') + ' · ' + esc(when) + '</p>' +
        (b.note ? '<p class="small">' + esc(b.note) + '</p>' : '') +
        (!L.ok(err) ? '<p class="err">입력 확인 필요 — ' + esc(err[Object.keys(err)[0]]) + ' (계산에서 빠져 있어요)</p>' : '') +
        (!monthly && b.kind === 'monthly' && !held ? '<p class="small">반복 지출이라 일시금 화면 합계에는 들어가지 않아요(월별 보기에서 계산).</p>' : '');
      if (ui.preview === b.id) h += previewHtml(s, b);
      h += '<div class="btn-row">' + (held
        ? '<button type="button" class="btn small primary" data-bucket-toggle="' + esc(b.id) + '">다시 포함</button>'
        : '<button type="button" class="btn small" data-bucket-preview="' + esc(b.id) + '">이거 포기하면?</button><button type="button" class="btn small" data-bucket-toggle="' + esc(b.id) + '">보류</button>') +
        '<button type="button" class="btn small" data-bucket-edit="' + esc(b.id) + '">수정</button>' +
        '<button type="button" class="btn small ghost" data-bucket-del="' + esc(b.id) + '">삭제</button></div></li>';
      return h;
    }).join('') + '</ul>';
    // 카테고리별 합계 — 활성 항목 전체 기준(필터와 무관)
    var sums = {};
    s.buckets.forEach(function (b) { if (b.active !== false && L.ok(L.validBucket(b, monthly)) && (monthly || b.kind === 'once')) sums[b.category] = (sums[b.category] || 0) + b.amount * (b.kind === 'monthly' ? L.monthDiff(b.startMonth, b.endMonth) + 1 : 1); });
    var keys = L.CATEGORIES.filter(function (c) { return sums[c]; });
    $('catTotals').innerHTML = keys.length ? '<p class="small"><b>카테고리별 합계</b>(보류 제외, 반복은 기간 전체): ' + keys.map(function (c) { return esc(c) + ' ' + esc(L.korWon(sums[c])); }).join(' · ') + '</p>' : '';
  }
  function previewHtml(s, b) {
    var p = L.giveUpPreview(s, b.id); if (!p) return '';
    var r = function (m) { return m == null ? '600개월 내 부족 없음' : m + '개월'; };
    var fs = function (m) { return m === 'now' ? '지금' : m ? L.monthLabel(m) : '없음'; };
    var lines = [(p.before.mode === 'lump' ? '계획 후 잔고 ' : p.before.endMonth ? L.monthLabel(p.before.endMonth) + ' 누적 잔액 ' : '') + L.korWon(p.before.B) + ' → ' + L.korWon(p.after.B) + ' (' + (p.gain >= 0 ? '+' : '') + L.korWon(p.gain) + ')',
      '가용잔고 ' + L.korWon(p.before.A) + ' → ' + L.korWon(p.after.A),
      '처음 현금이 부족한 때 ' + fs(p.before.firstShort) + ' → ' + fs(p.after.firstShort),
      '퇴사 가능 기간 ' + r(p.retireBefore) + ' → ' + r(p.retireAfter)];
    return '<div class="preview" role="region" aria-label="포기 비교"><p><b>「' + esc(b.title) + '」을(를) 보류하면</b>' + (b.kind === 'monthly' ? ' (남은 적용 월의 비용만 빠져요)' : '') + '</p><ul>' +
      lines.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul><div class="btn-row">' +
      '<button type="button" class="btn small primary" data-preview-apply="' + esc(b.id) + '">보류 적용</button>' +
      '<button type="button" class="btn small" data-preview-cancel="1">취소</button></div><p class="small">적용하기 전에는 원래 계획이 그대로예요.</p></div>';
  }

  function renderFlows(s, monthly) {
    $('fStopWrap').hidden = $('fDir').value !== 'in';
    var note = monthly ? '' : '<p class="note">지금은 일시금 화면이라 계산에 들어가지 않아요. 「월별로 보기」를 켜거나 연금 당첨을 넣으면 반영돼요.</p>';
    $('flowList').innerHTML = note + (s.flows.length ? '<ul class="rows">' + s.flows.map(function (f) {
      return '<li class="row"><div class="row-head"><strong>' + esc(f.title) + '</strong><span class="chip">' + (f.direction === 'in' ? '수입' : '고정지출') + '</span>' + (f.stopOnRetirement ? '<span class="chip">퇴사하면 멈춤</span>' : '') + '</div>' +
        '<p>월 ' + money(f.amount) + ' · ' + esc(L.monthLabel(f.startMonth)) + '~' + (f.endMonth ? esc(L.monthLabel(f.endMonth)) : '계속') + '</p>' +
        '<div class="btn-row"><button type="button" class="btn small ghost" data-flow-del="' + esc(f.id) + '">삭제</button></div></li>';
    }).join('') + '</ul>' : '');
  }

  function card(label, n, cls, sub) {
    return '<div class="card ' + (cls || '') + '"><span class="card-label">' + esc(label) + '</span><span class="card-num">' + esc(L.korWon(n)) + '</span><span class="exact">' + esc(L.won(n)) + (sub ? ' · ' + esc(sub) : '') + '</span></div>';
  }
  function warnBox(w) { return w ? '<div class="warn-box lvl-' + w.level + '" role="alert"><b>' + ({ short: '현금 부족', vault: '안전금고 침범', deficit: '월 적자', low: '낮은 여유' })[w.level] + '</b> ' + esc(w.text) + '</div>' : '<div class="warn-box lvl-ok"><b>여유</b> 이 계획은 지금 안전금고를 지켜요.</div>'; }

  function renderResult(s, monthly) {
    if (!monthly) {
      $('hResult').textContent = '남은 예산 (일시금)';
      var l = L.lumpSummary(s);
      var total = Math.max(l.afterWin, 1), pct = function (n) { return Math.max(0, Math.min(100, n / total * 100)).toFixed(1) + '%'; };
      $('result').innerHTML = '<div class="cards">' + card('세후 당첨금', l.N, '', '세전에서 예상 세금을 뺀 값') + card('당첨 후 잔고', l.afterWin) +
        card('버킷 합계', l.bucketTotal, '', '보류 제외') + card('계획 후 잔고', l.B, l.B < 0 ? 'neg' : '') + card('안전금고', l.S) + card('가용잔고', l.A, l.A < 0 ? 'neg' : 'pos', '계획 후 잔고 − 안전금고') + '</div>' +
        '<div class="bar" aria-hidden="true"><span class="bar-bucket" style="width:' + pct(l.bucketTotal) + '"></span><span class="bar-vault" style="width:' + pct(Math.min(l.S, Math.max(l.B, 0))) + '"></span><span class="bar-free" style="width:' + pct(Math.max(l.A, 0)) + '"></span></div>' +
        '<p class="small legend"><span class="lg lg-bucket"></span>버킷 <span class="lg lg-vault"></span>안전금고 <span class="lg lg-free"></span>가용 — 당첨 후 잔고 기준</p>' +
        warnBox(L.lumpWarning(l)) +
        (l.heldTotal ? '<p class="small">보류한 버킷 ' + esc(L.korWon(l.heldTotal)) + '은(는) 계산에서 빠져 있어요.</p>' : '') +
        (l.monthlyBucketsIgnored ? '<p class="small">반복 버킷 ' + l.monthlyBucketsIgnored + '개는 일시금 화면에 들어가지 않아요(월별 보기에서 계산).</p>' : '');
      return;
    }
    $('hResult').textContent = '선택 월 결과 (월별 현금흐름)';
    var sim = L.simulate(s), v = L.viewRange(s);
    if (!ui.selMonth || L.monthDiff(s.startMonth, ui.selMonth) < 0 || L.monthDiff(s.startMonth, ui.selMonth) >= L.LIMIT_MONTHS) ui.selMonth = s.startMonth;
    var i = L.monthDiff(s.startMonth, ui.selMonth), row = sim.rows[i], next = sim.rows[i + 1];
    var firstShort = L.firstMonth(sim.rows, function (r) { return r.closing < 0; });
    var firstVault = L.firstMonth(sim.rows, function (r) { return r.available < 0; });
    var es = L.activeEntries(s);
    var comp = es.map(function (e) { return L.entryLabel(e); }).join(' + ') || '당첨 건 없음';
    var detail = es.map(function (e) {
      var ps = L.paymentStatus(e, ui.selMonth), paid = row.payments.filter(function (p) { return p.entryId === e.id; }).reduce(function (a, p) { return a + p.amount; }, 0);
      if (!ps) return '<li>' + esc(L.entryLabel(e)) + ' — 일시금 ' + esc(L.monthLabel(e.receiptMonth)) + ' 수령' + (paid ? ', 이번 달 ' + esc(L.won(paid)) : '') + '</li>';
      return '<li>' + esc(L.entryLabel(e)) + ' — 이번 달 ' + esc(L.won(paid)) + ' · 남은 지급 ' + ps.remainingIncl + '회(이번 달 포함), 지급 후 ' + ps.remainingAfter + '회 · 마지막 ' + esc(L.monthLabel(ps.endMonth)) + '</li>';
    }).join('');
    var pt = L.prizeTotals(s);
    $('result').innerHTML =
      '<div class="month-nav"><button type="button" class="btn small" data-month-step="-1" aria-label="이전 달">이전 달</button>' +
      '<label class="sr" for="selMonth">선택 월</label><input type="month" id="selMonth" value="' + esc(ui.selMonth) + '" min="' + s.startMonth + '" max="' + L.addMonths(s.startMonth, L.LIMIT_MONTHS - 1) + '">' +
      '<button type="button" class="btn small" data-month-step="1" aria-label="다음 달">다음 달</button>' +
      (firstShort || firstVault ? '<button type="button" class="btn small warnbtn" data-month-go="' + (firstShort || firstVault) + '">첫 부족 월로</button>' : '') + '</div>' +
      '<p class="compo"><b>' + esc(comp) + '</b><br>' + esc(L.monthLabel(ui.selMonth)) + ' 세후 당첨 수령 ' + money(row.prizeIncome) + '</p>' +
      '<div class="cards">' + card('이번 달 수입', row.prizeIncome + row.otherIncome) + card('이번 달 지출', row.fixedExpense + row.bucketExpense, '', '고정 ' + L.korWon(row.fixedExpense) + ' · 버킷 ' + L.korWon(row.bucketExpense)) +
      card('월 잔여금', row.surplus, row.surplus < 0 ? 'neg' : '') + card('누적 잔액', row.closing, row.closing < 0 ? 'neg' : '') + card('안전금고', s.reserveAmount) +
      card('가용잔고', row.available, row.available < 0 ? 'neg' : 'pos', '누적 잔액 − 안전금고') + '</div>' +
      warnBox(L.warningOf(row, next ? next.fixedExpense : null)) +
      '<p class="small">월 단위 예산 모델이에요. 한 달 수입과 지출을 합쳐 월말 잔액을 봅니다(지급일 전 지출 같은 월중 부족은 판단하지 않아요). 미래 연금은 당겨 쓰지 않아요.</p>' +
      (es.length ? '<details class="sub"><summary>당첨 건별 이번 달 금액과 지급 잔여</summary><ul class="plain">' + detail + '</ul></details>' : '<p class="note">당첨 건을 추가해 주세요.</p>') +
      '<details class="sub"><summary>전체 기간 예상 수령 총액 (참고 · 잔고에 더하지 않음)</summary><p>세후 ' + money(pt.totalNet) + '</p><p class="small">조회 기간(' + esc(L.monthLabel(v.start)) + '~' + esc(L.monthLabel(v.end)) + ') 수령 합계 ' +
      esc(L.won(sim.rows.slice(0, v.months).reduce(function (a, r) { return a + r.prizeIncome; }, 0))) + '</p></details>' +
      (sim.before.length ? '<p class="small">시작 월 전에 받은 일시금 ' + sim.before.length + '건은 현재 잔고에 들어 있는 것으로 보고 다시 넣지 않아요.</p>' : '') +
      (sim.outside.length ? '<p class="small">계산 범위(600개월) 밖 또는 시작 월 전 예정 ' + sim.outside.length + '건 — 현재 조회 합계에서 빠져 있어요.</p>' : '');
  }

  function renderRetire(s, monthly) {
    $('rMonthWrap').hidden = !monthly;
    var liv = L.parseKrw($('rLiving').value) || 0;
    var r = L.retireMonths(s, monthly ? $('rMonth').value : '', liv);
    var fmt = function (m) { return m == null ? '600개월 내 부족 없음' : m + '개월' + (m >= 12 ? ' (약 ' + Math.floor(m / 12) + '년 ' + (m % 12) + '개월)' : ''); };
    var how = monthly
      ? '퇴사 시작 월부터 「퇴사하면 멈춤」 수입을 0으로 바꾸고, 월 생활비를 더해 다시 계산했어요. 연금·일시금·고정지출·예정 버킷은 그대로예요.'
      : '버킷을 뺀 뒤의 잔고로 시작해 매달 생활비만 쓴다고 가정했어요. 이미 뺀 버킷은 다시 빼지 않아요.';
    $('retireOut').innerHTML = '<div class="big-line">안전금고를 지키며 <b>' + esc(fmt(r.months)) + '</b></div>' +
      '<p class="small">현금만 기준으로는 ' + esc(fmt(r.cashMonths)) + '. ' + esc(how) + (liv === 0 && !monthly ? ' 월 생활비를 넣으면 기간을 계산해요.' : '') +
      (r.months == null ? ' 600개월 안에 부족이 없다는 뜻이지 영원히 괜찮다는 뜻은 아니에요.' : '') + '</p>';
  }

  // 누적 잔액 그래프 + 표(같은 내용). 첫 부족 월과 연금 종료 월을 표시합니다.
  function renderFuture(s, monthly) {
    var box = $('future');
    if (!monthly) { box.innerHTML = '<p class="note">월별 현금흐름은 연금 당첨이 있거나 일시금 수령 월이 다를 때, 또는 「일시금만 있어도 월별 현금흐름으로 보기」를 켜면 보여요.</p>'; return; }
    var sim = L.simulate(s), v = L.viewRange(s), rows = sim.rows.slice(0, v.months);
    var ends = {};
    L.activeEntries(s).forEach(function (e) { if (e.payoutType === 'monthly') ends[L.addMonths(e.firstPaymentMonth, e.paymentMonths - 1)] = 1; });
    var firstShort = L.firstMonth(rows, function (r) { return r.closing < 0; });
    var W = 640, H = 240, pad = 44, vals = rows.map(function (r) { return r.closing; }).concat([s.reserveAmount, 0]);
    var max = Math.max.apply(null, vals), min = Math.min.apply(null, vals); if (max === min) max = min + 1;
    var x = function (i) { return pad + (W - pad - 8) * (rows.length === 1 ? 0 : i / (rows.length - 1)); };
    var y = function (n) { return 10 + (H - 40) * (1 - (n - min) / (max - min)); };
    var pts = rows.map(function (r, i) { return x(i).toFixed(1) + ',' + y(r.closing).toFixed(1); }).join(' ');
    var marks = '';
    rows.forEach(function (r, i) {
      if (ends[r.month]) marks += '<line x1="' + x(i) + '" x2="' + x(i) + '" y1="10" y2="' + (H - 30) + '" class="g-end"/><text x="' + (x(i) - 4) + '" y="22" class="g-lbl" text-anchor="end">지급 종료 ' + r.month + '</text>';
    });
    if (firstShort) { var fi = L.monthDiff(s.startMonth, firstShort); marks += '<circle cx="' + x(fi) + '" cy="' + y(rows[fi].closing) + '" r="5" class="g-short"/><text x="' + (x(fi) + 8) + '" y="' + (y(rows[fi].closing) + 4) + '" class="g-lbl">첫 부족 ' + firstShort + '</text>'; }
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" role="img" aria-label="누적 잔액 그래프 — 아래 표와 같은 내용">' +
      '<line x1="' + pad + '" x2="' + (W - 8) + '" y1="' + y(0) + '" y2="' + y(0) + '" class="g-zero"/>' +
      '<line x1="' + pad + '" x2="' + (W - 8) + '" y1="' + y(s.reserveAmount) + '" y2="' + y(s.reserveAmount) + '" class="g-vault"/>' +
      '<polyline points="' + pts + '" class="g-line"/>' + marks +
      '<text x="4" y="' + (y(max) + 4) + '" class="g-lbl">' + esc(L.korWon(max)) + '</text><text x="4" y="' + (y(min) + 4) + '" class="g-lbl">' + esc(L.korWon(min)) + '</text>' +
      '<text x="' + pad + '" y="' + (H - 8) + '" class="g-lbl">' + rows[0].month + '</text><text x="' + (W - 8) + '" y="' + (H - 8) + '" class="g-lbl" text-anchor="end">' + rows[rows.length - 1].month + '</text></svg>' +
      '<p class="small legend"><span class="lg lg-line"></span>누적 잔액 <span class="lg lg-vaultline"></span>안전금고 기준선 <span class="lg lg-end"></span>연금 지급 종료</p>';
    var shown = ui.showAll ? rows : rows.slice(0, 24);
    var status = function (r) { return r.closing < 0 ? '현금 부족' : r.available < 0 ? '안전금고 침범' : r.surplus < 0 ? '월 적자' : ''; };
    var tbl = '<div class="table-wrap"><table class="flow"><caption class="sr">월별 수입·지출·잔액 (원)</caption><thead><tr><th scope="col">월</th><th scope="col">수입</th><th scope="col">고정지출</th><th scope="col">버킷</th><th scope="col">월 잔여</th><th scope="col">누적 잔액</th><th scope="col">가용잔고</th><th scope="col">상태</th></tr></thead><tbody>' +
      shown.map(function (r) {
        var st = status(r);
        return '<tr class="' + (r.month === ui.selMonth ? 'sel ' : '') + (st ? 'st-bad' : '') + (ends[r.month] ? ' st-end' : '') + '" data-row-month="' + r.month + '"><th scope="row"><button type="button" class="linkbtn" data-month-go="' + r.month + '">' + r.month + '</button></th><td>' + L.comma(r.prizeIncome + r.otherIncome) + '</td><td>' + L.comma(r.fixedExpense) + '</td><td>' + L.comma(r.bucketExpense) + '</td><td>' + L.comma(r.surplus) + '</td><td>' + L.comma(r.closing) + '</td><td>' + L.comma(r.available) + '</td><td>' + esc(st) + (ends[r.month] ? (st ? ' · ' : '') + '지급 종료' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      (rows.length > 24 ? '<button type="button" class="btn small" id="btnShowAll">' + (ui.showAll ? '처음 24개월만 보기' : '전체 ' + rows.length + '개월 보기') + '</button>' : '');
    box.innerHTML = svg + '<p class="small">조회 기간 ' + esc(L.monthLabel(v.start)) + '~' + esc(L.monthLabel(v.end)) + ' (마지막 지급·지출 월 이후 12개월, 한도 600개월). 월을 누르면 위 결과가 그달로 바뀌어요.</p>' + tbl;
  }

  // ── 공유 이미지 ───────────────────────────────────────────
  function shareOn(k) { var el = document.querySelector('[data-share="' + k + '"]'); return el && el.checked; }
  function drawShare() {
    var cv = $('shareCanvas'), c = cv.getContext && cv.getContext('2d'); if (!c) return;
    var s = cur(), monthly = L.isMonthlyMode(s), W = cv.width, y = 90;
    c.fillStyle = '#fbf8ff'; c.fillRect(0, 0, W, cv.height);
    c.fillStyle = '#6b3fa0'; c.fillRect(0, 0, W, 16);
    var font = function (px, bold) { c.font = (bold ? '700 ' : '400 ') + px + 'px "Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif'; };
    var line = function (t, px, bold, color) {
      font(px, bold); c.fillStyle = color || '#1d1830';
      var words = String(t).split(' '), cur2 = '';
      words.forEach(function (w) { var test = cur2 ? cur2 + ' ' + w : w; if (c.measureText(test).width > W - 120 && cur2) { c.fillText(cur2, 60, y); y += px * 1.4; cur2 = w; } else cur2 = test; });
      if (cur2) { c.fillText(cur2, 60, y); y += px * 1.4; }
    };
    line('행복회로 버킷리스트', 56, true, '#6b3fa0');
    line(s.title, 36, true);
    line('가상 시뮬레이션 — 실제 당첨·계좌·재무 조언이 아닙니다', 28, false, '#8a2a2a');
    y += 16;
    if (shareOn('wins')) {
      var es = L.activeEntries(s), pt = L.prizeTotals(s);
      line('당첨 구성', 32, true);
      es.slice(0, 6).forEach(function (e) { var t = L.entryTotals(e); line('· ' + L.entryLabel(e) + ' — 세후 ' + (e.payoutType === 'monthly' ? '월 ' : '') + L.korWon(t.net), 28); });
      if (es.length > 6) line('· 외 ' + (es.length - 6) + '건', 28);
      if (!es.length) line('· 당첨 건 없음', 28);
      line('일시금 세후 합계 ' + L.korWon(pt.lumpNet), 28);
      y += 12;
    }
    if (shareOn('buckets')) {
      var bs = s.buckets.filter(function (b) { return b.active !== false; });
      line('버킷리스트', 32, true);
      bs.slice(0, 8).forEach(function (b) { line('· ' + b.title + ' ' + L.korWon(b.amount) + (b.kind === 'monthly' ? '/월' : '') + (shareOn('memo') && b.note ? ' (' + b.note + ')' : ''), 28); });
      if (bs.length > 8) line('· 외 ' + (bs.length - 8) + '개', 28);
      if (!bs.length) line('· 아직 없음', 28);
      y += 12;
    }
    if (shareOn('result')) {
      line(monthly ? '선택 월 결과' : '남은 예산', 32, true);
      if (monthly) {
        var sim = L.simulate(s), i = Math.max(0, L.monthDiff(s.startMonth, ui.selMonth || s.startMonth)), r = sim.rows[i];
        line(L.monthLabel(r.month) + ' 수입 ' + L.korWon(r.prizeIncome + r.otherIncome) + ' · 지출 ' + L.korWon(r.fixedExpense + r.bucketExpense), 28);
        line('월 잔여 ' + L.korWon(r.surplus) + ' · 가용잔고 ' + L.korWon(r.available), 28);
      } else {
        var l = L.lumpSummary(s);
        line('버킷 합계 ' + L.korWon(l.bucketTotal) + ' · 가용잔고 ' + L.korWon(l.A), 28);
      }
    }
    if (shareOn('cash')) { y += 8; line('현재 잔고 ' + L.korWon(s.currentCash) + ' · 안전금고 ' + L.korWon(s.reserveAmount), 28); }
    font(24); c.fillStyle = '#6b6480'; c.fillText('세금은 기획서 산식의 추정치 · 만든 날 ' + new Date().toISOString().slice(0, 10), 60, cv.height - 50);
  }

  // ── 이벤트 ────────────────────────────────────────────────
  function bind() {
    $('eProduct').addEventListener('change', function () { fillRanks(); applyRankDefaults(); });
    $('eRank').addEventListener('change', applyRankDefaults);
    $('ePayout').addEventListener('change', function () { if (!$('eMonths').value) $('eMonths').value = 12; syncEntryForm(); });
    ['eQty', 'eMode', 'eAmount', 'eReceipt', 'eFirst', 'eMonths'].forEach(function (id) { $(id).addEventListener('input', syncEntryForm); $(id).addEventListener('change', syncEntryForm); });
    $('entryForm').addEventListener('submit', submitEntry);
    $('eCancel').addEventListener('click', resetEntryForm);

    $('bKind').addEventListener('change', syncBucketForm);
    $('bAmount').addEventListener('input', function () { moneyField('bAmount', 'bAmountHelp'); });
    $('bucketForm').addEventListener('submit', submitBucket);
    $('bCancel').addEventListener('click', resetBucketForm);
    ['fCat', 'fPri', 'fSort'].forEach(function (id) { $(id).addEventListener('change', function () { renderBuckets(cur(), L.isMonthlyMode(cur())); }); });

    $('fDir').addEventListener('change', function () { $('fStopWrap').hidden = $('fDir').value !== 'in'; });
    $('fAmount').addEventListener('input', function () { moneyField('fAmount', 'fAmountHelp'); });
    $('flowForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var s = cur(), f = { id: L.uid('f'), direction: $('fDir').value, title: $('fTitle').value.trim(), amount: L.parseKrw($('fAmount').value),
        startMonth: $('fStart').value, endMonth: $('fEnd').value, stopOnRetirement: $('fDir').value === 'in' && $('fStop').checked };
      if (f.amount == null) f.amount = NaN;
      var err = L.validFlow(f);
      if (!L.ok(err)) { setErr('fErr', err[Object.keys(err)[0]]); return; }
      if (s.flows.length >= L.LIMITS.flows) { setErr('fErr', '500개까지 넣을 수 있어요.'); return; }
      setErr('fErr', ''); s.flows.push(f); $('fTitle').value = ''; $('fAmount').value = ''; moneyField('fAmount', 'fAmountHelp'); $('fEnd').value = '';
      changed();
    });

    // 시나리오 설정
    $('sTitle').addEventListener('input', function () { cur().title = $('sTitle').value.trim() || '이름 없는 시나리오'; changed(); });
    $('sStart').addEventListener('change', function () { if (L.isMonth($('sStart').value)) { cur().startMonth = $('sStart').value; ui.selMonth = null; changed(); } });
    $('sForceMonthly').addEventListener('change', function () { cur().forceMonthly = $('sForceMonthly').checked; changed(); });
    // 금액은 입력하는 대로 바로 다시 계산합니다(칸을 떠날 때 다시 그리면 목록 단추의 첫 클릭이 사라짐)
    $('sCash').addEventListener('input', function () {
      var m = moneyField('sCash', 'sCashHelp'); if (m.empty) m.value = 0;
      if (m.value == null || m.value > L.LIMITS.amountMax) { setErr('sCashErr', '0원 이상 1조원 이하로 넣어 주세요. 이 값은 계산에 넣지 않았어요.'); return; }
      setErr('sCashErr', ''); cur().currentCash = m.value; changed();
    });
    $('sReserve').addEventListener('input', function () {
      var m = moneyField('sReserve', 'sReserveHelp'), s = cur(); if (m.empty) m.value = 0;
      if (m.value == null) { setErr('sReserveErr', '0원 이상으로 넣어 주세요. 이 값은 계산에 넣지 않았어요.'); return; }
      var lim = L.reserveLimit(s);
      if (m.value > lim) { setErr('sReserveErr', '안전금고는 처음 쓸 수 있는 현금(' + L.korWon(lim) + ')보다 크게 둘 수 없어요.'); return; }
      setErr('sReserveErr', ''); s.reserveAmount = m.value; changed();
    });
    $('rLiving').addEventListener('input', function () { var m = moneyField('rLiving', 'rLivingHelp'); if (m.value == null && !m.empty) return; cur().living = m.value || 0; changed(); });
    $('rMonth').addEventListener('change', function () { cur().retireMonth = $('rMonth').value; changed(); });

    $('scenarioSel').addEventListener('change', function () { db.currentId = $('scenarioSel').value; fillSettings(); changed(); });
    $('btnNew').addEventListener('click', function () { addScenario(L.newScenario({ title: '새 시나리오 ' + (db.scenarios.length + 1), startMonth: L.thisMonth() })); });
    $('btnCopy').addEventListener('click', function () { var c = L.clone(cur()); c.id = L.uid('s'); c.title = cur().title + ' (복제)'; c.entries.forEach(function (e) { e.id = L.uid('w'); }); c.buckets.forEach(function (b) { b.id = L.uid('k'); }); c.flows.forEach(function (f) { f.id = L.uid('f'); }); addScenario(c); });
    $('btnDelScenario').addEventListener('click', function () {
      if (!window.confirm('「' + cur().title + '」 시나리오와 그 안의 당첨·버킷·고정지출을 모두 지울까요?')) return;
      db.scenarios = db.scenarios.filter(function (x) { return x.id !== db.currentId; });
      if (!db.scenarios.length) db.scenarios.push(L.newScenario());
      db.currentId = db.scenarios[0].id; fillSettings(); changed();
    });
    $('btnReset').addEventListener('click', function () {
      if (!window.confirm('이 브라우저에 저장된 시나리오 ' + db.scenarios.length + '개를 모두 지워요. 내보내지 않은 내용은 되살릴 수 없어요. 지울까요?')) return;
      Store.clear(); db = { schemaVersion: L.SCHEMA_VERSION, currentId: null, scenarios: [L.newScenario()] }; db.currentId = db.scenarios[0].id; fillSettings(); changed();
    });
    $('btnExport').addEventListener('click', function () {
      var blob = new Blob([JSON.stringify({ app: 'data09-23', schemaVersion: L.SCHEMA_VERSION, exportedAt: new Date().toISOString(), scenarios: db.scenarios }, null, 2)], { type: 'application/json' });
      download(blob, '행복회로_시나리오_' + new Date().toISOString().slice(0, 10) + '.json');
    });
    $('importFile').addEventListener('change', function () {
      var f = this.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        var list, errs = [];
        try { var o = JSON.parse(rd.result); list = Array.isArray(o.scenarios) ? o.scenarios : [o]; } catch (e) { setErr('importErr', 'JSON 파일을 읽지 못했어요.'); return; }
        var good = [];
        list.forEach(function (s, i) { var e = L.checkScenario(s); if (e.length) errs.push((s && s.title ? '「' + s.title + '」' : (i + 1) + '번째') + ': ' + e.slice(0, 3).join(', ')); else good.push(s); });
        if (!good.length) { setErr('importErr', '가져올 수 있는 시나리오가 없어요 — ' + errs.join(' / ')); return; }
        good.forEach(function (s) { if (db.scenarios.some(function (x) { return x.id === s.id; })) s.id = L.uid('s'); db.scenarios.push(s); });
        db.currentId = good[good.length - 1].id; setErr('importErr', errs.length ? '일부는 건너뛰었어요 — ' + errs.join(' / ') : '');
        fillSettings(); changed(); toast('시나리오 ' + good.length + '개를 가져왔어요.');
      };
      rd.readAsText(f); this.value = '';
    });
    $('shareOpts').addEventListener('change', drawShare);
    $('btnShareSave').addEventListener('click', function () {
      drawShare();
      $('shareCanvas').toBlob(function (b) { if (b) download(b, '행복회로_' + new Date().toISOString().slice(0, 10) + '.png'); else toast('이 브라우저에서는 이미지를 만들 수 없어요.'); }, 'image/png');
    });
    $('btnPrint').addEventListener('click', function () { window.print(); });
    $('fabBucket').addEventListener('click', function () { $('bucketBox').open = true; $('bucketBox').scrollIntoView({ block: 'start' }); $('bTitle').focus(); });

    // 목록 안 단추들(위임)
    document.addEventListener('click', function (ev) {
      var t = ev.target.closest('button'); if (!t) return;
      var s = cur(), d = t.dataset, idx;
      if (d.example) loadExample(d.example);
      else if (d.preset) {
        var es = L.presetEntries(d.preset, s.startMonth);
        if (s.entries.length + es.length > L.LIMITS.entries) { toast('당첨 행은 100개까지예요.'); return; }
        s.entries = s.entries.concat(es); changed(); toast('프리셋을 추가했어요. 첫 지급 월은 행마다 고칠 수 있어요.');
      }
      else if (d.entryEdit) editEntry(d.entryEdit);
      else if (d.entryCopy) { var o = s.entries.find(function (x) { return x.id === d.entryCopy; }); if (o && s.entries.length < L.LIMITS.entries) { var c = L.clone(o); c.id = L.uid('w'); c.alias = ''; s.entries.splice(s.entries.indexOf(o) + 1, 0, c); changed(); } }
      else if (d.entryDel) { idx = s.entries.findIndex(function (x) { return x.id === d.entryDel; }); var gone = s.entries.splice(idx, 1)[0]; if (ui.editEntryId === gone.id) resetEntryForm(); changed(); toast('당첨 건을 지웠어요.', { label: '되돌리기', fn: function () { s.entries.splice(idx, 0, gone); changed(); } }); }
      else if (d.bucketEdit) editBucket(d.bucketEdit);
      else if (d.bucketToggle) { var b = s.buckets.find(function (x) { return x.id === d.bucketToggle; }); b.active = b.active === false; ui.preview = null; changed(); }
      else if (d.bucketPreview) { ui.preview = ui.preview === d.bucketPreview ? null : d.bucketPreview; renderBuckets(s, L.isMonthlyMode(s)); }
      else if (d.previewApply) { s.buckets.find(function (x) { return x.id === d.previewApply; }).active = false; ui.preview = null; changed(); toast('보류했어요. 「다시 포함」으로 되돌릴 수 있어요.'); }
      else if (d.previewCancel) { ui.preview = null; renderBuckets(s, L.isMonthlyMode(s)); }
      else if (d.bucketDel) {
        idx = s.buckets.findIndex(function (x) { return x.id === d.bucketDel; }); var gb = s.buckets.splice(idx, 1)[0];
        if (ui.editBucketId === gb.id) resetBucketForm(); ui.preview = null; changed();
        toast('「' + gb.title + '」을(를) 지웠어요.', { label: '되돌리기', fn: function () { s.buckets.splice(idx, 0, gb); changed(); } });
      }
      else if (d.flowDel) { s.flows = s.flows.filter(function (x) { return x.id !== d.flowDel; }); changed(); }
      else if (d.monthStep) { ui.selMonth = L.addMonths(ui.selMonth || s.startMonth, +d.monthStep); render(); }
      else if (d.monthGo) { ui.selMonth = d.monthGo; render(); $('secResult').scrollIntoView({ block: 'start' }); }
      else if (t.id === 'btnShowAll') { ui.showAll = !ui.showAll; renderFuture(s, L.isMonthlyMode(s)); }
    });
    document.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t.dataset && t.dataset.entryActive) { var e = cur().entries.find(function (x) { return x.id === t.dataset.entryActive; }); e.active = t.checked; changed(); }
      else if (t.id === 'selMonth' && L.isMonth(t.value)) { ui.selMonth = t.value; render(); }
    });
  }
  function download(blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function init() {
    db = Store.read();
    if (!db || !db.scenarios.length) { db = { schemaVersion: L.SCHEMA_VERSION, currentId: null, scenarios: [L.newScenario()] }; db.currentId = db.scenarios[0].id; }
    fillProducts(); fillBucketSelects(); bind(); fillSettings(); render();
    var r = Store.write(db);
    $('saveState').textContent = r === true ? '이 브라우저에 자동 저장' : '저장 안 됨 — ' + r;
    if (r !== true) $('saveState').className = 'save-state bad';
  }
  init();
})();
