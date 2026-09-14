#!/usr/bin/env node
/**
 * OTA 배포 — Expo(EAS Update) 대신 우리 R2 로 내보낸다.
 *
 * 왜: Expo 무료 한도(월 1000회 «내려받기»)는 프로젝트별이 아니라 «계정별»이다.
 *     이 계정에 프로젝트가 8개라 서로 잡아먹는다. R2 는 내려받기 요금이 0원이고
 *     Cloudflare 는 월 1000만 요청 포함이라 사실상 걸리지 않는다.
 *     자세한 배경: docs/OTA_SELF_HOSTING.md
 *
 * 하는 일
 *   1) npx expo export 로 번들·에셋을 만든다
 *   2) 각 파일을 R2 에 올린다 (키 = 파일 내용의 MD5 — 내용이 같으면 다시 안 올린다)
 *   3) 앱에 돌려줄 manifest 를 만들어 R2 에 올린다
 *
 * 쓰는 법:  node scripts/ota-publish.mjs "설명 문구"
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(APP_DIR, '.ota-export')
const PLATFORMS = ['android', 'ios']

// ── 설정 읽기 ────────────────────────────────────────────────────────────────
function loadEnv() {
  const f = path.join(APP_DIR, '../crawler/.env')
  const env = {}
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const i = line.indexOf('=')
    if (i < 0 || line.trim().startsWith('#')) continue
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  }
  return env
}

const env = loadEnv()
const R2 = {
  endpoint: env.R2_ENDPOINT,
  key: env.R2_ACCESS_KEY_ID,
  secret: env.R2_SECRET_ACCESS_KEY,
  bucket: env.R2_BUCKET,
}
for (const [k, v] of Object.entries(R2)) {
  if (!v) throw new Error(`R2 설정이 없다: ${k} (crawler/.env 확인)`)
}

const appJson = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'app.json'), 'utf8')).expo
const RUNTIME = appJson.runtimeVersion
if (typeof RUNTIME !== 'string') {
  throw new Error('app.json 의 runtimeVersion 이 고정 문자열이 아니다. 지문 방식은 쓰지 않는다.')
}
/** 앱이 파일을 받아갈 공개 주소. admin Pages 가 R2 를 그대로 내려준다. */
const PUBLIC_BASE = process.env.OTA_PUBLIC_BASE || 'https://sodate-admin.pages.dev'

// ── R2 업로드 (AWS SigV4 서명을 직접 만든다 — 의존성 추가 없이) ──────────────
function hmac(key, data) { return crypto.createHmac('sha256', key).update(data).digest() }
function sha256hex(data) { return crypto.createHash('sha256').update(data).digest('hex') }

async function r2Put(key, body, contentType) {
  const url = new URL(`${R2.endpoint.replace(/\/$/, '')}/${R2.bucket}/${key}`)
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const payloadHash = sha256hex(body)

  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${url.host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date'
  const canonicalRequest = [
    'PUT', url.pathname, '', canonicalHeaders, signedHeaders, payloadHash,
  ].join('\n')

  const scope = `${dateStamp}/auto/s3/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest),
  ].join('\n')

  let k = hmac(`AWS4${R2.secret}`, dateStamp)
  k = hmac(k, 'auto'); k = hmac(k, 's3'); k = hmac(k, 'aws4_request')
  const signature = crypto.createHmac('sha256', k).update(stringToSign).digest('hex')

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'content-type': contentType,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      authorization: `AWS4-HMAC-SHA256 Credential=${R2.key}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body,
  })
  if (!res.ok) throw new Error(`R2 업로드 실패 ${key}: ${res.status} ${(await res.text()).slice(0, 200)}`)
}

// ── 지문 계산 — 앱이 쓰는 것과 같은 형식이어야 한다 ─────────────────────────
/** 앱이 내용 검증에 쓰는 값: SHA-256 을 base64url 로, 패딩 없이. */
const assetHash = (buf) => crypto.createHash('sha256').update(buf).digest('base64url')
/** 파일을 구분하는 이름: 내용의 MD5(16진). 내용이 같으면 키도 같아 다시 안 올린다. */
const assetKey = (buf) => crypto.createHash('md5').update(buf).digest('hex')

const CONTENT_TYPES = {
  hbc: 'application/javascript', js: 'application/javascript',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', ttf: 'font/ttf', otf: 'font/otf',
  json: 'application/json', mp4: 'video/mp4', lottie: 'application/json',
}
const typeOf = (ext) => CONTENT_TYPES[String(ext).toLowerCase()] || 'application/octet-stream'

// ── 본체 ────────────────────────────────────────────────────────────────────
const message = process.argv[2] || '(설명 없음)'

console.log('1) 번들 만들기 (몇 분 걸린다)')
fs.rmSync(OUT_DIR, { recursive: true, force: true })
execSync(`npx expo export --platform all --output-dir "${OUT_DIR}"`, {
  cwd: APP_DIR, stdio: 'inherit',
})

const meta = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'metadata.json'), 'utf8'))
const updateId = crypto.randomUUID()
const createdAt = new Date().toISOString()
const uploaded = new Set()

for (const platform of PLATFORMS) {
  const fm = meta.fileMetadata?.[platform]
  if (!fm) { console.log(`   ${platform}: 내보낸 게 없다 — 건너뜀`); continue }

  console.log(`2) ${platform} 파일 올리기`)

  const put = async (relPath, ext) => {
    const buf = fs.readFileSync(path.join(OUT_DIR, relPath))
    const key = assetKey(buf)
    if (!uploaded.has(key)) {
      await r2Put(`ota/assets/${key}`, buf, typeOf(ext))
      uploaded.add(key)
    }
    return { hash: assetHash(buf), key, contentType: typeOf(ext), url: `${PUBLIC_BASE}/ota/assets/${key}` }
  }

  const launchAsset = { ...(await put(fm.bundle, 'hbc')) }
  const assets = []
  for (const a of fm.assets || []) {
    const one = await put(a.path, a.ext)
    assets.push({ ...one, fileExtension: `.${a.ext}` })
  }

  // 앱이 요구하는 manifest. 필수 항목은 expo-updates 소스에서 확인했다:
  // id, createdAt, runtimeVersion, launchAsset, assets (ExpoUpdatesUpdate.kt)
  const manifest = {
    id: updateId,
    createdAt,
    runtimeVersion: RUNTIME,
    launchAsset,
    assets,
    metadata: {},
    extra: { expoClient: appJson, message },
  }

  await r2Put(
    `ota/manifest/${RUNTIME}/${platform}.json`,
    Buffer.from(JSON.stringify(manifest)),
    'application/json',
  )
  console.log(`   ${platform}: 에셋 ${assets.length}개 + 번들 1개`)
}

console.log()
console.log(`배포 완료 — id ${updateId}`)
console.log(`  설명: ${message}`)
console.log(`  runtimeVersion: ${RUNTIME}`)
console.log(`  올린 파일: ${uploaded.size}개(내용이 같은 건 한 번만)`)
