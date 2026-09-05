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
  const isEmpty = activeCount === 0

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold text-gray-900 mb-1">{me.companyName}님, 안녕하세요</h1>
      <p className="text-sm text-gray-500 mb-8 leading-relaxed">
        여기서 등록하신 내용은 모잇 앱을 쓰는 이용자에게 그대로 보입니다.
      </p>

      {/* 아무것도 없을 때는 숫자보다 "지금 뭘 하면 되는지"를 먼저 보여준다. */}
      {isEmpty ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
          <p className="text-base font-semibold text-gray-900 mb-1.5">아직 올리신 일정이 없습니다</p>
          <p className="text-sm text-gray-500 leading-relaxed mb-5">
            모임 일정을 등록하시면 모잇 앱에 바로 올라갑니다. 사진과 제목만 있어도 시작할 수 있어요.
          </p>
          <Link
            to="/events"
            className="inline-block px-4 py-2.5 rounded-xl bg-pink-500 text-white text-sm font-semibold hover:bg-pink-600"
          >
            첫 일정 등록하기
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-6">
          <p className="text-xs text-gray-400 mb-1">지금 앱에 올라가 있는 일정</p>
          <p className="text-2xl font-bold text-gray-900">
            {activeCount === null ? '...' : `${activeCount}건`}
          </p>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-8">
        <p className="text-xs text-gray-400 mb-1">지금 앱에 보이는 할인 혜택</p>
        <p className="text-sm text-gray-800 leading-relaxed">
          {benefit === null ? '...' : benefit || '아직 등록하신 할인이 없습니다. 등록하시면 앱 상세 화면에 표시됩니다.'}
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          to="/events"
          className="px-4 py-2.5 rounded-xl bg-pink-500 text-white text-sm font-semibold hover:bg-pink-600"
        >
          일정 등록·수정하기
        </Link>
        <Link
          to="/discount"
          className="px-4 py-2.5 rounded-xl bg-white border border-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50"
        >
          할인 혜택 관리
        </Link>
      </div>
    </div>
  )
}
