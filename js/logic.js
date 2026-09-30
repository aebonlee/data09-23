/*
 * 행복회로 버킷리스트 — 순수 계산 모듈 (화면·저장소와 무관)
 * 브라우저에서는 window.HCLogic, Node(테스트)에서는 module.exports 로 씁니다.
 * ES module 이 아닌 이유: index.html 을 로컬 파일(file://)로 열었을 때
 * 브라우저가 module 스크립트를 막기 때문입니다.
 *
 * 모든 금액은 원 단위 정수, 월은 'YYYY-MM' 입니다(기획서 8장).
 * 식과 기준값은 수강생 기획서 v1.1(docs/source/)의 것만 씁니다.
 *
 *   세금(2장)   G ≤ 2,000,000 → T = 0
 *               2,000,000 < G ≤ 300,000,000 → T = G × 0.22
 *               G > 300,000,000 → T = 66,000,000 + (G − 300,000,000) × 0.33
 *               세후 N = G − round(T)      ※ 과세 단위(게임·낱장)마다 따로
 *   연금 월액   세전 월액 × (1 − 0.22), 월 100만원에도 비과세 규칙을 쓰지 않음
 *   월별(4장)   Iₜ = 당첨 수령 + 기타 수입 · Fₜ = 고정지출 · Qₜ = 버킷
 *               Rₜ = Iₜ − Fₜ − Qₜ · Bₜ = Bₜ₋₁ + Rₜ (B₋₁ = C₀) · Aₜ = Bₜ − S
 *   연금 20년 총액은 참고 정보일 뿐 잔고에 더하지 않습니다.
 */
