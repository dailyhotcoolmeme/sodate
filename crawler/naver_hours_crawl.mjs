import fs from 'node:fs'
const env=fs.readFileSync('.env','utf8')
const URL=env.match(/SUPABASE_URL=(.*)/)[1].trim()
const KEY=env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim()
const H={apikey:KEY,Authorization:'Bearer '+KEY}
const UA='Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'
const DAYS=['월','화','수','목','금','토','일']
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const DRY = process.argv[2]==='dry'
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

const r=await fetch(`${URL}/rest/v1/places?hours=is.null&naver_place_id=not.is.null&select=id,name,naver_place_id&limit=${LIMIT}`,{headers:H})
const places=await r.json()
console.log(`대상 ${places.length}곳 ${DRY?'(드라이런)':''}`)
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
