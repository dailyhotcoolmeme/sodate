// 알림 설정/필터의 지역·태그 칩을 '군(群)'으로 묶기 위한 분류 규칙.
// 지역값은 크롤 데이터라 자유 문구(예: "강남 삼성", "수원 광교") → 키워드로 분류.

export interface RegionGroupDef {
  key: string // 표시 라벨 (강남권/경기/충청 …)
  parent?: string // 상위 묶음 (서울)
}

// 표시 순서(오너 지정): 서울(강남권/강북권/강서권) → 경기 → 인천 → 충청 → 호남 → 경북 → 경남 → 기타
export const REGION_GROUP_ORDER: RegionGroupDef[] = [
  { key: '강남권', parent: '서울' },
  { key: '강북권', parent: '서울' },
  { key: '강서권', parent: '서울' },
  { key: '경기' },
  { key: '인천' },
  { key: '충청' },
  { key: '호남' },
  { key: '경북' },
  { key: '경남' },
  { key: '기타' },
]

// ⚠️ 확장성: 지역값은 크롤 데이터라 계속 늘어난다. 아래 키워드를 넓게 잡아
// 새 지명도 같은 군으로 자동 분류되게 한다. 매칭 안 되면 '기타'로 안전 폴백.
const _GANGNAM = /강남|삼성|역삼|선릉|서초|양재|사당|송파|잠실|문정|가락|석촌|방이|강동|천호|압구정|신사|논현|청담|교대|방배|반포|대치|도곡|수서|개포|일원/
const _GANGBUK = /종로|을지로|광화문|시청|중구|충정로|성수|성동|동대문|성북|왕십리|건대|한남|용산|명동|충무로|혜화|대학로|광진|노원|도봉|강북|미아|수유|창동|상계|회기|이태원|약수|금호|보문/
const _GANGSEO = /홍대|신촌|합정|상수|마포|여의도|영등포|구로|가산|강서|마곡|목동|양천|금천|동작|관악|신림|봉천|당산|문래|대림|화곡|발산|노량진|상도|서대문|은평|연신내|불광|디지털단지/
const _INCHEON = /인천|남동구|주안|송도|부평|계양|연수|미추홀|청라|검단|서구.?인천/
const _GYEONGGI = /수원|광교|분당|판교|일산|고양|부천|안양|평촌|산본|범계|성남|화성|동탄|오산|평택|하남|미사|용인|기흥|수지|죽전|의정부|남양주|김포|파주|광명|시흥|군포|의왕|이천|여주|양평|안산|구리|과천|경기/
const _CHUNGCHEONG = /대전|세종|천안|청주|아산|충주|제천|당진|서산|논산|공주|둔산|유성|쌍용|불당|두정|충청|충남|충북/
// 경기 '광주시'는 위 _GYEONGGI(경기 literal 포함)가 먼저 잡으므로, 여기 '광주'는 광주광역시로 처리
const _HONAM = /광주|전주|익산|군산|목포|여수|순천|나주|상무|첨단|봉선|전남|전북|호남/
const _GYEONGBUK = /대구|포항|경주|구미|안동|경산|김천|동성로|수성|범어|상인|경북/
const _GYEONGNAM = /부산|창원|마산|진해|울산|김해|양산|전포|진주|서면|해운대|센텀|남포|광안|사상|동래|삼산|경남/

export function regionGroupKey(region: string): string {
  const s = region || ''
  if (_GANGNAM.test(s)) return '강남권'
  if (_GANGBUK.test(s)) return '강북권'
  if (_GANGSEO.test(s)) return '강서권'
  if (_INCHEON.test(s)) return '인천'
  if (_GYEONGGI.test(s)) return '경기'
  if (_CHUNGCHEONG.test(s)) return '충청'
  if (_HONAM.test(s)) return '호남'
  if (_GYEONGBUK.test(s)) return '경북'
  if (_GYEONGNAM.test(s)) return '경남'
  if (/서울/.test(s)) return '강북권' // 권 미분류 서울(서울/경기 등)
  return '기타'
}

// ── 태그 군: 취미 / 직업 / 유형 ──
export const TAG_GROUP_ORDER = ['취미', '직업', '유형', '기타'] as const

const TAG_GROUP_MAP: Record<string, string[]> = {
  취미: ['#와인', '#커피미팅', '#요리', '#전시·문화', '#보드게임', '#등산·아웃도어', '#사주·타로', '#식사모임'],
  직업: ['#직장인', '#전문직', '#공무원', '#교사', '#대기업'],
  유형: ['#20대', '#30대', '#40대', '#대화중심', '#1:1', '#2:2', '#프리미엄', '#결혼전제', '#소규모', '#가치관팅', '#사회자진행'],
}

export function tagGroupKey(tag: string): string {
  for (const g of ['취미', '직업', '유형']) {
    if (TAG_GROUP_MAP[g].includes(tag)) return g
  }
  return '기타'
}