(function (root) {
  'use strict';

  var SCHEMA_VERSION = 2;
  var CHECKED_ON = '2026-09-29';      // 기획서의 공식 자료 확인 기준일
  var LIMIT_MONTHS = 600;             // 계산 한도 (기획서 4장)
  var LIMITS = { amountMax: 1000000000000, entries: 100, qtyMax: 100, buckets: 500, flows: 500 };

  // 세율 설정 — 버전으로 관리(기획서 2장·8장 TaxRule)
  var TAX_RULE = {
    version: 'v1-2026-09-29',
    exemptThreshold: 2000000,
    tierLimit: 300000000,
    tierBase: 66000000,
    rateLow: 22,      // %
    rateHigh: 33,     // %
    annuityRate: 22   // %
  };

  // 상품·등수 초기값 — 기획서 2장 표(지원 상품과 초기값·등수별 지급 설정)에 적힌 값만.
  // gross: null 이면 기획서에 값이 없어 사용자가 직접 입력합니다.
  var PRODUCTS = [
    { id: 'lotto', name: '로또 6/45', unit: '게임', ranks: [
      { code: '1', label: '1등', payout: 'lump', gross: null, avg: true },
      { code: '2', label: '2등', payout: 'lump', gross: null, avg: true },
      { code: '3', label: '3등', payout: 'lump', gross: null, avg: true },
      { code: '4', label: '4등', payout: 'lump', gross: 50000 },
      { code: '5', label: '5등', payout: 'lump', gross: 5000 }
    ] },
    { id: 'pension720', name: '연금복권720+', unit: '매', ranks: [
      { code: '1', label: '1등', payout: 'monthly', gross: 7000000, months: 240 },
      { code: '2', label: '2등', payout: 'monthly', gross: 1000000, months: 120 },
      { code: 'bonus', label: '보너스', payout: 'monthly', gross: 1000000, months: 120 },
      { code: '3', label: '3등', payout: 'lump', gross: 1000000 },
      { code: '4', label: '4등', payout: 'lump', gross: 100000 },
      { code: '5', label: '5등', payout: 'lump', gross: 50000 },
      { code: '6', label: '6등', payout: 'lump', gross: 5000 },
      { code: '7', label: '7등', payout: 'lump', gross: 1000 }
    ] },
    { id: 'speetto500', name: '스피또500', unit: '장', ranks: [
      { code: '1', label: '1등', payout: 'lump', gross: 200000000 },
      { code: '2', label: '2등', payout: 'lump', gross: 1000000 },
      { code: '3', label: '3등', payout: 'lump', gross: 5000 },
      { code: '4', label: '4등', payout: 'lump', gross: 500 }
    ] },
    { id: 'speetto1000', name: '스피또1000', unit: '장', ranks: [
      { code: '1', label: '1등', payout: 'lump', gross: 500000000 },
      { code: 'etc', label: '그 밖의 등수(직접 입력)', payout: 'lump', gross: null }
    ] },
    { id: 'speetto2000', name: '스피또2000', unit: '낱장', ranks: [
      { code: '1', label: '1등', payout: 'lump', gross: 1000000000 },
      { code: 'etc', label: '그 밖의 등수(직접 입력)', payout: 'lump', gross: null }
    ] },
    { id: 'custom', name: '기타 직접 설정', unit: '건', ranks: [
      { code: 'custom', label: '직접 설정(가정값)', payout: 'either', gross: null }
    ] }
  ];

  var CATEGORIES = ['주거', '이동', '여행', '가족', '취미', '휴식', '기타'];
  var PRIORITIES = ['필수', '하고 싶음', '여유 있으면'];

  // 조합 프리셋(기획서 2B) — 보유·당첨을 가정하는 입력 편의 기능
  var PRESETS = [
    { id: 'pension-1-2x4', label: '연금복권 1등 1매 + 2등 4매', rows: [['pension720', '1', 1], ['pension720', '2', 4]] },
    { id: 'pension-bonus5', label: '연금복권 보너스 5매', rows: [['pension720', 'bonus', 5]] },
    { id: 'speetto2000-set', label: '스피또2000 세트 1등(낱장 2매)', rows: [['speetto2000', '1', 2]] }
  ];

  function str(v) { return v == null ? '' : String(v).trim(); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isInt(n) { return typeof n === 'number' && Number.isSafeInteger(n); }
  function safe(n, what) {
    if (!Number.isSafeInteger(n)) throw new Error('금액 합계가 계산 범위를 넘었습니다' + (what ? ' (' + what + ')' : ''));
    return n;
  }

  // ── 월 ─────────────────────────────────────────────────────
  function isMonth(s) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(s || ''); }
  function monthIndex(s) { var p = s.split('-'); return +p[0] * 12 + (+p[1] - 1); }
  function monthFromIndex(i) { return Math.floor(i / 12) + '-' + pad(i % 12 + 1); }
  function addMonths(s, n) { return monthFromIndex(monthIndex(s) + n); }
  function monthDiff(a, b) { return monthIndex(b) - monthIndex(a); }   // b − a
  function monthLabel(s) { var p = s.split('-'); return p[0] + '년 ' + (+p[1]) + '월'; }
  function thisMonth(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }

  // ── 금액 표시·입력 ─────────────────────────────────────────
  function comma(n) {
    var s = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (n < 0 ? '−' : '') + s;
  }
  function won(n) { return comma(n) + '원'; }
  // 한글 단위: 1,373,000,000 → '13억 7,300만원', 4,160,000 → '416만원', 5,000 → '5,000원'
  function korWon(n) {
    var neg = n < 0; n = Math.abs(n);
    var jo = Math.floor(n / 1e12), eok = Math.floor(n % 1e12 / 1e8), man = Math.floor(n % 1e8 / 1e4), rest = n % 1e4;
    var parts = [];
    if (jo) parts.push(comma(jo) + '조');
    if (eok) parts.push(comma(eok) + '억');
    if (man) parts.push(comma(man) + '만');
    if (rest || !parts.length) parts.push(comma(rest));
    return (neg ? '−' : '') + parts.join(' ') + '원';
  }
  // '1억 8천만', '5천만원', '150만', '2,000,000', '1.5억' → 원 정수. 알아볼 수 없으면 null
  var UNIT = { '조': 1e12, '억': 1e8, '천만': 1e7, '백만': 1e6, '만': 1e4, '천': 1e3 };
  function parseKrw(s) {
    s = str(s).replace(/[,\s]/g, '').replace(/원$/, '');
    if (!s) return null;
    if (/^\d+$/.test(s)) return +s;
    var re = /(\d+(?:\.\d+)?)(조|억|천만|백만|만|천)?/g, m, total = 0, used = 0;
    while ((m = re.exec(s))) {
      if (m.index !== used) return null;
      used = re.lastIndex;
      total += +m[1] * (m[2] ? UNIT[m[2]] : 1);
      if (!m[2] && used !== s.length) return null;
    }
    if (used !== s.length) return null;
    total = Math.round(total);
    return Number.isSafeInteger(total) ? total : null;
  }

  // ── 세금(2장) ──────────────────────────────────────────────
  // 원천징수 추정 T(반올림 전). 정수 연산으로 부동소수 오차를 피합니다.
  function taxOf(G, rule) {
    rule = rule || TAX_RULE;
    if (G <= rule.exemptThreshold) return 0;
    if (G <= rule.tierLimit) return Math.round(G * rule.rateLow / 100);
    return rule.tierBase + Math.round((G - rule.tierLimit) * rule.rateHigh / 100);
  }
  function netOf(G, rule) { return G - taxOf(G, rule); }
  // 연금형 월액 — 일시금 비과세 기준·누진 구간을 쓰지 않습니다
  function annuityTax(monthlyGross, rule) { return Math.round(monthlyGross * (rule || TAX_RULE).annuityRate / 100); }
  function annuityNet(monthlyGross, rule) { return monthlyGross - annuityTax(monthlyGross, rule); }

  // ── 상품·등수 ──────────────────────────────────────────────
  function product(id) { for (var i = 0; i < PRODUCTS.length; i++) if (PRODUCTS[i].id === id) return PRODUCTS[i]; return null; }
  function rank(productId, code) {
    var p = product(productId); if (!p) return null;
    for (var i = 0; i < p.ranks.length; i++) if (p.ranks[i].code === code) return p.ranks[i];
    return null;
  }
  function entryLabel(e) {
    var p = product(e.productId), r = rank(e.productId, e.rankCode);
    if (!p || !r) return '알 수 없는 당첨';
    return p.name + ' ' + (e.productId === 'custom' ? (str(e.title) || '직접 설정') : r.label) + ' ' + e.quantity + p.unit;
  }

  var uid = (function () { var n = 0; return function (p) { n++; return (p || 'id') + '-' + Date.now().toString(36) + '-' + n.toString(36) + Math.floor(Math.random() * 1e6).toString(36); }; })();

  // 새 당첨 건 — 등수의 기획서 기준 값으로 채움
  function newEntry(productId, rankCode, month, over) {
    var r = rank(productId, rankCode) || { payout: 'lump', gross: null };
    var e = {
      id: uid('w'), productId: productId, rankCode: rankCode, title: '',
      quantity: 1, inputMode: 'gross', unitAmount: r.gross == null ? 0 : r.gross,
      payoutType: r.payout === 'monthly' ? 'monthly' : 'lump',
      receiptMonth: month, firstPaymentMonth: month, paymentMonths: r.months || 0,
      round: '', alias: '', game: '', active: true, bundleId: '', presetVersion: '',
      taxRuleVersion: TAX_RULE.version
    };
    return Object.assign(e, over || {});
  }
  function presetEntries(presetId, month) {
    var p = null;
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === presetId) p = PRESETS[i];
    if (!p) return [];
    var bundle = uid('b');
    return p.rows.map(function (r) { return newEntry(r[0], r[1], month, { quantity: r[2], bundleId: bundle, presetVersion: presetId + '@1' }); });
  }

  // 1단위(1게임·1매·1장) 세후 — 세후 직접 입력이면 재과세하지 않음
  function unitNet(e) {
    if (e.inputMode === 'net') return e.unitAmount;
    return e.payoutType === 'monthly' ? annuityNet(e.unitAmount) : netOf(e.unitAmount);
  }
  function unitTax(e) { return e.inputMode === 'net' ? 0 : e.unitAmount - unitNet(e); }
  // 행 하나의 합계 — 단위별 세후를 먼저 구하고 수량을 곱합니다(q × net(G), net(q × G) 아님)
  function entryTotals(e) {
    var q = e.quantity, n = unitNet(e);
    var t = {
      gross: e.inputMode === 'net' ? null : safe(q * e.unitAmount),
      tax: safe(q * unitTax(e)),
      net: safe(q * n),                   // 일시금: 세후 합계 · 월 지급: 세후 월 합계
      periodNet: e.payoutType === 'monthly' ? safe(q * n * e.paymentMonths) : safe(q * n),
      periodGross: e.inputMode === 'net' ? null : safe(q * e.unitAmount * (e.payoutType === 'monthly' ? e.paymentMonths : 1))
    };
    if (e.payoutType === 'monthly') t.endMonth = addMonths(e.firstPaymentMonth, e.paymentMonths - 1);
    return t;
  }

  // 입력 검증 — {칸: 메시지}. 빈 객체면 통과. 오류가 있는 행은 계산에 넣지 않습니다(7장 상태 처리).
  function validateEntry(e) {
    var err = {};
    if (!product(e.productId)) err.productId = '복권 종류를 골라 주세요';
    else if (!rank(e.productId, e.rankCode)) err.rankCode = '이 복권에 없는 등수예요';
    if (!(isInt(e.quantity) && e.quantity >= 1 && e.quantity <= LIMITS.qtyMax)) err.quantity = '수량은 1~100 사이 정수로 넣어 주세요';
    if (!(isInt(e.unitAmount) && e.unitAmount >= 0 && e.unitAmount <= LIMITS.amountMax)) err.unitAmount = '금액은 0원~1조원 사이 정수로 넣어 주세요';
    else if (e.unitAmount === 0) err.unitAmount = '1건당 금액을 넣어 주세요';
    if (e.payoutType === 'monthly') {
      if (!isMonth(e.firstPaymentMonth)) err.firstPaymentMonth = '첫 지급 월을 골라 주세요';
      if (!(isInt(e.paymentMonths) && e.paymentMonths >= 1 && e.paymentMonths <= LIMIT_MONTHS)) err.paymentMonths = '지급기간은 1~600개월로 넣어 주세요';
    } else if (e.payoutType === 'lump') {
      if (!isMonth(e.receiptMonth)) err.receiptMonth = '수령 월을 골라 주세요';
    } else err.payoutType = '지급 방식을 골라 주세요';
    return err;
  }
  function validBucket(b, monthly) {
    var err = {};
    if (!str(b.title)) err.title = '제목을 넣어 주세요';
    if (!(isInt(b.amount) && b.amount >= 1 && b.amount <= LIMITS.amountMax)) err.amount = '금액은 1원~1조원 사이 정수로 넣어 주세요';
    if (b.kind === 'monthly') {
      if (!isMonth(b.startMonth)) err.startMonth = '시작 월을 골라 주세요';
      if (!isMonth(b.endMonth)) err.endMonth = '종료 월을 골라 주세요';
      else if (isMonth(b.startMonth) && monthIndex(b.endMonth) < monthIndex(b.startMonth)) err.endMonth = '종료 월이 시작 월보다 빨라요';
    } else if (b.kind === 'once') {
      if (monthly && !isMonth(b.targetMonth)) err.targetMonth = '월별 계산에서는 지출 월이 꼭 필요해요';
    } else err.kind = '지출 유형을 골라 주세요';
    return err;
  }
  function validFlow(f) {
    var err = {};
    if (!str(f.title)) err.title = '제목을 넣어 주세요';
    if (f.direction !== 'in' && f.direction !== 'out') err.direction = '수입/지출을 골라 주세요';
    else if (f.expected && f.direction !== 'in') err.direction = '추가 예상 수입은 수입이어야 해요';
    if (!(isInt(f.amount) && f.amount >= 1 && f.amount <= LIMITS.amountMax)) err.amount = '월 금액은 1원 이상 정수로 넣어 주세요';
    if (!isMonth(f.startMonth)) err.startMonth = '시작 월을 골라 주세요';
    if (f.expected && !f.endMonth) err.endMonth = '추가 예상 수입은 기간(종료 월)이 꼭 필요해요';
    else if (f.endMonth && !isMonth(f.endMonth)) err.endMonth = '종료 월 형식이 달라요';
    else if (f.endMonth && isMonth(f.startMonth) && monthIndex(f.endMonth) < monthIndex(f.startMonth)) err.endMonth = '종료 월이 시작 월보다 빨라요';
    return err;
  }
  function ok(err) { return Object.keys(err).length === 0; }

  // ── 중복 입력(2A) ──────────────────────────────────────────
  // 상품·회차·복권 별칭·게임 위치로 만든 키. 별칭이 없으면(가정 입력) 키가 없습니다.
  // 등수는 키에 넣지 않습니다 — 한 게임에 1등과 5등을 함께 넣어 누적하는 것을 막기 위함(AC20).
  // 연금복권 보너스는 일반 등위와 따로 지급되므로 묶음을 나눕니다.
  function awardUnitKey(e) {
    if (!str(e.alias)) return '';
    var group = e.rankCode === 'bonus' ? 'bonus' : 'main';
    return [e.productId, str(e.round), str(e.alias), str(e.game), group].join('|');
  }
  // entries 안에 e 와 같은 실제 당첨 단위가 있으면 그 행을 돌려줍니다(자기 자신 제외)
  function findDuplicateUnit(entries, e) {
    var k = awardUnitKey(e); if (!k) return null;
    for (var i = 0; i < entries.length; i++) if (entries[i].id !== e.id && awardUnitKey(entries[i]) === k) return entries[i];
    return null;
  }
  // 식별 정보 없이 똑같은 조건의 행 — 막지 않고 알려만 줍니다
  function looksSame(a, b) {
    return a.id !== b.id && a.productId === b.productId && a.rankCode === b.rankCode && a.unitAmount === b.unitAmount &&
      a.inputMode === b.inputMode && a.payoutType === b.payoutType &&
      (a.payoutType === 'monthly' ? a.firstPaymentMonth === b.firstPaymentMonth : a.receiptMonth === b.receiptMonth);
  }

  // ── 시나리오 ───────────────────────────────────────────────
  function newScenario(over) {
    var m = (over && over.startMonth) || thisMonth();
    return Object.assign({
      id: uid('s'), schemaVersion: SCHEMA_VERSION, title: '내 행복회로', startMonth: m,
      currentCash: 0, reserveAmount: 0, forceMonthly: false, retireMonth: '', living: 0,
      entries: [], buckets: [], flows: [], createdAt: new Date().toISOString(), updatedAt: ''
    }, over || {});
  }
  function activeEntries(s) { return s.entries.filter(function (e) { return e.active !== false && ok(validateEntry(e)); }); }

  // 월별 모드인가 — 월 지급이 하나라도 있거나 일시금 수령 월이 다르면(1장·2B), 또는 사용자가 월별 보기를 고르면
  function isMonthlyMode(s) {
    if (s.forceMonthly) return true;
    if (expectedIncomes(s).length) return true;   // 추가 예상 수입은 그 기간 예산에 들어가야 하므로 월별로 봅니다(2026-09-30)
    var es = activeEntries(s), months = {};
    for (var i = 0; i < es.length; i++) {
      if (es[i].payoutType === 'monthly') return true;
      months[es[i].receiptMonth] = 1;
    }
    return Object.keys(months).length > 1;
  }

  // 전체 기간 예상 수령 총액(7A) — 참고 정보. 잔고에 더하지 않습니다.
  function prizeTotals(s) {
    var es = activeEntries(s), lumpNet = 0, monthlyPeriodNet = 0, gross = 0, grossKnown = true, tax = 0;
    es.forEach(function (e) {
      var t = entryTotals(e);
      if (e.payoutType === 'monthly') monthlyPeriodNet = safe(monthlyPeriodNet + t.periodNet); else lumpNet = safe(lumpNet + t.net);
      if (t.periodGross == null) grossKnown = false; else gross = safe(gross + t.periodGross);
      tax = safe(tax + (e.payoutType === 'monthly' ? t.tax * e.paymentMonths : t.tax));
    });
    return { lumpNet: lumpNet, monthlyPeriodNet: monthlyPeriodNet, totalNet: safe(lumpNet + monthlyPeriodNet),
      totalGross: grossKnown ? gross : null, totalTax: tax, count: es.length };
  }

  function activeBuckets(s, monthly) {
    return s.buckets.filter(function (b) { return b.active !== false && ok(validBucket(b, monthly)); });
  }

  // 일시금 대시보드(3장 표) — C₀ + N − 활성 버킷 = B, A = B − S.
  // 일시금 화면은 반복 지출 대신 퇴사 시뮬레이션의 월 생활비를 씁니다(3장) — 반복 버킷은 여기서 빼고 알려 줍니다.
  function lumpSummary(s) {
    var N = prizeTotals(s).lumpNet, all = activeBuckets(s, false);
    var once = all.filter(function (b) { return b.kind === 'once'; });
    var bucketTotal = once.reduce(function (a, b) { return safe(a + b.amount); }, 0);
    var afterWin = safe(s.currentCash + N), B = safe(afterWin - bucketTotal);
    var held = s.buckets.filter(function (b) { return b.active === false; }).reduce(function (a, b) { return a + (isInt(b.amount) ? b.amount : 0); }, 0);
    return { N: N, afterWin: afterWin, bucketTotal: bucketTotal, B: B, A: B - s.reserveAmount, S: s.reserveAmount,
      heldTotal: held, monthlyBucketsIgnored: all.length - once.length };
  }

  // 월별 시뮬레이션(4장). 시작 월부터 600개월을 계산합니다.
  //  opts.retireMonth · opts.living : 퇴사 계산용 복제(급여 중단 + 월 생활비)
  function simulate(s, opts) {
    opts = opts || {};
    var M0 = monthIndex(s.startMonth), N = LIMIT_MONTHS;
    var inc = new Array(N).fill(0), oth = new Array(N).fill(0), fix = new Array(N).fill(0), bkt = new Array(N).fill(0);
    var pay = []; for (var k = 0; k < N; k++) pay.push([]);
    var before = [], outside = [];
    var es = activeEntries(s);
    es.forEach(function (e) {
      var n = safe(unitNet(e) * e.quantity);
      if (e.payoutType === 'lump') {
        var t = monthIndex(e.receiptMonth) - M0;
        if (t < 0) before.push({ kind: 'entry', id: e.id, month: e.receiptMonth, amount: n });   // 현재 잔고에 이미 들어간 것으로 봄
        else if (t >= N) outside.push({ kind: 'entry', id: e.id, month: e.receiptMonth, amount: n });
        else { inc[t] += n; pay[t].push({ entryId: e.id, amount: n, remainingAfter: 0 }); }
      } else {
        var P = monthIndex(e.firstPaymentMonth) - M0, K = e.paymentMonths;
        for (var j = 0; j < K; j++) {
          var tt = P + j;
          if (tt < 0) continue;              // 시작 전 지급분은 제외(현재 잔고와 중복 금지)
          if (tt >= N) { outside.push({ kind: 'entry', id: e.id, month: monthFromIndex(M0 + tt), amount: n, count: P + K - tt }); break; }
          inc[tt] += n; pay[tt].push({ entryId: e.id, amount: n, remainingAfter: K - j - 1 });
        }
      }
    });
    var retire = opts.retireMonth && isMonth(opts.retireMonth) ? monthIndex(opts.retireMonth) - M0 : null;
    s.flows.forEach(function (f) {
      if (!ok(validFlow(f))) return;
      var a = Math.max(0, monthIndex(f.startMonth) - M0);
      var b = f.endMonth ? monthIndex(f.endMonth) - M0 : N - 1;
      if (f.direction === 'in' && f.stopOnRetirement && retire != null) b = Math.min(b, retire - 1);
      for (var t = a; t <= Math.min(b, N - 1); t++) { if (f.direction === 'in') oth[t] += f.amount; else fix[t] += f.amount; }
    });
    if (retire != null && opts.living > 0) for (var r = Math.max(0, retire); r < N; r++) fix[r] += opts.living;
    activeBuckets(s, true).forEach(function (b) {
      if (b.id === opts.excludeBucketId) return;
      if (b.kind === 'once') {
        var t = monthIndex(b.targetMonth) - M0;
        if (t < 0 || t >= N) outside.push({ kind: 'bucket', id: b.id, month: b.targetMonth, amount: b.amount });
        else bkt[t] += b.amount;
      } else {
        var a2 = monthIndex(b.startMonth) - M0, b2 = monthIndex(b.endMonth) - M0;
        if (a2 < 0 || b2 >= N) outside.push({ kind: 'bucket', id: b.id, month: a2 < 0 ? b.startMonth : b.endMonth, amount: b.amount, partial: true });
        for (var t2 = Math.max(0, a2); t2 <= Math.min(b2, N - 1); t2++) bkt[t2] += b.amount;   // 양 끝 월 포함
      }
    });
    var rows = [], B = s.currentCash;
    for (var i = 0; i < N; i++) {
      var I = inc[i] + oth[i], R = I - fix[i] - bkt[i], opening = B;
      B = safe(B + R, monthFromIndex(M0 + i));
      rows.push({ month: monthFromIndex(M0 + i), opening: opening, prizeIncome: inc[i], otherIncome: oth[i],
        fixedExpense: fix[i], bucketExpense: bkt[i], surplus: R, closing: B, available: B - s.reserveAmount, payments: pay[i] });
    }
    return { rows: rows, before: before, outside: outside };
  }

  // 월 지급 당첨의 마지막 지급 월 중 가장 늦은 것(활성 건만). 없으면 가장 늦은 일시금 수령 월.
  function finalPrizeMonth(s) {
    var last = null;
    activeEntries(s).forEach(function (e) {
      var m = e.payoutType === 'monthly' ? addMonths(e.firstPaymentMonth, e.paymentMonths - 1) : e.receiptMonth;
      if (!last || monthIndex(m) > monthIndex(last)) last = m;
    });
    return last;
  }
  // 기본 조회 범위 — 시작 월부터 (전체 종료 월, 가장 늦은 예정 지출 월) 이후 12개월까지, 한도 600개월
  function viewRange(s) {
    var last = finalPrizeMonth(s) || s.startMonth;
    activeBuckets(s, true).forEach(function (b) {
      var m = b.kind === 'once' ? b.targetMonth : b.endMonth;
      if (monthIndex(m) > monthIndex(last)) last = m;
    });
    s.flows.forEach(function (f) { if (ok(validFlow(f)) && f.endMonth && monthIndex(f.endMonth) > monthIndex(last)) last = f.endMonth; });
    var n = Math.max(1, Math.min(LIMIT_MONTHS, monthDiff(s.startMonth, last) + 13));
    return { start: s.startMonth, end: addMonths(s.startMonth, n - 1), months: n };
  }

  // 선택 월의 연금 건 남은 지급 횟수(4장) — 선택 월 포함 / 선택 월 지급 후
  function paymentStatus(e, month) {
    if (e.payoutType !== 'monthly') return null;
    var P = monthIndex(e.firstPaymentMonth), end = P + e.paymentMonths - 1, t = monthIndex(month);
    var incl = t > end ? 0 : (t < P ? e.paymentMonths : end - t + 1);
    var paying = t >= P && t <= end;
    return { endMonth: monthFromIndex(end), remainingIncl: incl, remainingAfter: paying ? incl - 1 : incl, payingNow: paying };
  }

  // 경고(6장) — 우선순위: 현금 부족 → 안전금고 침범 → 월 적자 → 낮은 여유
  function warningOf(row, nextFixed) {
    var man = function (n) { return korWon(n); };
    if (row.closing < 0) return { level: 'short', text: '이 계획은 ' + monthLabel(row.month) + '에 ' + man(-row.closing) + '이 부족해요. 지출 월을 옮겨볼까요?' };
    if (row.available < 0) return { level: 'vault', text: '현금은 남지만 안전금고 기준보다 ' + man(-row.available) + ' 적어요.' };
    if (row.surplus < 0) return { level: 'deficit', text: '이번 달은 모아둔 돈에서 ' + man(-row.surplus) + '을 사용해요.' };
    if (nextFixed != null && row.available < nextFixed) return { level: 'low', text: '다음 달 고정지출보다 여유 자금이 적어요.' };
    return null;
  }
  function lumpWarning(sum) {
    if (sum.B < 0) return { level: 'short', text: '이 계획은 ' + korWon(-sum.B) + '이 부족해요. 버킷을 보류하거나 비용을 줄여 볼까요?' };
    if (sum.A < 0) return { level: 'vault', text: '현금은 남지만 안전금고 기준보다 ' + korWon(-sum.A) + ' 적어요.' };
    return null;
  }
  function firstMonth(rows, pred, from) {
    for (var i = from || 0; i < rows.length; i++) if (pred(rows[i])) return rows[i].month;
    return null;
  }

  // 퇴사 가능 기간(6장) — 안전금고를 지키며 버티는 연속 개월 수. null = 600개월 안에 부족 없음.
  function retireMonths(s, retireMonth, living) {
    living = living || 0;
    if (!isMonthlyMode(s)) {
      var sum = lumpSummary(s);
      if (sum.A < 0) return { months: 0, cashMonths: sum.B < 0 ? 0 : (living > 0 ? Math.min(Math.floor(sum.B / living), LIMIT_MONTHS) : null) };
      if (living <= 0) return { months: null, cashMonths: null };
      var m = Math.floor(sum.A / living), c = Math.floor(sum.B / living);
      return { months: m >= LIMIT_MONTHS ? null : m, cashMonths: c >= LIMIT_MONTHS ? null : c };
    }
    var rm = isMonth(retireMonth) ? retireMonth : s.startMonth;
    var from = Math.max(0, monthDiff(s.startMonth, rm));
    if (from >= LIMIT_MONTHS) return { months: null, cashMonths: null };
    var rows = simulate(s, { retireMonth: rm, living: living }).rows;
    var count = function (pred) { for (var i = from; i < rows.length; i++) if (pred(rows[i])) return i - from; return null; };
    return { months: count(function (r) { return r.available < 0; }), cashMonths: count(function (r) { return r.closing < 0; }) };
  }

  // 한 시나리오의 핵심 결과 — 포기 비교·공유에 씁니다
  function summarize(s) {
    var retire = retireMonths(s, s.retireMonth, s.living);
    if (!isMonthlyMode(s)) {
      var l = lumpSummary(s);
      return { mode: 'lump', B: l.B, A: l.A, bucketTotal: l.bucketTotal, firstShort: l.B < 0 ? 'now' : null, firstVault: l.A < 0 ? 'now' : null, retire: retire };
    }
    var v = viewRange(s), sim = simulate(s), rows = sim.rows.slice(0, v.months), last = rows[rows.length - 1];
    return { mode: 'monthly', B: last.closing, A: last.available, endMonth: last.month,
      firstShort: firstMonth(sim.rows, function (r) { return r.closing < 0; }),
      firstVault: firstMonth(sim.rows, function (r) { return r.available < 0; }),
      minClosing: Math.min.apply(null, rows.map(function (r) { return r.closing; })), retire: retire };
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  // 「이거 포기하면」(6장) — 원본을 복제해 그 항목만 보류하고 비교합니다. 원본은 바꾸지 않습니다.
  function giveUpPreview(s, bucketId) {
    var copy = clone(s), b = null;
    copy.buckets.forEach(function (x) { if (x.id === bucketId) { x.active = false; b = x; } });
    if (!b) return null;
    var before = summarize(s), after = summarize(copy);
    return { before: before, after: after, gain: after.B - before.B,
      retireBefore: before.retire.months, retireAfter: after.retire.months };
  }

  // 로또 평균값(2장) — G = round(ΣPᵣ / N), N ≤ 52, 당첨자 없음·누락 회차 제외.
  function lottoAverage(values) {
    var v = (values || []).filter(function (x) { return isInt(x) && x > 0; }).slice(-52);
    if (!v.length) return null;
    return { mean: Math.round(v.reduce(function (a, b) { return a + b; }, 0) / v.length), n: v.length };
  }
  // 직접 입력 보조 — 「25억 3천만, 18억」이나 줄마다 적은 금액 목록을 원 정수 배열로.
  // 알아볼 수 없는 칸은 bad 로 돌려 화면에 알립니다.
  function parseAmountList(text) {
    var parts = str(text).split(/[\n;\/]+|,(?!\d{3})/), vals = [], bad = [];
    parts.forEach(function (p) { p = str(p); if (!p) return; var v = parseKrw(p); if (v == null || v <= 0) bad.push(p); else vals.push(v); });
    return { values: vals, bad: bad };
  }

  // 로또 회차 자료(data/lotto.json) — 자동 수집 또는 관리자 등록 결과를 담는 파일 형식.
  //   { schema: 'lotto-draws@1', source, updatedAt: 'YYYY-MM-DD', draws: [
  //       { round: 1190, date: 'YYYY-MM-DD', ranks: { '1': { perGame, winners }, '2': {…}, '3': {…} } } ] }
  // perGame 은 1게임당 세전 당첨금(원). 당첨자 0명이거나 금액이 없는 회차는 평균에서 뺍니다(2장).
  function checkLottoData(o) {
    var errs = [];
    if (!o || typeof o !== 'object') return ['자료 형식이 아니에요'];
    if (o.schema !== 'lotto-draws@1') errs.push('schema 가 lotto-draws@1 이 아니에요');
    if (!Array.isArray(o.draws)) { errs.push('draws 목록이 없어요'); return errs; }
    var seen = {};
    o.draws.forEach(function (d, i) {
      var at = (i + 1) + '번째 회차';
      if (!d || !(isInt(d.round) && d.round > 0)) { errs.push(at + ': 회차 번호가 없어요'); return; }
      if (seen[d.round]) errs.push(d.round + '회: 두 번 들어 있어요'); seen[d.round] = 1;
      if (!d.ranks || typeof d.ranks !== 'object') { errs.push(d.round + '회: ranks 가 없어요'); return; }
      ['1', '2', '3'].forEach(function (k) {
        var r = d.ranks[k]; if (r == null) return;
        if (!(isInt(r.perGame) && r.perGame >= 0 && r.perGame <= LIMITS.amountMax)) errs.push(d.round + '회 ' + k + '등: 금액은 0 이상 정수여야 해요');
        if (r.winners != null && !(isInt(r.winners) && r.winners >= 0)) errs.push(d.round + '회 ' + k + '등: 당첨자 수 형식이 달라요');
      });
    });
    return errs;
  }
  // 최근 52회차의 1~3등 평균. 자료가 없거나 형식이 틀리면 null → 화면은 직접 입력으로 돌아갑니다.
  function lottoAverages(o) {
    if (checkLottoData(o).length) return null;
    var draws = o.draws.slice().sort(function (a, b) { return a.round - b.round; }).slice(-52);
    if (!draws.length) return null;
    var out = { from: draws[0].round, to: draws[draws.length - 1].round, draws: draws.length, updatedAt: str(o.updatedAt), source: str(o.source), ranks: {} };
    ['1', '2', '3'].forEach(function (k) {
      var vals = [];
      draws.forEach(function (d) { var r = d.ranks[k]; if (r && r.perGame > 0 && r.winners !== 0) vals.push(r.perGame); });
      out.ranks[k] = lottoAverage(vals);   // { mean, n } 또는 null
    });
    return (out.ranks['1'] || out.ranks['2'] || out.ranks['3']) ? out : null;
  }

  // ── 추가 예상 수입(2026-09-30 수강생 답) ─────────────────────
  // 기간이 정해진 수입(퇴직금 분할·부업·임대 등). 그 기간 월별 예산에 수입으로 들어가고,
  // 안전금고 한도에도 더합니다. 제목은 생략할 수 있어 비우면 기본 이름을 씁니다.
  var EXPECTED_TITLE = '추가 예상 수입';
  function expectedIncomes(s) { return (s.flows || []).filter(function (f) { return f.expected && ok(validFlow(f)); }); }
  // 시작 월 이후 기간에 들어오는 금액 합계(시작 월 전 몫은 현재 잔고에 들어 있는 것으로 봄)
  function expectedIncomeTotal(s) {
    var M0 = monthIndex(s.startMonth);
    return expectedIncomes(s).reduce(function (sum, f) {
      var a = Math.max(monthIndex(f.startMonth), M0), b = Math.min(monthIndex(f.endMonth), M0 + LIMIT_MONTHS - 1);
      return b < a ? sum : safe(sum + f.amount * (b - a + 1));
    }, 0);
  }

  // ── 그래프·표 조회 기간(2026-09-30) ─────────────────────────
  // 사용자가 고른 시작·끝 월을 계산 범위(시작 월 ~ 600개월) 안으로 맞춥니다. 비우면 기본 조회 범위.
  function chartRange(s, from, to) {
    var v = viewRange(s), lo = monthIndex(s.startMonth), hi = lo + LIMIT_MONTHS - 1;
    var a = isMonth(from) ? monthIndex(from) : lo, b = isMonth(to) ? monthIndex(to) : monthIndex(v.end);
    if (a > b) { var t = a; a = b; b = t; }
    a = Math.min(Math.max(a, lo), hi); b = Math.min(Math.max(b, lo), hi);
    return { start: monthFromIndex(a), end: monthFromIndex(b), from: a - lo, to: b - lo, months: b - a + 1, custom: isMonth(from) || isMonth(to) };
  }

  // ── 공유 링크(2026-09-30) ─────────────────────────────────
  // 서버 없이 시나리오를 주소 뒤(#share=…)에 담습니다. 주소의 # 뒤는 서버로 보내지지 않아요.
  // 현재 잔고·메모는 고른 경우에만 담고, 회차·복권 별칭·게임 위치는 늘 뺍니다.
  function shareSanitize(s, opts) {
    opts = opts || {};
    var c = clone(s);
    delete c.createdAt; delete c.updatedAt;
    if (!opts.cash) { c.currentCash = 0; c.reserveAmount = 0; }
    c.entries.forEach(function (e) { e.round = ''; e.alias = ''; e.game = ''; });
    if (!opts.memo) c.buckets.forEach(function (b) { b.note = ''; });
    return c;
  }
  function b64urlEncode(text) {
    var bytes = new TextEncoder().encode(text), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
    var bin = atob(s), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function encodeShare(s, opts) {
    return 'share=' + b64urlEncode(JSON.stringify({ app: 'data09-23', v: 1, scenario: shareSanitize(s, opts) }));
  }
  // 주소의 # 부분을 받아 { scenario } 또는 { error } 를 돌려줍니다. 공유 링크가 아니면 null.
  function decodeShare(hash) {
    var m = /(?:^|[#&])share=([A-Za-z0-9_-]+)/.exec(hash || '');
    if (!m) return null;
    var o;
    try { o = JSON.parse(b64urlDecode(m[1])); } catch (e) { return { error: '공유 링크가 잘렸거나 손상됐어요' }; }
    if (!o || o.app !== 'data09-23' || o.v !== 1) return { error: '행복회로 공유 링크가 아니에요' };
    var errs = checkScenario(o.scenario);
    if (errs.length) return { error: '공유된 시나리오를 읽지 못했어요 — ' + errs.slice(0, 2).join(', ') };
    return { scenario: o.scenario };
  }

  // ── 저장·가져오기 검증(8장) ────────────────────────────────
  function checkScenario(o) {
    var errs = [];
    if (!o || typeof o !== 'object') return ['시나리오 형식이 아니에요'];
    if (o.schemaVersion !== SCHEMA_VERSION) errs.push('schemaVersion 이 ' + SCHEMA_VERSION + ' 이 아니에요');
    if (!str(o.title)) errs.push('제목이 없어요');
    if (!isMonth(o.startMonth)) errs.push('시작 월 형식이 달라요');
    if (!(isInt(o.currentCash) && o.currentCash >= 0 && o.currentCash <= LIMITS.amountMax)) errs.push('현재 잔고는 0 이상 정수여야 해요');
    if (!(isInt(o.reserveAmount) && o.reserveAmount >= 0 && o.reserveAmount <= LIMITS.amountMax)) errs.push('안전금고는 0 이상 정수여야 해요');
    ['entries', 'buckets', 'flows'].forEach(function (k) { if (!Array.isArray(o[k])) errs.push(k + ' 목록이 없어요'); });
    if (errs.length) return errs;
    if (o.entries.length > LIMITS.entries) errs.push('당첨 행은 100개까지예요');
    if (o.buckets.length > LIMITS.buckets) errs.push('버킷은 500개까지예요');
    if (o.flows.length > LIMITS.flows) errs.push('고정지출·수입은 500개까지예요');
    var ids = {};
    o.entries.concat(o.buckets, o.flows).forEach(function (x) { if (!x || !str(x.id) || ids[x.id]) errs.push('항목 id 가 비었거나 겹쳐요'); else ids[x.id] = 1; });
    o.entries.forEach(function (e, i) { var er = validateEntry(e); if (!ok(er)) errs.push('당첨 ' + (i + 1) + '행: ' + er[Object.keys(er)[0]]); });
    o.buckets.forEach(function (b, i) { if (['once', 'monthly'].indexOf(b.kind) < 0 || !isInt(b.amount)) errs.push('버킷 ' + (i + 1) + '번: 유형·금액 형식이 달라요'); });
    o.flows.forEach(function (f, i) { var er = validFlow(f); if (!ok(er)) errs.push('고정지출·수입 ' + (i + 1) + '번: ' + er[Object.keys(er)[0]]); });
    return errs.filter(function (x, i, a) { return a.indexOf(x) === i; });
  }
  // 안전금고 설정 한도(3장) — 초기 사용 가능 현금을 넘길 수 없음.
  // 일시금 모드 = 당첨 후 잔고
  // 월별 모드 = 현재 잔고 + 시작 월 당첨 수령액 + 추가 예상 수입(기간 합계) — 2026-09-30 수강생 답으로 확정
  function reserveLimitParts(s) {
    if (!isMonthlyMode(s)) { var a = lumpSummary(s).afterWin; return { mode: 'lump', total: a, afterWin: a }; }
    var cash = s.currentCash, first = simulate(s).rows[0].prizeIncome, extra = expectedIncomeTotal(s);
    return { mode: 'monthly', total: safe(cash + first + extra), cash: cash, firstMonthPrize: first, expected: extra };
  }
  function reserveLimit(s) { return reserveLimitParts(s).total; }

  var API = {
    SCHEMA_VERSION: SCHEMA_VERSION, CHECKED_ON: CHECKED_ON, LIMIT_MONTHS: LIMIT_MONTHS, LIMITS: LIMITS,
    TAX_RULE: TAX_RULE, PRODUCTS: PRODUCTS, CATEGORIES: CATEGORIES, PRIORITIES: PRIORITIES, PRESETS: PRESETS,
    isMonth: isMonth, monthIndex: monthIndex, monthFromIndex: monthFromIndex, addMonths: addMonths, monthDiff: monthDiff,
    monthLabel: monthLabel, thisMonth: thisMonth,
    comma: comma, won: won, korWon: korWon, parseKrw: parseKrw,
    taxOf: taxOf, netOf: netOf, annuityTax: annuityTax, annuityNet: annuityNet,
    product: product, rank: rank, entryLabel: entryLabel, uid: uid,
    newEntry: newEntry, presetEntries: presetEntries, unitNet: unitNet, unitTax: unitTax, entryTotals: entryTotals,
    validateEntry: validateEntry, validBucket: validBucket, validFlow: validFlow, ok: ok,
    awardUnitKey: awardUnitKey, findDuplicateUnit: findDuplicateUnit, looksSame: looksSame,
    newScenario: newScenario, activeEntries: activeEntries, isMonthlyMode: isMonthlyMode, prizeTotals: prizeTotals,
    lumpSummary: lumpSummary, simulate: simulate, finalPrizeMonth: finalPrizeMonth, viewRange: viewRange,
    paymentStatus: paymentStatus, warningOf: warningOf, lumpWarning: lumpWarning, firstMonth: firstMonth,
    retireMonths: retireMonths, summarize: summarize, giveUpPreview: giveUpPreview, clone: clone,
    lottoAverage: lottoAverage, parseAmountList: parseAmountList, checkLottoData: checkLottoData, lottoAverages: lottoAverages,
    EXPECTED_TITLE: EXPECTED_TITLE, expectedIncomes: expectedIncomes, expectedIncomeTotal: expectedIncomeTotal,
    chartRange: chartRange, shareSanitize: shareSanitize, encodeShare: encodeShare, decodeShare: decodeShare,
    checkScenario: checkScenario, reserveLimit: reserveLimit, reserveLimitParts: reserveLimitParts
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.HCLogic = API;
})(typeof window !== 'undefined' ? window : this);
