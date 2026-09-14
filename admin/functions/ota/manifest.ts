// 앱 업데이트 — 「새 거 있어?」에 답해주는 곳. Expo(EAS Update) 대신 우리가 답한다.
//
// 왜: Expo 무료 한도(월 1000회 «내려받기»)가 프로젝트별이 아니라 «계정별»이고
//     이 계정에 프로젝트가 8개다. 자세한 배경은 docs/OTA_SELF_HOSTING.md
//
// 앱이 보내는 헤더(실측):
//   expo-platform: android | ios
//   expo-runtime-version: 1.1.0
//   expo-protocol-version: 1
//   Accept: multipart/mixed
//
// 돌려줘야 하는 것(실측 + expo-updates 소스 FileDownloader.kt 확인):
//   Content-Type: multipart/mixed; boundary=...
//   expo-protocol-version: 1
//   파트 name="manifest" (application/json) — 이것만 있으면 된다.
//   (extensions·certificate_chain·directive 는 선택. 서명을 안 쓰므로 안 보낸다)

interface Env {
  MEDIA: R2Bucket
}

const BOUNDARY = 'ExpoManifestBoundary-sodate'

function noUpdate(): Response {
  // 줄 업데이트가 없으면 204. 앱은 지금 깔린 것을 그대로 쓴다.
  return new Response(null, {
    status: 204,
    headers: { 'expo-protocol-version': '1', 'cache-control': 'no-store' },
  })
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('method not allowed', { status: 405 })
  }

  const platform = request.headers.get('expo-platform') ?? ''
  const runtime = request.headers.get('expo-runtime-version') ?? ''
  if (platform !== 'android' && platform !== 'ios') {
    return new Response('bad platform', { status: 400 })
  }
  // runtimeVersion 이 다르면 «네이티브가 다른 앱»이다. 그 앞으로는 절대 보내면 안 된다
  // (구버전 앱이 새 네이티브를 요구하는 번들을 받으면 켜자마자 죽는다).
  if (!/^[\w.\-]{1,40}$/.test(runtime)) {
    return new Response('bad runtime version', { status: 400 })
  }

  const obj = await env.MEDIA.get(`ota/manifest/${runtime}/${platform}.json`)
  if (!obj) return noUpdate()

  const manifest = await obj.text()

  const body =
    `--${BOUNDARY}\r\n` +
    `Content-Disposition: form-data; name="manifest"\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${manifest}\r\n` +
    `--${BOUNDARY}--\r\n`

  return new Response(request.method === 'HEAD' ? null : body, {
    headers: {
      'content-type': `multipart/mixed; boundary=${BOUNDARY}`,
      'expo-protocol-version': '1',
      // 앱이 매번 새로 물어봐야 한다 — 캐시되면 배포해도 안 내려간다.
      'cache-control': 'no-store',
    },
  })
}
