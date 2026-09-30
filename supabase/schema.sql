-- ============================================================================
-- data09-23 — 행복회로 버킷리스트
-- Supabase(PostgreSQL) DB 스키마 + RLS
--
--  실행 위치 : 수강생 본인 Supabase 프로젝트의 SQL Editor 에서 실행
--              (Dashboard → SQL Editor → 이 파일 전체를 붙여넣고 Run)
--  재실행    : 안전합니다 (IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS 선행)
--
--  지금 도구는 브라우저 localStorage 의 `data09-23.db` 한 칸에 시나리오 목록을 저장합니다.
--  시나리오 하나가 scenario 한 행이고, 그 안의 entries·buckets·flows 배열이 각각
--  winning·bucket·cashflow 표가 됩니다. 필드 이름은 도구의 이름을 snake_case 로 옮겼습니다.
--    각 레코드의 id → scenario_id · winning_id · bucket_id · cashflow_id
--    round → draw_round (SQL 함수 round 와 헷갈리지 않게)
--
--  표 목록 (기획서 v1.1 8장 데이터 구조)
--    scenario   시나리오 — 시작 월, 현재 잔고, 안전금고, 퇴사 계산 조건
--    winning    당첨 건 (WinningEntry) — 복권·등수·수량·1건당 금액·지급 방식·월
--    bucket     버킷 (BucketItem) — 일시성(지출 월) / 반복성(시작·종료 월)
--    cashflow   고정지출·기타 수입 (CashflowRule)
--  계산 결과(MonthlyResult)는 파생 데이터라 저장하지 않습니다(8장).
--
--  권한 원칙 : 모든 행은 만든 사람(owner_id = auth.uid())만 보고 고칩니다.
--              당첨·버킷·현금흐름은 (owner_id, scenario_id) 복합 외래키로 시나리오를
--              가리켜, 남의 시나리오에 행을 끼워 넣을 수 없게 합니다.
--              시나리오를 지우면 종속 행도 함께 지웁니다(8장 무결성).
--  금액 한도  : 한 입력 금액 0~1조원, 수량 1~100, 계산 기간 600개월 (8장)
--  이 스키마는 수강생 본인 프로젝트 전제라 테이블 이름에 접두사를 붙이지 않았습니다.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. 실행 위치 가드 — 드림아이티비즈 공용 프로젝트에서는 여기서 멈춘다
--   이 파일은 접두사 없는 이름(scenario · winning · set_updated_at() · check_row_limit() …)을 쓴다. 공용 프로젝트에는 같은 이름의
--   개체가 이미 있을 수 있고 다른 사이트 정책이 그것을 쓰므로, 실행하면 그 사이트들이
--   깨진다(2026-09-30 실제 사고 — data09-01 schema.sql 이 공용 프로젝트의 is_admin() 을 덮어씀).
-- ----------------------------------------------------------------------------
do $guard$
begin
  if to_regclass('public.www_profiles') is not null or to_regclass('public.user_profiles') is not null then
    raise exception '공용 프로젝트입니다 — schema.sql 은 수강생 본인 Supabase 프로젝트 전용입니다. 공용 프로젝트에서는 실행하지 마세요.';
  end if;
end;
$guard$;

-- ----------------------------------------------------------------------------
-- 1. 테이블
-- ----------------------------------------------------------------------------

