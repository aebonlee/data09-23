/*
 * 기획서 5장 「계산 예시와 기대 결과」를 그대로 옮긴 예시 시나리오.
 * 화면의 「예시 불러오기」와 테스트(test/logic.test.mjs)가 같은 것을 씁니다.
 * 금액은 기획서가 밝힌 대로 계산 검증용 가정값이며 실제 평균 당첨액이 아닙니다.
 */
(function (root) {
  'use strict';
  var L = root.HCLogic || (typeof require !== 'undefined' ? require('./logic.js') : null);

  function bucket(id, title, amount, category, over) {
    return Object.assign({ id: id, title: title, amount: amount, category: category, priority: '하고 싶음', active: true,
      kind: 'once', targetMonth: '2026-10', startMonth: '', endMonth: '', note: '', sortOrder: 0 }, over || {});
  }

  // 일시금 예시 — 세전 20억원, 현재 잔고 2천만원, 안전금고 1억원, 집·자동차·여행
  function lump() {
    return L.newScenario({ id: 'ex-lump', title: '예시 · 일시금 20억원', startMonth: '2026-10',
      currentCash: 20000000, reserveAmount: 100000000,
      entries: [L.newEntry('custom', 'custom', '2026-10', { id: 'ex-w1', title: '검증용 가정값', unitAmount: 2000000000 })],
      buckets: [
        bucket('ex-b1', '집', 800000000, '주거', { priority: '필수', sortOrder: 1 }),
        bucket('ex-b2', '자동차', 180000000, '이동', { sortOrder: 2 }),
        bucket('ex-b3', '여행', 50000000, '여행', { priority: '여유 있으면', sortOrder: 3 })
      ], flows: [] });
  }

  // 연금복권 예시 — 1등 1매(세후 546만원) 2026년 10월부터, 고정지출 250만원, 반복 버킷 50만원(2027년 3월까지),
  // 2026년 12월 여행 400만원, 2027년 1월 자동차 2천만원
  function pension() {
    return L.newScenario({ id: 'ex-pension', title: '예시 · 연금복권 1등', startMonth: '2026-10',
      currentCash: 10000000, reserveAmount: 5000000,
      entries: [L.newEntry('pension720', '1', '2026-10', { id: 'ex-w2' })],
      buckets: [
        bucket('ex-b4', '매달 여가비', 500000, '휴식', { kind: 'monthly', targetMonth: '', startMonth: '2026-10', endMonth: '2027-03', sortOrder: 1 }),
        bucket('ex-b5', '여행', 4000000, '여행', { targetMonth: '2026-12', sortOrder: 2 }),
        bucket('ex-b6', '자동차', 20000000, '이동', { targetMonth: '2027-01', sortOrder: 3 })
      ],
      flows: [{ id: 'ex-f1', direction: 'out', title: '생활비', amount: 2500000, startMonth: '2026-10', endMonth: '', stopOnRetirement: false }] });
  }

  // 5A — 연금복권 1등 1매 + 2등 4매, 모두 2026년 10월 첫 지급, 월 지출 합계 600만원
  function combo() {
    var es = L.presetEntries('pension-1-2x4', '2026-10');
    es[0].id = 'ex-w3'; es[1].id = 'ex-w4';
    return L.newScenario({ id: 'ex-combo', title: '예시 · 연금 1등 + 2등 4매', startMonth: '2026-10',
      currentCash: 0, reserveAmount: 0, entries: es, buckets: [],
      flows: [{ id: 'ex-f2', direction: 'out', title: '고정지출과 버킷 합계', amount: 6000000, startMonth: '2026-10', endMonth: '', stopOnRetirement: false }] });
  }

  var API = { lump: lump, pension: pension, combo: combo,
    list: [{ id: 'lump', label: '일시금 20억원 (집·자동차·여행)' }, { id: 'pension', label: '연금복권 1등 (월별 현금흐름)' }, { id: 'combo', label: '연금복권 1등 + 2등 4매' }] };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.HCExamples = API;
})(typeof window !== 'undefined' ? window : this);
