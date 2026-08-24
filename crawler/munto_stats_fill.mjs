import fs from 'node:fs'
const env=fs.readFileSync('.env','utf8')
const URL=env.match(/SUPABASE_URL=(.*)/)[1].trim()
const KEY=env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim()
const H={apikey:KEY,Authorization:'Bearer '+KEY}
const MH={'User-Agent':'Mozilla/5.0','Referer':'https://www.munto.kr/','Origin':'https://www.munto.kr','Accept':'application/json'}
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const today=new Date(Date.now()-9*3600*1000).toISOString().slice(0,10) // KST 대략
const DRY=process.argv[2]==='dry'

// 대상: 오늘이후 소셜링, total_capacity 없음, munto
const q=`event_type=eq.socialing&event_date=gte.${today}&participant_stats->total_capacity=is.null&external_id=like.munto_*&select=id,external_id,title&order=event_date.asc`
let all=[]
for(let off=0;;off+=1000){
  const r=await fetch(`${URL}/rest/v1/events?${q}`,{headers:{...H,Range:`${off}-${off+999}`}})
  const b=await r.json(); if(!b.length)break; all=all.concat(b); if(b.length<1000)break
}
console.log(`대상 ${all.length}곳 ${DRY?'(드라이런)':''}`)
let ok=0, skip=0, closed=0
for(let i=0;i<all.length;i++){
  const e=all[i]; const mid=e.external_id.replace('munto_','')
  try{
    const r=await fetch(`https://api.munto.kr/api/web/v1/socialing/${mid}`,{headers:MH})
    if(r.status!==200){ skip++; await sleep(300); continue }
    const j=await r.json(); const d=j.data||j
    const mc=d.maleCurrentCount||0, fc=d.femaleCurrentCount||0, cap=d.maximumPerson||0
    const ps={}
    if(cap){ ps.total_capacity=Number(cap); ps.total_count=mc+fc }
    if(mc>0) ps.male_count=mc
    if(fc>0) ps.female_count=fc
    const isClosed=['CLOSED','CONFIRM','CANCEL'].includes(d.status)||!!d.stopRecruit
    if(isClosed) closed++
    if(!Object.keys(ps).length){ skip++; await sleep(300); continue }
    if(DRY){ if(i<8) console.log(`  ${e.title.slice(0,30)}: ${JSON.stringify(ps)} closed=${isClosed}`) }
    else await fetch(`${URL}/rest/v1/events?id=eq.${e.id}`,{method:'PATCH',headers:{...H,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({participant_stats:ps,is_closed:isClosed})})
    ok++
  }catch(err){ skip++ }
  await sleep(320)
  if(!DRY && (i+1)%50===0) console.log(`  ...${i+1}/${all.length} (채움 ${ok}, 마감 ${closed})`)
}
console.log(`완료: 채움 ${ok}, 건너뜀 ${skip}, 마감표시 ${closed}`)
