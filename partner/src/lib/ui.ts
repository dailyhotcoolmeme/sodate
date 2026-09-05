// 화면마다 같은 클래스 문자열을 베껴 쓰다 보면 한 곳만 고쳐지고 나머지가 남는다.
// 자주 쓰는 것만 여기 모아 둔다.

export const PANEL = 'glass rounded-3xl'

export const INPUT =
  'w-full px-3.5 py-2.5 rounded-xl bg-surface-lowest border border-line text-ink placeholder:text-ink-faint text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent'

export const LABEL = 'block text-sm font-semibold text-ink mb-1.5'

export const HINT = 'text-xs text-ink-faint mt-1.5 leading-relaxed'

/** 분홍 버튼. 소개페이지 CTA와 같은 모양이다. */
export const BTN_PRIMARY =
  'inline-flex items-center justify-center px-5 py-3 rounded-2xl bg-primary text-on-primary text-sm font-bold hover:bg-primary-soft transition-colors disabled:opacity-50'

export const BTN_QUIET =
  'inline-flex items-center justify-center px-5 py-3 rounded-2xl bg-surface-high text-ink-muted text-sm font-semibold hover:bg-surface-highest transition-colors disabled:opacity-50'

export const BTN_DANGER =
  'inline-flex items-center justify-center px-3 py-1.5 rounded-lg text-xs font-semibold text-danger hover:bg-surface-high transition-colors'

export const H1 = 'text-2xl font-bold text-ink'
export const SUBTITLE = 'text-sm text-ink-muted leading-relaxed'
