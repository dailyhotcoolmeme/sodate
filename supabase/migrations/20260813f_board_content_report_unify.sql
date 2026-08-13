-- 게시글 첨부 콘텐츠(사진 + 유튜브 링크, 앞으로 늘어날 첨부 종류 전부) 신고를
-- "이미지 신고" 하나로 뭉뚱그려져 있던 걸 "콘텐츠 신고"로 일반화한다(2026-08-13
-- 오너 지시). 유튜브 링크를 추가하면서 신고 대상이 없다는 걸 알게 됐는데, 이미지
-- 전용으로 따로 만드는 대신 "글에 붙은 첨부물 전체"를 한 종류로 묶어 신고하면
-- 이미지든 링크든 나중에 또 다른 첨부 종류가 생기든 스키마를 안 늘려도 된다.
-- 신고되면 이미지·링크가 한꺼번에 가려진다(글 본문·제목은 그대로 노출 — 기존
-- 이미지 신고와 동일한 "글은 살리고 첨부만 가림" 원칙 유지).

-- 컬럼 이름 변경(RENAME은 기존 값·GRANT 권한을 그대로 유지한다 — 데이터 손실 없음)
alter table public.board_posts rename column image_report_count to content_report_count;
alter table public.board_posts rename column image_hidden to content_hidden;
alter table public.board_settings rename column hide_image_reports to hide_content_reports;

comment on column public.board_posts.content_hidden is
  '신고 누적으로 첨부 콘텐츠(사진+유튜브 링크 등)를 한꺼번에 가린 상태. 글은 그대로
   보이고 첨부 자리에 검수 중 오버레이(예전엔 이미지 전용이었다가 2026-08-13 일반화).';

-- board_reports.target_type: 'image' → 'content' (기존 신고 이력도 같이 옮긴다)
alter table public.board_reports drop constraint if exists board_reports_target_type_check;
update public.board_reports set target_type = 'content' where target_type = 'image';
alter table public.board_reports add constraint board_reports_target_type_check
  check (target_type in ('post', 'comment', 'content'));

-- 자동 가림 트리거: 'image' 분기를 'content' 로
create or replace function public.fn_board_report_autohide()
returns trigger language plpgsql security definer as $$
declare cnt int; s public.board_settings%rowtype;
begin
  select * into s from public.board_settings where id;
  select count(*) into cnt from public.board_reports
   where target_type = new.target_type and target_id = new.target_id;

  if new.target_type = 'post' then
    update public.board_posts
       set report_count = cnt,
           is_active = case when cnt >= s.hide_post_reports then false else is_active end
     where id = new.target_id;

  elsif new.target_type = 'content' then
    update public.board_posts
       set content_report_count = cnt,
           content_hidden = case when cnt >= s.hide_content_reports then true else content_hidden end
     where id = new.target_id;

  elsif new.target_type = 'comment' then
    update public.board_comments
       set report_count = cnt,
           is_active = case when cnt >= s.hide_comment_reports then false else is_active end
     where id = new.target_id;
  end if;
  return new;
end $$;
