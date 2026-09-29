/*
 * 행복회로 버킷리스트 - UI 전용 스크립트
 * ------------------------------------------------------------
 * 계산/저장 로직(app.js, logic.js, store.js)과 시각 효과를 분리해
 * 향후 디자인을 바꾸더라도 핵심 계산 기능에 영향을 주지 않도록 했습니다.
 */
(function () {
  'use strict';

  // 같은 페이지 앵커 이동 시 부드럽게 이동합니다.
  // 사용자가 '동작 줄이기'를 켠 경우 CSS 설정을 존중해 즉시 이동합니다.
  document.querySelectorAll('a[href^="#"]').forEach(function (link) {
    link.addEventListener('click', function (event) {
      var target = document.querySelector(link.getAttribute('href'));
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // 입력/결과 영역에 진입하면 상단 헤더에 얇은 그림자를 주어
  // 현재 화면과 내비게이션의 층위를 시각적으로 구분합니다.
  var header = document.querySelector('.site-header');
  function syncHeader() {
    if (!header) return;
    header.classList.toggle('is-scrolled', window.scrollY > 12);
  }
  window.addEventListener('scroll', syncHeader, { passive: true });
  syncHeader();
})();
