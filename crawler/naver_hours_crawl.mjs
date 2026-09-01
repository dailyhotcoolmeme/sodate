import fs from 'node:fs'
// ⚠️ 예전엔 .env 파일만 읽어서 GitHub Actions 에서 돌릴 수 없었다 — 그래서 이 스크립트는
//    어떤 워크플로우에도 등록되지 못했고, 혼술바 영업시간이 수동 실행 때만 갱신됐다
//    (2026-09-01 점검: 9일째 그대로). 환경변수를 먼저 보고 없을 때만 .env 로 떨어진다.
function readEnv(key){
  if (process.env[key]) return process.env[key].trim()
  try {
    const m = fs.readFileSync('.env','utf8').match(new RegExp(`^${key}=(.*)$`,'m'))
    if (m) return m[1].trim()
  } catch {}
  throw new Error(`${key} 가 없습니다(환경변수 또는 crawler/.env).`)
}
const URL=readEnv('SUPABASE_URL')
const KEY=readEnv('SUPABASE_SERVICE_ROLE_KEY')
const H={apikey:KEY,Authorization:'Bearer '+KEY}
const UA='Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'
const DAYS=['월','화','수','목','금','토','일']
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const DRY = process.argv[2]==='dry'
// refresh = 이미 채워진 영업시간도 다시 확인한다. 기본(빈칸만 채우기)으로는 한 번 채운
// 매장의 시간이 영영 안 바뀐다 — 영업시간·휴무는 수시로 바뀌는 값이고, 우리 약관에도
// "방문 전 확인하라"고 써둔 항목이라 주기적으로 다시 읽어야 한다(2026-09-01).
const REFRESH = process.argv.includes('refresh')
const LIMIT = DRY?10:1000

// (day,start,end) 추출 → {요일:"start~end"}
function parseHours(html){
  const re=/"day":"([^"]+)","businessHours":\{"__typename":"StartEndTime","start":"([^"]+)","end":"([^"]+)"\}/g
  const out={}; let m; const unknown=new Set()
  while((m=re.exec(html))){
    const [,day,start,end]=m; const val=`${start}~${end}`
    if(day==='매일'){ for(const d of DAYS) out[d]=val }
    else if(day==='평일'){ for(const d of ['월','화','수','목','금']) out[d]=val }
    else if(day==='주말'){ for(const d of ['토','일']) out[d]=val }
    else if(DAYS.includes(day)){ out[day]=val }
    else { unknown.add(day) } // "월~금" 같은 범위는 아래서
    // 범위 "월~토"/"월-금"
    const rng=day.match(/^([월화수목금토일])[~\-]([월화수목금토일])$/)
    if(rng){ let i=DAYS.indexOf(rng[1]), j=DAYS.indexOf(rng[2]); if(i>=0&&j>=0){ for(let k=i;;k=(k+1)%7){ out[DAYS[k]]=val; if(k===j)break } } unknown.delete(day) }
  }
  return {hours:Object.keys(out).length?out:null, unknown:[...unknown]}
}

// refresh 는 오래 안 본 매장부터(updated_at 오름차순) 돌아 한 바퀴가 고르게 돈다.
const filter = REFRESH ? '' : 'hours=is.null&'
const order = REFRESH ? '&order=updated_at.asc' : ''
const r=await fetch(`${URL}/rest/v1/places?${filter}service=eq.honsul&naver_place_id=not.is.null&select=id,name,naver_place_id${order}&limit=${LIMIT}`,{headers:H})
const places=await r.json()
if(!Array.isArray(places)) throw new Error(`목록 조회 실패: ${JSON.stringify(places).slice(0,200)}`)
console.log(`대상 ${places.length}곳 ${REFRESH?'(전체 재확인)':'(빈칸만)'}${DRY?' 드라이런':''}`)
let ok=0, empty=0; const unknowns=new Set()
for(let i=0;i<places.length;i++){
  const p=places[i]
  try{
    const resp=await fetch(`https://m.place.naver.com/restaurant/${p.naver_place_id}/home`,{headers:{'User-Agent':UA}})
    const html=await resp.text()
    const {hours,unknown}=parseHours(html)
    unknown.forEach(u=>unknowns.add(u))
    if(hours){
      ok++
      if(DRY) console.log(`  ✔ ${p.name}: ${JSON.stringify(hours)}`)
      else await fetch(`${URL}/rest/v1/places?id=eq.${p.id}`,{method:'PATCH',headers:{...H,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({hours})})
    } else { empty++; if(DRY) console.log(`  ✗ ${p.name}: 시간 못찾음`) }
  }catch(e){ empty++; console.log(`  ERR ${p.name}: ${e.message}`) }
  await sleep(650+Math.floor(Math.random()*300))
  if(!DRY && (i+1)%20===0) console.log(`  ...${i+1}/${places.length} (채움 ${ok})`)
}
console.log(`완료: 채움 ${ok}, 못찾음 ${empty}, unknown day값: ${[...unknowns].join(', ')||'없음'}`)
