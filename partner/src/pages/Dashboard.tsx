import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { eventsApi, discountApi, type PartnerEvent } from '../lib/api'
import type { Me } from '../lib/auth'

export default function Dashboard({ me }: { me: Me }) {
  const [events, setEvents] = useState<PartnerEvent[] | null>(null)
  const [benefit, setBenefit] = useState<string | null>(null)

  useEffect(() => {
    eventsApi.list().then(setEvents).catch(() => setEvents([]))
    discountApi.get().then(setBenefit).catch(() => setBenefit(''))
  }, [])

  const activeCount = events?.filter((e) => e.is_active).length ?? null

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-bold text-gray-900 mb-1">{me.companyName}님, 안녕하세요</h1>
      <p className="text-sm text-gray-500 mb-8">모잇 제휴 센터입니다.</p>

      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <p className="text-xs text-gray-400 mb-1">등록한 일정</p>
          <p className="text-2xl font-bold text-gray-900">
            {activeCount === null ? '...' : `${activeCount}건`}
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <p className="text-xs text-gray-400 mb-1">제휴 등급</p>
          <p className="text-2xl font-bold text-gray-900">{me.tier === 'paid' ? '유료' : '무료'}</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-6">
        <p className="text-xs text-gray-400 mb-1">지금 노출 중인 할인</p>
        <p className="text-sm text-gray-800">
          {benefit === null ? '...' : benefit || '아직 설정한 할인이 없습니다'}
        </p>
      </div>

      <div className="flex gap-3">
        <Link
          to="/events"
          className="px-4 py-2.5 rounded-xl bg-pink-500 text-white text-sm font-semibold hover:bg-pink-600"
        >
          새 일정 등록하러 가기
        </Link>
        <Link
          to="/discount"
          className="px-4 py-2.5 rounded-xl bg-white border border-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50"
        >
          할인 관리
        </Link>
      </div>
    </div>
  )
}
