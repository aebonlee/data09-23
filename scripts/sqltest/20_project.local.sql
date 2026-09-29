-- ============================================================================
-- 로컬 검증 전용 — data09-23 프로젝트별 검증 (운영 실행 금지, 가드 내장)
--
--  사용자 A·B 두 명과 비로그인(anon)을 번갈아 흉내 내어
--  ① 본인 행만 보이는가 ② 남의 시나리오에 당첨·버킷·현금흐름을 끼워 넣을 수 없는가
--  ③ anon 은 아무것도 못 하는가 ④ CHECK·UNIQUE·외래키·행 수 한도가 걸리는가
--  ⑤ 함수 권한에 PUBLIC·anon 이 남지 않았는가 를 잰다.
-- ============================================================================

do $guard$
begin
  if exists (select 1 from pg_roles where rolname in ('supabase_admin', 'authenticator'))
     or exists (select 1 from pg_namespace where nspname = 'graphql') then
    raise exception '이 파일은 로컬 검증 전용입니다. 운영 데이터베이스에서 실행할 수 없습니다.';
  end if;
end;
$guard$;

-- 지정한 SQLSTATE 로 실패해야 통과. 현재 역할(invoker)로 실행된다.
create or replace function public._assert_raises(p_sql text, p_state text, p_label text)
returns void language plpgsql set search_path = public as $fn$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_state then raise notice '  OK   %', p_label; return; end if;
    raise exception 'FAIL  %  (기대 SQLSTATE %, 실제 % — %)', p_label, p_state, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL  %  (기대 SQLSTATE % 인데 성공했다)', p_label, p_state;
end;
$fn$;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'b@example.com')
on conflict (id) do nothing;

do $t$ begin raise notice '[프로젝트] data09-23 — 소유자 격리 · 시나리오 소속 · anon 차단 · 제약 · 함수 권한'; end $t$;

-- ----------------------------------------------------------------------------
-- 1. 사용자 A 가 기획서 5장 연금 예시를 저장한다
-- ----------------------------------------------------------------------------
begin;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local role authenticated;
do $t$
begin
  insert into public.scenario (scenario_id, title, start_month, current_cash, reserve_amount)
  values ('s-a1', '연금복권 1등', '2026-10', 10000000, 5000000);
  insert into public.winning (scenario_id, winning_id, product_id, rank_code, unit_amount, payout_type, first_payment_month, payment_months)
  values ('s-a1', 'w-1', 'pension720', '1', 7000000, 'monthly', '2026-10', 240);
  insert into public.winning (scenario_id, winning_id, product_id, rank_code, quantity, unit_amount, payout_type, first_payment_month, payment_months)
  values ('s-a1', 'w-2', 'pension720', '2', 4, 1000000, 'monthly', '2026-10', 120);
  insert into public.bucket (scenario_id, bucket_id, title, amount, category, kind, start_month, end_month)
  values ('s-a1', 'k-1', '매달 여가비', 500000, '휴식', 'monthly', '2026-10', '2027-03');
  insert into public.bucket (scenario_id, bucket_id, title, amount, category, kind, target_month)
  values ('s-a1', 'k-2', '자동차', 20000000, '이동', 'once', '2027-01');
  insert into public.cashflow (scenario_id, cashflow_id, direction, title, amount, start_month)
  values ('s-a1', 'f-1', 'out', '생활비', 2500000, '2026-10');

  perform public._assert_eq((select owner_id from public.winning where winning_id = 'w-1'),
    '11111111-1111-1111-1111-111111111111'::uuid, 'owner_id 기본값이 auth.uid() 로 채워진다');
  perform public._assert_eq((select sum(quantity) from public.winning), 5::bigint, 'A 는 자기 당첨 건(1등 1 + 2등 4)을 본다');
end $t$;
commit;

begin;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local role authenticated;
do $t$
begin
  update public.bucket set target_month = '2027-06' where bucket_id = 'k-2';
  perform public._assert((select updated_at > created_at from public.bucket where bucket_id = 'k-2'),
    'updated_at 트리거가 수정 시각을 갱신한다 (자동차 6월로 이동)');
end $t$;
commit;

