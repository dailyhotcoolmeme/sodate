-- D-1 알림 중복 방지: 마감 알림 발송 날짜 기록
ALTER TABLE events ADD COLUMN IF NOT EXISTS deadline_notified_date date;

COMMENT ON COLUMN events.deadline_notified_date IS 'D-1 마감 임박 알림을 마지막으로 발송한 날짜 (중복 발송 방지)';
