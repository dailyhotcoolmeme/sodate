# 매진(마감) 판단 규칙 — imweb 예약위젯 공통 (2026-07-10 확정)

대부분 업체(imweb 계열)는 **구매하기 전 옵션 선택(일시/지역/성별)** 단계에서 매진이 드러난다.
`load_option.cm` 캐스케이드로 재현해 성별별 매진·가격을 뽑는다.

## 핵심 규칙
1. **성별 옵션은 날짜별**로 나뉜다 → 날짜 선택 후 그 날짜의 성별 옵션을 본다.
2. **매진 옵션은 클릭 불가(changeCartSelectRequireOption onclick 없음)** → OC 정규식으로는 안 잡힘.
   반드시 **dropdown-item 의 display 텍스트**를 파싱해야 함. 매진은 텍스트에 **"(품절)"**.
3. **성별별로 티켓이 여러 개**(일반·얼리버드·오픈특가·동반 등). 라벨 예:
   - `삼성여성 36,000원` (일반, 판매중)
   - `삼성여성 얼리버드 33,000원 (품절)` (얼리버드만 매진)
4. **⚠️ 얼리버드(품절) ≠ 그 성별 전체 마감.** 그 성별의 **모든 티켓이 (품절)일 때만 마감**.
   - available = 품절 아닌 티켓. available 있으면 → 그 성별 **판매중**, `가격 = available 중 최저가`.
   - available 없음(전부 품절) → 그 성별 **마감**(seats=0), 표시가격 = 전체 티켓 최저가(“가격(마감)”).
5. 성별 옵션 자체가 아예 없으면(날짜 지남/미오픈) 그 성별 미제공.

## 적용 대상 (imweb, 문토 제외)
- 이미 위젯 방식: modparty, secretsalon.
- **위젯 방식으로 전환 필요**: emotional-orange(연인어때식 품절표시 확인됨), yeonin(연인어때, 품절표시 확인됨), lovecommunity(로꼬), 그리고 lovecasting·yeongyul·talkblossom는 imweb/방식 개별 확인 후.
- 각 업체 WRITES_PRICE/WRITES_SEATS=True 로 켜야 DB에 저장됨(안 그러면 base_scraper가 버림).
- 프립은 imweb 아님(자체 API GetSelectItems 잔여석) — 이미 성별 잔여석 있음, WRITES_SEATS 켜짐 여부만 점검.

## 구현 노트
- body: `prod_idx={idx}` (secretsalon식). modparty는 `type=prod&prod_idx`. 업체별 확인.
- 성별 판별: 라벨에 '남성'/'여성' 포함. 가격: `([\d,]+)원`. 매진: '(품절)' 또는 '품절' 포함.
- 검증: 반드시 실제 사이트 구매하기 화면과 대조 후 배포(rule #1).
