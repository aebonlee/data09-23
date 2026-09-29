/*
 * 저장소 — 이 브라우저의 localStorage 한 칸(`data09-23.db`)에 시나리오 목록을 둡니다.
 * 저장이 막힌 브라우저(사생활 보호 창 등)에서도 화면은 돌아가고, 실패를 알려 줍니다.
 *   { schemaVersion: 2, currentId, scenarios: [Scenario, …] }
 */
(function (root) {
  'use strict';
  var KEY = 'data09-23.db';
  var L = root.HCLogic;

  function read() {
    try {
      var raw = root.localStorage.getItem(KEY);
      if (!raw) return null;
      var db = JSON.parse(raw);
      if (!db || !Array.isArray(db.scenarios)) return null;
      db.scenarios = db.scenarios.filter(function (s) { return L.checkScenario(s).length === 0; });
      return db;
    } catch (e) { return null; }
  }
  // 성공하면 true, 실패하면 오류 문구
  function write(db) {
    try { root.localStorage.setItem(KEY, JSON.stringify(db)); return true; }
    catch (e) { return (e && e.name === 'QuotaExceededError') ? '저장 공간이 가득 찼어요' : '이 브라우저에서는 저장할 수 없어요'; }
  }
  function clear() { try { root.localStorage.removeItem(KEY); return true; } catch (e) { return false; } }

  root.HCStore = { KEY: KEY, read: read, write: write, clear: clear };
})(window);
