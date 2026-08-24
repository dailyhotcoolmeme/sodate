import fs from 'node:fs'
// GitHub Actions는 process.env로 시크릿을 준다 — 로컬 실행(.env 파일)도 그대로 되게 둘 다 지원.
let URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  const env = fs.readFileSync('.env', 'utf8')
  URL = env.match(/SUPABASE_URL=(.*)/)[1].trim()
  KEY = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim()
}
const H={apikey:KEY,Authorization:'Bearer '+KEY}
const UA='Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const DRY = process.argv[2]==='dry'
const LIMIT = DRY?10:1000

// naver_hours_crawl.mjs 와 완전히 같은 페이지(m.place.naver.com/restaurant/{id}/home)에서
// 방문자 평점·리뷰수만 뽑는다(2026-08-24 오너 지시 — 혼술바 피드/상세에 평점 노출).
// 필드는 실측 확인(2026-08-24): "visitorReviewsScore":4.93,"visitorReviewsTotal":22
function parseRating(html){
  const scoreM = html.match(/"visitorReviewsScore":([\d.]+)/)
  const countM = html.match(/"visitorReviewsTotal":(\d+)/)
  return {
    rating: scoreM ? parseFloat(scoreM[1]) : null,
    count: countM ? parseInt(countM[1], 10) : null,
  }
}

// 매번 전체를 다시 돈다(2026-08-24 오너 지시로 GitHub Actions 정기 실행 — 주기를 길게
// 두는 대신, 돌 때마다 기존 평점도 최신 리뷰수로 갱신한다). null만 채우고 싶으면
// naver_rating=is.null 필터를 붙이면 된다.
const r=await fetch(`${URL}/rest/v1/places?naver_place_id=not.is.null&select=id,name,naver_place_id&limit=${LIMIT}`,{headers:H})
const places=await r.json()
console.log(`대상 ${places.length}곳 ${DRY?'(드라이런)':''}`)
let ok=0, empty=0
for(let i=0;i<places.length;i++){
  const p=places[i]
  try{
    const resp=await fetch(`https://m.place.naver.com/restaurant/${p.naver_place_id}/home`,{headers:{'User-Agent':UA}})
    const html=await resp.text()
    const {rating,count}=parseRating(html)
    if(rating!=null){
      ok++
      if(DRY) console.log(`  ✔ ${p.name}: ${rating} (${count}건)`)
      else await fetch(`${URL}/rest/v1/places?id=eq.${p.id}`,{method:'PATCH',headers:{...H,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({naver_rating:rating,naver_review_count:count})})
    } else { empty++; if(DRY) console.log(`  ✗ ${p.name}: 평점 못찾음`) }
  }catch(e){ empty++; console.log(`  ERR ${p.name}: ${e.message}`) }
  await sleep(650+Math.floor(Math.random()*300))
  if(!DRY && (i+1)%20===0) console.log(`  ...${i+1}/${places.length} (채움 ${ok})`)
}
console.log(`완료: 채움 ${ok}, 못찾음 ${empty}`)