create table if not exists public.scenario (
  id              bigint generated always as identity primary key,
  owner_id        uuid not null default auth.uid(),
  scenario_id     text not null,
  schema_version  int  not null default 2 check (schema_version = 2),
  title           text not null check (length(trim(title)) > 0),
  start_month     text not null check (start_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  current_cash    bigint not null default 0 check (current_cash between 0 and 1000000000000),
  reserve_amount  bigint not null default 0 check (reserve_amount between 0 and 1000000000000),
  force_monthly   boolean not null default false,
  retire_month    text check (retire_month is null or retire_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  living          bigint not null default 0 check (living between 0 and 1000000000000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- upsert onConflict = 'owner_id,scenario_id'
  constraint scenario_uniq unique (owner_id, scenario_id)
);

create table if not exists public.winning (
  id                   bigint generated always as identity primary key,
  owner_id             uuid not null default auth.uid(),
  scenario_id          text not null,
  winning_id           text not null,
  product_id           text not null check (product_id in ('lotto', 'pension720', 'speetto500', 'speetto1000', 'speetto2000', 'custom')),
  rank_code            text not null check (length(rank_code) between 1 and 10),
  title                text not null default '',
  quantity             int  not null default 1 check (quantity between 1 and 100),
  input_mode           text not null default 'gross' check (input_mode in ('gross', 'net')),
  unit_amount          bigint not null check (unit_amount between 1 and 1000000000000),   -- 1건당 일시금 또는 월액
  payout_type          text not null check (payout_type in ('lump', 'monthly')),
  receipt_month        text check (receipt_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  first_payment_month  text check (first_payment_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  payment_months       int  not null default 0 check (payment_months between 0 and 600),
  draw_round           text not null default '',
  alias                text not null default '',     -- 복권 식별 별칭(실물 번호 아님)
  game                 text not null default '',
  active               boolean not null default true,
  bundle_id            text not null default '',
  preset_version       text not null default '',
  tax_rule_version     text not null default '',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint winning_uniq unique (owner_id, winning_id),
  -- 일시금은 수령 월, 월 지급은 첫 지급 월·지급기간이 있어야 한다
  constraint winning_payout check (
    (payout_type = 'lump' and receipt_month is not null)
    or (payout_type = 'monthly' and first_payment_month is not null and payment_months >= 1)),
  constraint winning_scenario_fk foreign key (owner_id, scenario_id)
    references public.scenario (owner_id, scenario_id) on delete cascade on update cascade
);
-- 같은 실제 당첨 단위(awardUnitKey)는 한 번만 — 별칭이 있을 때만 (2A · AC19·AC20)
create unique index if not exists winning_award_unit_uniq
  on public.winning (owner_id, scenario_id, product_id, draw_round, alias, game, (rank_code = 'bonus'))
  where alias <> '';
create index if not exists winning_scenario_idx on public.winning (owner_id, scenario_id);

create table if not exists public.bucket (
  id            bigint generated always as identity primary key,
  owner_id      uuid not null default auth.uid(),
  scenario_id   text not null,
  bucket_id     text not null,
  title         text not null check (length(trim(title)) > 0),
  amount        bigint not null check (amount between 1 and 1000000000000),   -- 지출은 1원 이상
  category      text not null default '기타' check (category in ('주거', '이동', '여행', '가족', '취미', '휴식', '기타')),
  priority      text not null default '하고 싶음' check (priority in ('필수', '하고 싶음', '여유 있으면')),
  active        boolean not null default true,       -- false = 보류(목록에 남기되 지출 제외)
  kind          text not null check (kind in ('once', 'monthly')),
  target_month  text check (target_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  start_month   text check (start_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  end_month     text check (end_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  note          text not null default '',
  sort_order    int  not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint bucket_uniq unique (owner_id, bucket_id),
  -- 반복은 시작·종료 월이 모두 있고 종료가 시작보다 빠르지 않다 (YYYY-MM 은 글자 순서 = 시간 순서)
  constraint bucket_months check (kind = 'once' or (start_month is not null and end_month is not null and start_month <= end_month)),
  constraint bucket_scenario_fk foreign key (owner_id, scenario_id)
    references public.scenario (owner_id, scenario_id) on delete cascade on update cascade
);
create index if not exists bucket_scenario_idx on public.bucket (owner_id, scenario_id);

create table if not exists public.cashflow (
  id                  bigint generated always as identity primary key,
  owner_id            uuid not null default auth.uid(),
  scenario_id         text not null,
  cashflow_id         text not null,
  direction           text not null check (direction in ('in', 'out')),   -- in = 기타 수입, out = 고정지출
  title               text not null check (length(trim(title)) > 0),
  amount              bigint not null check (amount between 1 and 1000000000000),
  start_month         text not null check (start_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  end_month           text check (end_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),   -- 비우면 계산 한도까지
  stop_on_retirement  boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint cashflow_uniq unique (owner_id, cashflow_id),
  constraint cashflow_months check (end_month is null or start_month <= end_month),
  constraint cashflow_scenario_fk foreign key (owner_id, scenario_id)
    references public.scenario (owner_id, scenario_id) on delete cascade on update cascade
);
create index if not exists cashflow_scenario_idx on public.cashflow (owner_id, scenario_id);

-- 2026-09-30 추가 예상 수입(수강생 답) — 기간이 정해진 수입. 안전금고 한도(월별 = 현재 잔고
-- + 시작 월 수령액 + 추가 예상 수입)에 들어가므로 수입이어야 하고 종료 월이 꼭 있어야 한다.
-- 기존 설치에도 다시 돌릴 수 있게 add column if not exists + 제약은 지우고 다시 만든다.
alter table public.cashflow add column if not exists expected boolean not null default false;
alter table public.cashflow drop constraint if exists cashflow_expected;
alter table public.cashflow add constraint cashflow_expected
  check (not expected or (direction = 'in' and end_month is not null));

-- ----------------------------------------------------------------------------
-- 2. 함수 · 트리거
--
--  search_path 를 고정한다. 고정하지 않으면 호출자의 search_path 에 따라
--  엉뚱한 스키마의 객체를 잡을 수 있다.
-- ----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

-- 한 시나리오의 행 수 한도(8장) — 당첨 100 · 버킷 500 · 현금흐름 500
create or replace function public.check_row_limit()
returns trigger language plpgsql set search_path = public as $fn$
declare n int; lim int;
begin
  lim := case tg_table_name when 'winning' then 100 else 500 end;
  execute format('select count(*) from public.%I where owner_id = $1 and scenario_id = $2', tg_table_name)
    into n using new.owner_id, new.scenario_id;
  if n >= lim then
    raise exception '한 시나리오의 % 행은 %개까지입니다', tg_table_name, lim using errcode = '23514';
  end if;
  return new;
end;
$fn$;

do $trg$
declare t text;
begin
  foreach t in array array['scenario', 'winning', 'bucket', 'cashflow']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
                   t || '_updated_at', t);
  end loop;
  foreach t in array array['winning', 'bucket', 'cashflow']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_row_limit', t);
    execute format('create trigger %I before insert on public.%I for each row execute function public.check_row_limit()',
                   t || '_row_limit', t);
  end loop;
end;
$trg$;

-- ----------------------------------------------------------------------------
-- 3. RLS — 본인 행만
--
--  외래키 검사는 RLS 를 거치지 않는다. 그래서 참조를 (owner_id, scenario_id) 로 묶어
--  「자기 owner_id 로 쓴 행은 자기 시나리오만 가리킬 수 있게」 했다.
-- ----------------------------------------------------------------------------

alter table public.scenario enable row level security;
alter table public.winning  enable row level security;
alter table public.bucket   enable row level security;
alter table public.cashflow enable row level security;

do $rls$
declare t text;
begin
  foreach t in array array['scenario', 'winning', 'bucket', 'cashflow']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (owner_id = auth.uid())',
                   t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (owner_id = auth.uid())',
                   t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())',
                   t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (owner_id = auth.uid())',
                   t || '_delete', t);
  end loop;
end;
$rls$;

-- ----------------------------------------------------------------------------
-- 4. 표 권한 — Supabase 는 새 표마다 anon 에도 전 권한을 자동으로 붙인다.
--    정책이 anon 을 막지만, 권한 자체도 끊어 두 겹으로 막는다.
-- ----------------------------------------------------------------------------

revoke all on public.scenario, public.winning, public.bucket, public.cashflow from anon;
grant select, insert, update, delete on public.scenario, public.winning, public.bucket, public.cashflow to authenticated;

-- ----------------------------------------------------------------------------
-- 5. 함수 실행 권한
--
--  GRANT 만으로는 제한되지 않는다. 권한이 두 겹으로 미리 붙는다.
--    ① PostgreSQL 이 함수 생성 시 PUBLIC 에 EXECUTE 기본 부여
--    ② Supabase 가 ALTER DEFAULT PRIVILEGES 로 신규 함수마다 anon 에 자동 부여
--  PUBLIC 만 지우면 anon=X 가 남아 비로그인 호출이 그대로 뚫린다.
--  트리거 전용 함수는 authenticated 를 남긴다(직접 호출하면 "can only be called as trigger" 로 죽어 무해).
-- ----------------------------------------------------------------------------

revoke all on function public.set_updated_at()  from public, anon;
revoke all on function public.check_row_limit() from public, anon;
grant execute on function public.set_updated_at()  to authenticated;
grant execute on function public.check_row_limit() to authenticated;

-- ============================================================================
-- 끝.
-- ============================================================================
