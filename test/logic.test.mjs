// 실행: node test/logic.test.mjs   (의존성 없음)
// 기획서 v1.1 의 5장 계산 예시·9장 인수 기준(AC)을 그대로 옮긴 테스트입니다.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../js/logic.js');
const X = require('../js/examples.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
const rowOf = (sim, m) => sim.rows.find((r) => r.month === m);
const man = (n) => n * 10000;   // 기획서 표는 만원 단위

console.log('세금 구간 (2장)');
test('AC01 세전 20억원 → 세금 627,000,000원, 세후 1,373,000,000원', () => {
  assert.equal(L.taxOf(2000000000), 627000000);
  assert.equal(L.netOf(2000000000), 1373000000);
});
test('AC02 경계 200만원 / 200만1원 → 세금 0원 / 440,000원 (200만원은 공제가 아니라 비과세 기준)', () => {
  assert.equal(L.taxOf(2000000), 0);
  assert.equal(L.taxOf(2000001), 440000);          // 440,000.22 → 반올림
  assert.equal(L.netOf(2000001), 1560001);
  assert.equal(L.taxOf(1999999), 0);
});
test('AC03 경계 3억원 / 3억100원 → 66,000,000원 / 66,000,033원 (6,600만원 기본액)', () => {
  assert.equal(L.taxOf(300000000), 66000000);
  assert.equal(L.taxOf(300000100), 66000033);
  assert.equal(L.taxOf(300000001), 66000000);      // 0.33 → 반올림 0
  assert.equal(L.taxOf(300000002), 66000001);      // 0.66 → 1
});
test('3억원 안쪽은 22%, 바깥은 6,600만원 + 초과분 33% — 구간이 이어진다', () => {
  assert.equal(L.taxOf(299999999), Math.round(299999999 * 0.22));
  assert.equal(L.taxOf(1000000000), 297000000);    // 스피또2000 낱장
});
test('AC04 세후 직접 입력 1억원은 추가 차감 없이 그대로', () => {
  const e = L.newEntry('custom', 'custom', '2026-10', { inputMode: 'net', unitAmount: 100000000 });
  assert.equal(L.unitNet(e), 100000000);
  assert.equal(L.unitTax(e), 0);
  assert.equal(L.entryTotals(e).net, 100000000);
});
test('AC16 연금 월액: 1등 700만 → 546만, 2등·보너스 100만 → 78만 (월 100만원에 비과세 금지)', () => {
  assert.equal(L.annuityNet(7000000), 5460000);
  assert.equal(L.annuityNet(1000000), 780000);
  const b = L.newEntry('pension720', 'bonus', '2026-10');
  assert.equal(L.unitNet(b), 780000);
  assert.equal(b.paymentMonths, 120);
  assert.equal(L.newEntry('pension720', '2', '2026-10').paymentMonths, 120);
  assert.equal(L.newEntry('pension720', '1', '2026-10').paymentMonths, 240);
});

console.log('\n일시금 예시 (5장)');
test('세후 1,373,000,000 · 당첨 후 1,393,000,000 · 버킷 1,030,000,000 · 계획 후 363,000,000 · 가용 263,000,000', () => {
  const s = X.lump();
  assert.equal(L.isMonthlyMode(s), false);
  const l = L.lumpSummary(s);
  assert.equal(l.N, 1373000000);
  assert.equal(l.afterWin, 1393000000);
  assert.equal(l.bucketTotal, 1030000000);
  assert.equal(l.B, 363000000);
  assert.equal(l.A, 263000000);
});
test('자동차를 보류하면 계획 후 543,000,000 / 가용 443,000,000 (AC09 보류→복원 시 원래 결과)', () => {
  const s = X.lump();
  s.buckets.find((b) => b.title === '자동차').active = false;
  let l = L.lumpSummary(s);
  assert.equal(l.B, 543000000); assert.equal(l.A, 443000000);
  s.buckets.find((b) => b.title === '자동차').active = true;
  l = L.lumpSummary(s);
  assert.equal(l.B, 363000000); assert.equal(l.A, 263000000);
});
test('「이거 포기하면」 미리보기는 원본을 바꾸지 않고 1억8천만원 증가를 보여 준다', () => {
  const s = X.lump(), before = JSON.stringify(s);
  const p = L.giveUpPreview(s, 'ex-b2');
  assert.equal(p.gain, 180000000);
  assert.equal(p.after.A, 443000000);
  assert.equal(JSON.stringify(s), before);
});
test('AC05 안전금고 500만원 올리면 총잔액 그대로, 가용만 500만원 감소', () => {
  const s = X.lump(), a = L.lumpSummary(s);
  s.reserveAmount += 5000000;
  const b = L.lumpSummary(s);
  assert.equal(b.B, a.B); assert.equal(b.A, a.A - 5000000);
});
test('AC10 필터·정렬(목록 순서)을 바꿔도 합계는 같다', () => {
  const s = X.lump(), a = L.lumpSummary(s);
  s.buckets.reverse();
  assert.deepEqual(L.lumpSummary(s), a);
});

console.log('\n연금복권 월별 예시 (5장 표, 단위 만원)');
test('AC06 표 7행 — 수입·고정·버킷·월 잔여·누적·가용 모두 일치', () => {
  const sim = L.simulate(X.pension());
  const table = [
    ['2026-10', 546, 250, 50, 246, 1246, 746],
    ['2026-11', 546, 250, 50, 246, 1492, 992],
    ['2026-12', 546, 250, 450, -154, 1338, 838],
    ['2027-01', 546, 250, 2050, -1754, -416, -916],
    ['2027-02', 546, 250, 50, 246, -170, -670],
    ['2027-03', 546, 250, 50, 246, 76, -424],
    ['2027-04', 546, 250, 0, 296, 372, -128]
  ];
  for (const [m, i, f, q, r, b, a] of table) {
    const row = rowOf(sim, m);
    assert.deepEqual([row.prizeIncome + row.otherIncome, row.fixedExpense, row.bucketExpense, row.surplus, row.closing, row.available].map((x) => x / 10000),
      [i, f, q, r, b, a], m);
  }
});
test('공통 검증식 Bₜ − Bₜ₋₁ = Rₜ, Aₜ = Bₜ − S (600개월 전부)', () => {
  const s = X.pension(), sim = L.simulate(s);
  let prev = s.currentCash;
  for (const r of sim.rows) { assert.equal(r.closing - prev, r.surplus); assert.equal(r.available, r.closing - s.reserveAmount); prev = r.closing; }
  assert.equal(sim.rows.length, 600);
});
test('경고 문구 — 1월 현금 부족 416만원, 3월 안전금고 424만원, 12월 모아둔 돈 154만원 (6장 표)', () => {
  const sim = L.simulate(X.pension());
  const w = (m) => { const i = sim.rows.findIndex((r) => r.month === m); return L.warningOf(sim.rows[i], sim.rows[i + 1].fixedExpense); };
  assert.equal(w('2027-01').text, '이 계획은 2027년 1월에 416만원이 부족해요. 지출 월을 옮겨볼까요?');
  assert.equal(w('2027-03').text, '현금은 남지만 안전금고 기준보다 424만원 적어요.');
  assert.equal(w('2026-12').text, '이번 달은 모아둔 돈에서 154만원을 사용해요.');
  assert.equal(w('2026-10'), null);
  assert.equal(L.warningOf({ month: '2026-10', closing: 100, available: 100, surplus: 0 }, 2500000).level, 'low');
});
test('AC06 자동차를 2027년 6월로 옮기면 1월 1,584 · 2월 1,830 · 3월 2,076 · 4월 2,372 · 5월 2,668 · 6월 964, 6월 가용 464', () => {
  const s = X.pension();
  s.buckets.find((b) => b.title === '자동차').targetMonth = '2027-06';
  const sim = L.simulate(s);
  const got = ['2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06'].map((m) => rowOf(sim, m).closing / 10000);
  assert.deepEqual(got, [1584, 1830, 2076, 2372, 2668, 964]);
  assert.equal(rowOf(sim, '2027-06').available, man(464));
  assert.equal(L.firstMonth(sim.rows.slice(0, 12), (r) => r.available < 0), null);   // 안전금고도 유지
});
test('AC07 월 50만원 반복을 3월에 끝내면 3월 50만원, 4월 0원 (양 끝 월 포함)', () => {
  const sim = L.simulate(X.pension());
  assert.equal(rowOf(sim, '2026-10').bucketExpense, 500000);
  assert.equal(rowOf(sim, '2027-03').bucketExpense, 500000);
  assert.equal(rowOf(sim, '2027-04').bucketExpense, 0);
});
test('AC08 2026년 10월부터 240회 → 마지막 2046년 9월, 2046년 10월부터 0원, 합계 1,310,400,000원은 참고용', () => {
  const s = X.pension(), sim = L.simulate(s);
  assert.equal(rowOf(sim, '2046-09').prizeIncome, 5460000);
  assert.equal(rowOf(sim, '2046-10').prizeIncome, 0);
  assert.equal(L.finalPrizeMonth(s), '2046-09');
  const t = L.prizeTotals(s);
  assert.equal(t.monthlyPeriodNet, 1310400000);
  assert.equal(s.currentCash, 10000000);                       // 잔고에 더하지 않음
  assert.equal(sim.rows[0].opening, 10000000);
  assert.equal(sim.rows[0].closing, man(1246));                // 첫 달엔 그달 수령분만
});
test('지급 잔여 — 첫 달은 선택 월 포함 240회 / 지급 후 239회, 마지막 달은 지급 후 0회', () => {
  const e = X.pension().entries[0];
  assert.deepEqual(L.paymentStatus(e, '2026-10'), { endMonth: '2046-09', remainingIncl: 240, remainingAfter: 239, payingNow: true });
  assert.deepEqual(L.paymentStatus(e, '2046-09'), { endMonth: '2046-09', remainingIncl: 1, remainingAfter: 0, payingNow: true });
  assert.equal(L.paymentStatus(e, '2046-10').remainingIncl, 0);
});
test('조회 범위 = 시작 월부터 전체 종료 월 이후 12개월(2047-09), 한도 600개월', () => {
  const v = L.viewRange(X.pension());
  assert.equal(v.end, '2047-09');
  assert.equal(v.months, 252);
});

console.log('\n등수 중복 당첨 (5A)');
test('AC15 연금 1등 1매 + 2등 4매 → 1~120회 858만원, 121~240회 546만원, 241회 0원', () => {
  const s = X.combo(), sim = L.simulate(s);
  assert.equal(sim.rows[0].prizeIncome, man(858));
  assert.equal(sim.rows[119].prizeIncome, man(858));
  assert.equal(sim.rows[119].month, '2036-09');
  assert.equal(sim.rows[120].prizeIncome, man(546));
  assert.equal(sim.rows[239].prizeIncome, man(546));
  assert.equal(sim.rows[240].prizeIncome, 0);
});
test('세전 합계 21억6천만원, 세후 16억8,480만원 (858만×120 + 546만×120) — 잔고에 더하지 않음', () => {
  const t = L.prizeTotals(X.combo());
  assert.equal(t.totalGross, 2160000000);
  assert.equal(t.totalNet, 1684800000);
  assert.equal(t.totalNet, man(858) * 120 + man(546) * 120);
});
test('월 지출 600만원이면 월 잔여금 첫 구간 +258만원, 다음 구간 −54만원', () => {
  const sim = L.simulate(X.combo());
  assert.equal(sim.rows[0].surplus, man(258));
  assert.equal(sim.rows[120].surplus, man(-54));
});
test('2등 지급이 끝나도 1등 수입은 계속된다 (개별 지급 종료 후 수입 지속)', () => {
  const s = X.combo(), sim = L.simulate(s);
  const r = sim.rows[120];
  assert.deepEqual(r.payments.map((p) => p.entryId), ['ex-w3']);
  assert.equal(r.payments[0].remainingAfter, 119);
  assert.equal(sim.rows[119].payments.find((p) => p.entryId === 'ex-w4').remainingAfter, 0);
});
test('AC17 로또 3등 150만원 2게임 + 4등 5만원 1게임 → 세후 305만원 (합계로 다시 과세하지 않음)', () => {
  const s = L.newScenario({ startMonth: '2026-10', entries: [
    L.newEntry('lotto', '3', '2026-10', { unitAmount: 1500000, quantity: 2 }),
    L.newEntry('lotto', '4', '2026-10')] });
  assert.equal(L.prizeTotals(s).lumpNet, 3050000);
  assert.equal(L.lumpSummary(s).N, 3050000);
  assert.notEqual(L.netOf(3000000) + 50000, 3050000);         // 합쳐서 과세하면 틀린다
});
test('AC18 스피또2000 1등 낱장 2매 → 낱장 세금 2억9,700만, 세후 7억300만, 합계 14억600만 (단일 20억이면 13억7,300만)', () => {
  const es = L.presetEntries('speetto2000-set', '2026-12');
  assert.equal(es.length, 1); assert.equal(es[0].quantity, 2);
  assert.equal(L.unitTax(es[0]), 297000000);
  assert.equal(L.unitNet(es[0]), 703000000);
  assert.equal(L.entryTotals(es[0]).net, 1406000000);
  assert.equal(L.netOf(2000000000), 1373000000);
});
test('연금 프리셋 — 1등 1행 수량 1 + 2등 1행 수량 4, 보너스 5매, 반복 클릭하면 새 id', () => {
  const a = L.presetEntries('pension-1-2x4', '2026-10'), b = L.presetEntries('pension-1-2x4', '2026-10');
  assert.deepEqual(a.map((e) => [e.rankCode, e.quantity, e.paymentMonths]), [['1', 1, 240], ['2', 4, 120]]);
  assert.notEqual(a[0].id, b[0].id);
  assert.equal(a[0].bundleId, a[1].bundleId);
  assert.deepEqual(L.presetEntries('pension-bonus5', '2026-10').map((e) => [e.rankCode, e.quantity]), [['bonus', 5]]);
});
test('AC21·AC22 로또 5등 5천원(2026-10) + 연금 2등(2026-12~) → 10월 5천원, 11월 0원, 12월부터 78만원, 2036-11 종료', () => {
  const s = L.newScenario({ startMonth: '2026-10', entries: [
    L.newEntry('lotto', '5', '2026-10'), L.newEntry('pension720', '2', '2026-12')] });
  assert.equal(L.isMonthlyMode(s), true);
  const sim = L.simulate(s);
  assert.deepEqual(['2026-10', '2026-11', '2026-12', '2027-01'].map((m) => rowOf(sim, m).prizeIncome), [5000, 0, 780000, 780000]);
  assert.equal(rowOf(sim, '2036-11').prizeIncome, 780000);
  assert.equal(rowOf(sim, '2036-12').prizeIncome, 0);
  assert.equal(sim.rows.filter((r) => r.prizeIncome === 5000 || r.prizeIncome === 785000).length, 1); // 일시금은 한 번만
});
test('AC22 시작 월 전에 받은 일시금·연금분은 잔고에 다시 넣지 않는다', () => {
  const s = L.newScenario({ startMonth: '2027-01', currentCash: 1000000, entries: [
    L.newEntry('lotto', '4', '2026-11'), L.newEntry('pension720', '2', '2026-11')] });
  const sim = L.simulate(s);
  assert.equal(sim.before.length, 1);
  assert.equal(sim.rows[0].prizeIncome, 780000);
  assert.equal(sim.rows.reduce((a, r) => a + r.prizeIncome, 0), 780000 * 118);   // 120회 중 시작 전 2회 제외
});
test('일시금 수령 월이 다르면 월별 모드, 같으면 일시금 모드', () => {
  const s = L.newScenario({ startMonth: '2026-10', entries: [L.newEntry('lotto', '4', '2026-10'), L.newEntry('lotto', '5', '2026-10')] });
  assert.equal(L.isMonthlyMode(s), false);
  s.entries[1].receiptMonth = '2026-11';
  assert.equal(L.isMonthlyMode(s), true);
});
test('AC19·AC20 같은 복권·게임(awardUnitKey)은 등수가 달라도 중복으로 본다, 다른 게임·보너스는 허용', () => {
  const a = L.newEntry('lotto', '1', '2026-10', { round: '1190', alias: '복권A', game: 'A', unitAmount: 2000000000 });
  const b = L.newEntry('lotto', '5', '2026-10', { round: '1190', alias: '복권A', game: 'A' });
  const c = L.newEntry('lotto', '5', '2026-10', { round: '1190', alias: '복권A', game: 'B' });
  assert.equal(L.findDuplicateUnit([a], b), a);
  assert.equal(L.findDuplicateUnit([a], c), null);
  assert.equal(L.findDuplicateUnit([a], L.newEntry('lotto', '5', '2026-10')), null);   // 식별 정보 없는 가정 입력은 막지 않음
  const p1 = L.newEntry('pension720', '1', '2026-10', { alias: '연금A' }), pb = L.newEntry('pension720', 'bonus', '2026-10', { alias: '연금A' });
  assert.equal(L.findDuplicateUnit([p1], pb), null);
});
test('AC23 수량을 바꾸면 결과가 바로 바뀐다 (2등 4매 → 2매)', () => {
  const s = X.combo();
  s.entries[1].quantity = 2;
  assert.equal(L.simulate(s).rows[0].prizeIncome, 5460000 + 2 * 780000);
});
test('당첨 행을 비활성화하면 수입에서 빠지고 되돌리면 복원된다', () => {
  const s = X.combo(), a = L.simulate(s).rows[0].prizeIncome;
  s.entries[1].active = false;
  assert.equal(L.simulate(s).rows[0].prizeIncome, 5460000);
  s.entries[1].active = true;
  assert.equal(L.simulate(s).rows[0].prizeIncome, a);
});
test('전체 수입 합계 = Σ(수량 × 지급 횟수 × 세후 지급액) (9장 공통 검증식)', () => {
  const s = X.combo(), sim = L.simulate(s);
  assert.equal(sim.rows.reduce((a, r) => a + r.prizeIncome, 0), 1 * 240 * 5460000 + 4 * 120 * 780000);
});

console.log('\n퇴사 가능 기간 (6장)');
test('AC11 가용 1천만원, 월비 3백만원 → 3개월 (floor), 월비 0은 「600개월 내 부족 없음」', () => {
  const s = L.newScenario({ startMonth: '2026-10', currentCash: 10000000 });
  assert.equal(L.retireMonths(s, '', 3000000).months, 3);
  assert.equal(L.retireMonths(s, '', 0).months, null);
  s.forceMonthly = true;                                       // 월별 엔진도 같은 답
  assert.equal(L.retireMonths(s, '2026-10', 3000000).months, 3);
  assert.equal(L.retireMonths(s, '2026-10', 0).months, null);
});
test('일시금 예시 — 가용 2억6,300만원, 월 생활비 300만원 → 87개월(안전금고 유지), 현금 기준 121개월', () => {
  const r = L.retireMonths(X.lump(), '', 3000000);
  assert.equal(r.months, Math.floor(263000000 / 3000000));
  assert.equal(r.cashMonths, Math.floor(363000000 / 3000000));
});
test('시작부터 가용잔고가 음수면 0개월', () => {
  const s = X.lump(); s.reserveAmount = 400000000;
  assert.equal(L.retireMonths(s, '', 1000000).months, 0);
});
test('퇴사하면 급여(퇴사 시 중단)만 멈추고 연금 수입은 유지된다', () => {
  const s = X.pension();
  s.flows.push({ id: 'f-pay', direction: 'in', title: '급여', amount: 3000000, startMonth: '2026-10', endMonth: '', stopOnRetirement: true });
  const sim = L.simulate(s, { retireMonth: '2027-01' });
  assert.equal(rowOf(sim, '2026-12').otherIncome, 3000000);
  assert.equal(rowOf(sim, '2027-01').otherIncome, 0);
  assert.equal(rowOf(sim, '2027-01').prizeIncome, 5460000);
});

console.log('\n입력 검증 · 금액 입력 · 저장 형식');
test('수량 0·음수·소수·101 거부, 없는 등수 거부, 종료 월 역전 거부, 1조 초과 거부', () => {
  const e = (o) => Object.assign(L.newEntry('lotto', '4', '2026-10'), o);
  for (const q of [0, -1, 1.5, 101]) assert.ok(L.validateEntry(e({ quantity: q })).quantity, 'q=' + q);
  assert.ok(L.validateEntry(e({ rankCode: '9' })).rankCode);
  assert.ok(L.validateEntry(e({ unitAmount: 1000000000001 })).unitAmount);
  assert.ok(L.ok(L.validateEntry(e({ unitAmount: 1000000000000 }))));
  const b = { title: '여행', amount: 1, kind: 'monthly', startMonth: '2027-03', endMonth: '2027-01' };
  assert.ok(L.validBucket(b, true).endMonth);
  assert.ok(L.validBucket({ title: '여행', amount: 0, kind: 'once' }, false).amount);
  assert.ok(L.validBucket({ title: '여행', amount: 1, kind: 'once', targetMonth: '' }, true).targetMonth);   // 월별에선 지출 월 필수
  assert.ok(L.ok(L.validBucket({ title: '여행', amount: 1, kind: 'once', targetMonth: '' }, false)));
});
test('오류가 있는 당첨 행은 계산에 넣지 않는다', () => {
  const s = L.newScenario({ startMonth: '2026-10', entries: [L.newEntry('lotto', '1', '2026-10')] });   // 1등 금액 미입력
  assert.equal(L.prizeTotals(s).lumpNet, 0);
});
test('금액 입력 보조 — 1억 8천만 · 5천만원 · 150만 · 2,000,000 · 1.5억 · 3억100', () => {
  assert.equal(L.parseKrw('1억 8천만'), 180000000);
  assert.equal(L.parseKrw('5천만원'), 50000000);
  assert.equal(L.parseKrw('150만'), 1500000);
  assert.equal(L.parseKrw('2,000,000'), 2000000);
  assert.equal(L.parseKrw('1.5억'), 150000000);
  assert.equal(L.parseKrw('3억100'), 300000100);
  assert.equal(L.parseKrw('많이'), null);
  assert.equal(L.parseKrw('만억'), null);
});
test('한글 단위 표기 — 13억 7,300만원 · 416만원 · 5,000원 · 1만 2,345원', () => {
  assert.equal(L.korWon(1373000000), '13억 7,300만원');
  assert.equal(L.korWon(4160000), '416만원');
  assert.equal(L.korWon(5000), '5,000원');
  assert.equal(L.korWon(12345), '1만 2,345원');
  assert.equal(L.korWon(-4160000), '−416만원');
  assert.equal(L.won(1310400000), '1,310,400,000원');
});
test('로또 평균 G = round(ΣP/N), 누락·0 제외, 최근 52회 (2단계 준비용 식)', () => {
  assert.deepEqual(L.lottoAverage([100, 200, null, 0, 301]), { mean: 200, n: 3 });
  assert.equal(L.lottoAverage([]), null);
  assert.equal(L.lottoAverage(Array.from({ length: 60 }, (_, i) => i + 1)).n, 52);
});
test('가져오기 검증 — 예시 3종 통과, schemaVersion 다르면 거부, id 중복 거부', () => {
  for (const f of [X.lump, X.pension, X.combo]) assert.deepEqual(L.checkScenario(f()), []);
  const s = X.lump(); s.schemaVersion = 1;
  assert.ok(L.checkScenario(s).length > 0);
  const d = X.lump(); d.buckets[1].id = d.buckets[0].id;
  assert.ok(L.checkScenario(d).some((m) => /id/.test(m)));
});
test('안전금고 한도 — 일시금은 당첨 후 잔고, 월별은 현재 잔고 + 첫 달 수령액', () => {
  assert.equal(L.reserveLimit(X.lump()), 1393000000);
  assert.equal(L.reserveLimit(X.pension()), 10000000 + 5460000);
});
test('JSON 으로 저장했다 불러와도 계산 결과가 같다 (AC14)', () => {
  const s = X.pension(), back = JSON.parse(JSON.stringify(s));
  assert.deepEqual(L.simulate(back).rows.slice(0, 12), L.simulate(s).rows.slice(0, 12));
});

console.log(`\n${passed}개 통과${process.exitCode ? ' — 실패 있음' : ''}`);
