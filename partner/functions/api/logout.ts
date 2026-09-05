import { clearCookie, json } from '../_lib/session'

export const onRequestPost: PagesFunction = async () => {
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() })
}