-- ----------------------------------------------------------------------------
-- 2. 사용자 B — A 의 행을 보지도, 고치지도, 지우지도, 대신 쓰지도 못한다
-- ----------------------------------------------------------------------------
begin;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
set local role authenticated;
do $t$
declare n bigint;
begin
  perform public._assert_eq(
    (select count(*) from public.scenario) + (select count(*) from public.winning)
    + (select count(*) from public.bucket) + (select count(*) from public.cashflow),
    0::bigint, 'B 에게는 A 의 행이 4개 표 어디에서도 보이지 않는다');

  update public.winning set quantity = 100 where winning_id = 'w-2';
  get diagnostics n = row_count;
  perform public._assert_eq(n, 0::bigint, 'B 의 UPDATE 는 A 의 당첨 건에 닿지 않는다');

  delete from public.scenario;
  get diagnostics n = row_count;
  perform public._assert_eq(n, 0::bigint, 'B 의 DELETE 는 A 의 시나리오에 닿지 않는다');

  perform public._assert_raises(
    $s$insert into public.scenario (owner_id, scenario_id, title, start_month) values ('11111111-1111-1111-1111-111111111111', 's-x', '끼워넣기', '2026-10')$s$,
    '42501', 'B 는 owner_id 를 A 로 적어 대신 쓸 수 없다');

  -- B 가 A 의 시나리오 id('s-a1')를 알아냈다고 가정한다
  perform public._assert_raises(
    $s$insert into public.bucket (scenario_id, bucket_id, title, amount, kind, target_month) values ('s-a1', 'k-x', '남의 시나리오', 1, 'once', '2026-10')$s$,
    '23503', 'B 는 자기 owner_id 로라도 A 의 시나리오에 버킷을 붙일 수 없다 (복합 외래키)');
  perform public._assert_raises(
    $s$insert into public.winning (scenario_id, winning_id, product_id, rank_code, unit_amount, payout_type, receipt_month) values ('s-a1', 'w-x', 'lotto', '5', 5000, 'lump', '2026-10')$s$,
    '23503', 'B 는 A 의 시나리오에 당첨 건을 붙일 수 없다');

  -- 같은 id 라도 사용자가 다르면 따로 저장된다
  insert into public.scenario (scenario_id, title, start_month) values ('s-a1', 'B 의 시나리오', '2026-10');
  perform public._assert_eq((select count(*) from public.scenario), 1::bigint, '같은 시나리오 id 라도 사용자가 다르면 따로 저장된다');

  -- 자기 행을 A 에게 넘기는 UPDATE 는 WITH CHECK 가 막는다 (WHERE 없이 — SELECT 정책이 먼저 걸려 헛도는 것을 피함)
  perform public._assert_raises(
    $s$update public.scenario set owner_id = '11111111-1111-1111-1111-111111111111'$s$,
    '42501', 'B 는 자기 행의 owner_id 를 A 로 넘길 수 없다 (with check)');
end $t$;
commit;

do $t$
begin
  perform public._assert_eq((select quantity from public.winning
      where owner_id = '11111111-1111-1111-1111-111111111111' and winning_id = 'w-2'),
    4, 'B 의 시도 뒤에도 A 의 2등 수량은 4 그대로다');
  perform public._assert_eq((select count(*) from public.scenario
      where owner_id = '11111111-1111-1111-1111-111111111111'), 1::bigint, 'B 의 시도 뒤에도 A 의 시나리오는 그대로다');
end $t$;

-- ----------------------------------------------------------------------------
-- 3. 비로그인(anon) — 읽기도 쓰기도 막힌다
-- ----------------------------------------------------------------------------
begin;
set local request.jwt.claim.sub = '';
set local role anon;
do $t$
declare t text;
begin
  foreach t in array array['scenario','winning','bucket','cashflow']
  loop
    perform public._assert_raises(format('select * from public.%I', t), '42501', 'anon 은 ' || t || ' 를 읽을 수 없다');
  end loop;
  perform public._assert_raises(
    $s$insert into public.scenario (scenario_id, title, start_month) values ('s-anon', 'x', '2026-10')$s$, '42501', 'anon 은 시나리오를 만들 수 없다');
end $t$;
commit;

