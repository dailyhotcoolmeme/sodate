-- 2026-09-10 보안. 앱에 들어있는 공개 키(anon)로 «관리자·서버 전용» 함수가
-- 그대로 호출됐다. 실제로 확인한 것:
--   · admin_device_stats  → 설치 547대·플랫폼별 분포가 그대로 응답됨
--   · admin_analytics     → 앱 실행 2,399회 등 이용 통계가 그대로 응답됨
--   · pgmq_send           → 푸시 대기열에 임의 메시지 주입 가능(전체 푸시 발송 위험)
--   · purge_expired_personal_data → 개인정보 정리(삭제)를 아무나 실행 가능
--
-- 원인: 포스트그레스는 함수 실행 권한이 기본으로 PUBLIC 에 열려 있다.
--       anon/authenticated 에서만 회수하면 PUBLIC 이 남아 그대로 뚫린다.
--
-- 아래 함수들은 앱이 쓰지 않는다(앱 소스 161개 파일 전수 대조).
-- 관리자 콘솔은 /api/sb 프록시가 service_role 로, Edge Function 도 service_role 로 부른다.
-- 그래서 PUBLIC 을 거두고 service_role 에만 명시적으로 준다.
do $$
declare r record; n int := 0;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.proname in (
         'admin_analytics', 'admin_analytics_range', 'admin_device_stats',
         'admin_menu_stats', 'admin_visitor_stats',
         'fn_board_cleanup_reports', 'fn_board_comment_count', 'fn_board_report_autohide',
         'fn_board_report_notify', 'fn_board_vote_count', 'fn_review_report_autohide',
         'increment_board_view', 'notify_new_event',
         'pgmq_delete', 'pgmq_read', 'pgmq_send',
         'purge_expired_personal_data'
       )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
    n := n + 1;
  end loop;
  raise notice '처리한 함수 %개', n;
end $$;

-- ⚠️ 앱이 «직접» 부르는 함수는 건드리지 않았다(막으면 앱이 깨진다):
--   set_favorite, set_place_favorite, get_my_favorite_ids, get_my_favorite_events,
--   get_my_place_favorite_ids, get_my_notifications, get_unread_notification_count,
--   mark_notifications_read, delete_notification, delete_all_notifications,
--   submit_place_review, update_place_review, delete_place_review, report_place_review
