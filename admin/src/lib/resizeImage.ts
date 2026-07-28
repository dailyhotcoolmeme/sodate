// 업로드 전 브라우저에서 리사이즈·재인코딩.
//
// 왜: 예전엔 원본을 그대로 R2에 넣었다. 실측(2026-07-28) 15장 17.8MB, 최대 한 장이
// 3.28MB(1079×8689)였다. 앱 상세화면은 이걸 매번 통째로 내려받는다.
// 폭은 이미 1080이라 문제가 아니고, 고화질 JPEG 인코딩이 문제였다.
//
// 목표는 "앱에서 보기 충분한 정도" — 폭 1080은 그대로 두고 WebP로 다시 굽는다.
// 상세 이미지는 대부분 글자가 많은 세로 캡처라 WebP가 JPEG보다 크게 유리하다.

const MAX_WIDTH = 1080
// 캔버스 한 변 상한(브라우저마다 다르고 사파리가 가장 빡빡하다). 세로로 아주 긴
// 캡처가 들어와도 여기서 잘리지 않고 비율만 줄어들도록 방어한다.
const MAX_SIDE = 16000
const QUALITY = 0.82

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 읽을 수 없습니다')) }
    img.src = url
  })
}

function toBlob(canvas: HTMLCanvasElement, type: string, q: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, q))
}

/**
 * 폭 1080으로 맞추고 WebP로 재인코딩한다.
 * 어떤 이유로든 실패하거나 원본보다 커지면 원본 File을 그대로 돌려준다
 * (리사이즈 때문에 업로드가 막히는 일은 없어야 한다).
 */
export async function resizeForUpload(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  // GIF는 캔버스로 구우면 애니메이션이 첫 프레임만 남는다 — 건드리지 않는다.
  if (file.type === 'image/gif') return file

  try {
    const img = await loadImage(file)
    let { naturalWidth: w, naturalHeight: h } = img
    if (!w || !h) return file

    let scale = Math.min(1, MAX_WIDTH / w)
    if (h * scale > MAX_SIDE) scale = MAX_SIDE / h

    const tw = Math.max(1, Math.round(w * scale))
    const th = Math.max(1, Math.round(h * scale))

    const canvas = document.createElement('canvas')
    canvas.width = tw
    canvas.height = th
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, tw, th)

    // WebP를 못 굽는 브라우저면 toBlob이 조용히 PNG를 뱉으므로 타입으로 확인한다.
    let blob = await toBlob(canvas, 'image/webp', QUALITY)
    let ext = 'webp'
    if (!blob || blob.type !== 'image/webp') {
      blob = await toBlob(canvas, 'image/jpeg', QUALITY)
      ext = 'jpg'
    }
    if (!blob) return file
    if (blob.size >= file.size && scale === 1) return file // 줄지 않으면 원본 유지

    const base = file.name.replace(/\.[^.]+$/, '') || 'image'
    return new File([blob], `${base}.${ext}`, { type: blob.type })
  } catch {
    return file
  }
}
