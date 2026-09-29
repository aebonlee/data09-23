# Supabase DB 스크립트

이 폴더에는 이 도구의 저장 데이터를 PostgreSQL(Supabase)로 옮길 때 쓰는 스키마가 들어 있습니다.
지금 도구는 기획서 8장대로 **계정 없이 브라우저 저장소(localStorage)** 만 씁니다.
DB 에 연결하는 코드는 기획서의 P1(계정과 기기 간 동기화) 단계에서 붙입니다.

## 왜 DB 가 필요한가

- **기기를 바꾸면 시나리오가 사라집니다.** 지금은 `data09-23.db` 한 칸이 이 브라우저에만 있습니다. 휴대폰에서 적은 버킷을 PC 에서 이어 보려면 계정과 DB 가 필요합니다(기획서 10장 P1).
- **시나리오·당첨·버킷·고정지출이 서로 묶여 있습니다.** 시나리오를 지우면 그 안의 행도 지워야 하고(8장 무결성), 한 시나리오의 당첨 행 100개·버킷 500개 한도, 수량 1~100, 금액 0~1조원 같은 규칙을 DB 가 한 번 더 지켜 줍니다.
- **같은 당첨을 두 번 넣지 않게** — 복권 별칭·회차·게임 위치가 같은 행(awardUnitKey)은 DB 에서도 한 번만 들어갑니다(2A, AC19·AC20).

개인 금액·제목·메모는 분석 로그로 보내지 않는다는 원칙(8장)은 DB 로 옮겨도 그대로입니다. 이 스키마는 본인 Supabase 프로젝트에만 저장합니다.

## 테이블

| 테이블 | 용도 | localStorage 대응 |
|---|---|---|
| `scenario` | 시나리오 — 시작 월, 현재 잔고, 안전금고, 월별 보기, 퇴사 월·생활비 | `scenarios[]` |
| `winning` | 당첨 건 (복권·등수·수량·1건당 금액·세전/세후·지급 방식·월) | `scenarios[].entries[]` |
| `bucket` | 버킷 (일시성 = 지출 월 / 반복성 = 시작·종료 월, 보류 여부) | `scenarios[].buckets[]` |
| `cashflow` | 고정지출·기타 수입 (퇴사하면 멈춤 여부) | `scenarios[].flows[]` |

월별 계산 결과(MonthlyResult)는 입력에서 다시 계산되는 파생 데이터라 저장하지 않습니다(8장).
필드 이름은 도구의 이름을 snake_case 로 옮겼습니다. `id` → `scenario_id`·`winning_id`·`bucket_id`·`cashflow_id`, `round` → `draw_round` 만 바꿨습니다.

### 권한

- 모든 표에 RLS(행 수준 보안)를 켰고, 모든 행은 만든 사람만 보고 고칠 수 있습니다(`owner_id = auth.uid()`, 자동으로 채워짐).
- 당첨·버킷·고정지출은 `(owner_id, scenario_id)` 로 시나리오를 가리킵니다. 남의 시나리오 id 를 알아내도 거기에 행을 붙일 수 없습니다.
- 로그인하지 않은 사용자(anon)는 어떤 표도 읽거나 쓸 수 없습니다(정책 + 표 권한 회수, 두 겹).
- 이 도구에는 기록성(이력·로그) 데이터가 없습니다.
- 앱에서 upsert 할 때는 `onConflict` 를 표의 UNIQUE 조합(`owner_id,scenario_id` · `owner_id,winning_id` …)으로 지정해야 합니다.

## 적용 방법

1. <https://supabase.com> 에 가입하고 이 도구 전용으로 새 프로젝트를 만듭니다(그래서 표 이름에 접두사가 없습니다).
2. 왼쪽 메뉴 **SQL Editor** 에 `supabase/schema.sql` 내용을 전부 붙여넣고 **Run** 을 누릅니다.

여러 번 실행해도 안전합니다. 이미 있는 표는 건너뛰고 정책·트리거는 지우고 다시 만듭니다.

## 확인 방법

1. **Table Editor** 에 위 4개 표가 있고, 표마다 RLS 가 켜져 있는지 봅니다.
2. **Authentication → Policies** 에서 표마다 SELECT·INSERT·UPDATE·DELETE 정책 4개(모두 16개)가 있는지 봅니다.
3. SQL Editor 에서 함수 권한에 `anon` 이 없는지 봅니다.

```sql
select proname, proacl from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public';
```

## 로컬 검증 방법

운영에서 처음 실행하지 않도록, 임시 로컬 PostgreSQL 에 실제로 적용해 검사하는 도구를 함께 두었습니다.

```sh
./scripts/sqltest/run.sh
```

PostgreSQL 16 이상이 필요합니다(macOS: `brew install postgresql@17`). 임시 DB 를 만들어 쓰고 끝나면 지웁니다.

- 스키마를 두 번 적용해도 오류가 없는가
- 사용자 A 의 시나리오·당첨·버킷·고정지출이 사용자 B 에게 보이지 않고, 고치거나 지울 수도 없는가
- 남의 시나리오에 행을 붙일 수 없는가 · 로그인하지 않은 사용자는 아무것도 못 하는가
- 수량·금액·월 형식·종료 월 역전·카테고리·같은 게임 중복·당첨 행 100개 한도를 막는가
- 시나리오를 지우면 종속 행이 함께 지워지는가 · 함수 실행 권한에 PUBLIC·anon 이 남지 않았는가

검사용 SQL(`scripts/sqltest/*.local.sql`)은 로컬 전용이며, Supabase 운영 DB 에서 실행하면 스스로 멈춥니다.
