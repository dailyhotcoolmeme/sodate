-- pgmq 확장 활성화 (Supabase 대시보드에서도 가능)
create extension if not exists pgmq;

-- 푸시 알림 Queue 생성
select pgmq.create('push_notifications');
