/**
 * 커뮤니티(/board)에 **어떤 길로 들어왔는지**를 화면에 전달한다.
 *
 * 커뮤니티로 가는 길이 셋이다: 톱바 토글 / 좌우 스와이프 / 햄버거 메뉴의 '커뮤니티'.
 * 그런데 board/index.tsx 는 마운트될 뿐이라 자기가 어떻게 열렸는지 알 방법이 없다.
 * 토글이 **아닌** 길로 처음 들어온 사람에게만 "토글로도 올 수 있다"고 알려주려면
 * 그 정보가 필요하다(2026-08-20 오너 지시).
 *
 * router 쿼리(`/board?from=toggle`)를 쓰지 않은 이유: URL 에 남아 뒤로가기·공유에 섞이고,
 * 같은 화면을 여는 경로마다 파라미터를 챙겨야 해서 빠뜨리기 쉽다. SwipeSegment 가 이미
 * 화면 전환 방향을 모듈 스코프 변수(pendingEnterFrom)로 넘기고 있어 그 관례를 따른다.
 *
 * ⚠️ 'unknown' 은 "토글이 아니다"가 아니라 **"모른다"** 다. 앱을 껐다 켜서 커뮤니티로
 *    바로 복귀한 경우가 여기 해당한다. 이걸 '토글 아님'으로 처리하면 평소 토글만 쓰던
 *    사람에게도 말풍선이 뜬다 — 받는 쪽에서 반드시 따로 걸러야 한다.
 */
export type BoardEntry = 'toggle' | 'swipe' | 'menu' | 'unknown'

let pending: BoardEntry = 'unknown'

/** 커뮤니티로 넘기기 **직전에** 호출한다(router.replace 보다 먼저). */
export function setBoardEntry(v: BoardEntry): void {
  pending = v
}

/**
 * 진입 방식을 읽고 곧바로 비운다.
 * 한 번 들어올 때 한 번만 읽어야 한다 — 안 비우면 다음 진입 때 옛 값이 그대로 읽힌다.
 */
export function consumeBoardEntry(): BoardEntry {
  const v = pending
  pending = 'unknown'
  return v
}