-- ----------------------------------------------------------------------------
-- 4. 정책 구조
-- ----------------------------------------------------------------------------
do $t$
declare v_bad text;
begin
  select string_agg(p.polname, ', ') into v_bad
    from pg_policy p join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
         not like '%owner_id = auth.uid()%';
  perform public._assert(v_bad is null,
    '모든 정책이 owner_id = auth.uid() 로 묶여 있다' || coalesce(' (발견: ' || v_bad || ')', ''));
  perform public._assert_eq((select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
     join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'),
    16::bigint, '정책 수가 16개다 (4개 표 × 4, 재실행해도 늘지 않는다)');
end $t$;

-- ----------------------------------------------------------------------------
-- 5. CHECK · UNIQUE · 외래키 · 행 수 한도 (기획서 8장 무결성과 금액 한도)
-- ----------------------------------------------------------------------------
begin;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local role authenticated;
do $t$
begin
  perform public._assert_raises($s$insert into public.winning (scenario_id, winning_id, product_id, rank_code, quantity, unit_amount, payout_type, receipt_month) values ('s-a1', 'w-3', 'lotto', '4', 0, 50000, 'lump', '2026-10')$s$,
    '23514', '수량 0 은 막는다');
  perform public._assert_raises($s$insert into public.winning (scenario_id, winning_id, product_id, rank_code, quantity, unit_amount, payout_type, receipt_month) values ('s-a1', 'w-3', 'lotto', '4', 101, 50000, 'lump', '2026-10')$s$,
    '23514', '수량 101 은 막는다');
  perform public._assert_raises($s$insert into public.winning (scenario_id, winning_id, product_id, rank_code, unit_amount, payout_type, receipt_month) values ('s-a1', 'w-3', 'custom', 'custom', 1000000000001, 'lump', '2026-10')$s$,
    '23514', '1조원을 넘는 금액은 막는다');
  perform public._assert_raises($s$insert into public.winning (scenario_id, winning_id, product_id, rank_code, unit_amount, payout_type, receipt_month) values ('s-a1', 'w-3', 'powerball', '1', 1, 'lump', '2026-10')$s$,
    '23514', '없는 복권 종류는 막는다');
  perform public._assert_raises($s$insert into public.winning (scenario_id, winning_id, product_id, rank_code, unit_amount, payout_type) values ('s-a1', 'w-3', 'pension720', '2', 1000000, 'monthly')$s$,
    '23514', '월 지급인데 첫 지급 월이 없으면 막는다');
  perform public._assert_raises($s$insert into public.winning (scenario_id, winning_id, product_id, rank_code, unit_amount, payout_type, receipt_month) values ('s-a1', 'w-3', 'lotto', '5', 5000, 'lump', '2026-13')$s$,
    '23514', '없는 달(2026-13)은 막는다');
  perform public._assert_raises($s$insert into public.winning (scenario_id, winning_id, product_id, rank_code, unit_amount, payout_type, receipt_month) values ('s-a1', 'w-1', 'lotto', '5', 5000, 'lump', '2026-10')$s$,
    '23505', '같은 당첨 id 는 두 번 넣을 수 없다');

  -- 같은 복권·게임(awardUnitKey)은 등수가 달라도 한 번만 (AC20), 다른 게임은 허용 (AC19)
  insert into public.winning (scenario_id, winning_id, product_id, rank_code, unit_amount, payout_type, receipt_month, draw_round, alias, game)
  values ('s-a1', 'w-4', 'lotto', '4', 50000, 'lump', '2026-10', '1190', '지갑', 'A');
  perform public._assert_raises($s$insert into public.winning (scenario_id, winning_id, product_id, rank_code, unit_amount, payout_type, receipt_month, draw_round, alias, game) values ('s-a1', 'w-5', 'lotto', '5', 5000, 'lump', '2026-10', '1190', '지갑', 'A')$s$,
    '23505', '같은 복권·같은 게임에 두 번째 등수를 넣으면 막는다');
  insert into public.winning (scenario_id, winning_id, product_id, rank_code, unit_amount, payout_type, receipt_month, draw_round, alias, game)
  values ('s-a1', 'w-6', 'lotto', '5', 5000, 'lump', '2026-10', '1190', '지갑', 'B');
  insert into public.winning (scenario_id, winning_id, product_id, rank_code, unit_amount, payout_type, receipt_month)
  values ('s-a1', 'w-7', 'lotto', '5', 5000, 'lump', '2026-10'), ('s-a1', 'w-8', 'lotto', '5', 5000, 'lump', '2026-10');
  perform public._assert(true, '다른 게임·별칭 없는 가정 입력은 여러 번 넣을 수 있다');

  perform public._assert_raises($s$insert into public.bucket (scenario_id, bucket_id, title, amount, kind, target_month) values ('s-a1', 'k-3', '공짜', 0, 'once', '2026-10')$s$,
    '23514', '지출은 1원 이상이다');
  perform public._assert_raises($s$insert into public.bucket (scenario_id, bucket_id, title, amount, kind, start_month, end_month) values ('s-a1', 'k-3', '역전', 1, 'monthly', '2027-03', '2027-01')$s$,
    '23514', '반복 버킷의 종료 월이 시작 월보다 빠르면 막는다');
  perform public._assert_raises($s$insert into public.bucket (scenario_id, bucket_id, title, amount, kind, target_month, category) values ('s-a1', 'k-3', 'x', 1, 'once', '2026-10', '투자')$s$,
    '23514', '카테고리는 기획서의 7가지만 받는다');
  perform public._assert_raises($s$insert into public.bucket (scenario_id, bucket_id, title, amount, kind, target_month) values ('s-a1', 'k-3', '   ', 1, 'once', '2026-10')$s$,
    '23514', '버킷 제목은 비워 둘 수 없다');
  perform public._assert_raises($s$insert into public.cashflow (scenario_id, cashflow_id, direction, title, amount, start_month, end_month) values ('s-a1', 'f-2', 'out', '보험', 100000, '2027-01', '2026-12')$s$,
    '23514', '고정지출 종료 월 역전은 막는다');
  perform public._assert_raises($s$update public.scenario set reserve_amount = -1$s$,
    '23514', '안전금고는 0 이상이다');
  perform public._assert_raises($s$insert into public.bucket (scenario_id, bucket_id, title, amount, kind, target_month) values ('s-none', 'k-9', 'x', 1, 'once', '2026-10')$s$,
    '23503', '없는 시나리오에는 버킷을 붙일 수 없다');
end $t$;
commit;

-- 당첨 행 100개 한도 (8장)
begin;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local role authenticated;
do $t$
declare have int;
begin
  select count(*) into have from public.winning where scenario_id = 's-a1';
  insert into public.winning (scenario_id, winning_id, product_id, rank_code, unit_amount, payout_type, receipt_month)
  select 's-a1', 'lim-' || g, 'lotto', '5', 5000, 'lump', '2026-10' from generate_series(1, 100 - have) g;
  perform public._assert_eq((select count(*) from public.winning where scenario_id = 's-a1'), 100::bigint, '당첨 행 100개까지는 들어간다');
  perform public._assert_raises($s$insert into public.winning (scenario_id, winning_id, product_id, rank_code, unit_amount, payout_type, receipt_month) values ('s-a1', 'lim-x', 'lotto', '5', 5000, 'lump', '2026-10')$s$,
    '23514', '101번째 당첨 행은 막는다');
end $t$;
commit;

-- 시나리오를 지우면 종속 행도 함께 지워진다 (8장)
begin;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local role authenticated;
do $t$
begin
  delete from public.scenario where scenario_id = 's-a1';
  perform public._assert_eq(
    (select count(*) from public.winning) + (select count(*) from public.bucket) + (select count(*) from public.cashflow),
    0::bigint, '시나리오를 지우면 당첨·버킷·현금흐름도 함께 지워진다');
end $t$;
commit;

-- ----------------------------------------------------------------------------
-- 6. 함수 권한 · search_path · 표 권한
-- ----------------------------------------------------------------------------
do $t$
declare v_bad text;
begin
  -- proacl 이 NULL 이면 "기본값 = PUBLIC 에 EXECUTE" 라는 뜻이다. NULL 도 실패로 본다.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname not like '\_assert%'
     and (p.proacl is null
          or exists (select 1 from aclexplode(p.proacl) a
                      where a.privilege_type = 'EXECUTE'
                        and (a.grantee = 0 or a.grantee = 'anon'::regrole::oid)));
  perform public._assert(v_bad is null,
    'proacl 에 PUBLIC·anon EXECUTE 가 없다' || coalesce(' (발견: ' || v_bad || ')', ''));

  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname not like '\_assert%'
     and not coalesce('search_path=public' = any(p.proconfig), false);
  perform public._assert(v_bad is null,
    '모든 함수에 search_path = public 이 고정돼 있다' || coalesce(' (발견: ' || v_bad || ')', ''));

  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT')
          or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE'));
  perform public._assert(v_bad is null,
    'anon 에 표 권한이 남지 않았다 (Supabase 자동 부여를 끊었다)' || coalesce(' (발견: ' || v_bad || ')', ''));
end $t$;

-- 정리
delete from public.scenario;
delete from auth.users where email in ('a@example.com', 'b@example.com');

do $t$ begin raise notice ''; raise notice '전부 통과했습니다.'; end $t$;
