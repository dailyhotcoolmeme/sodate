"""로꼬의 공통 저장 경로 재검증. 미확인·verified 기존 행 불변을 즉시 대조한다."""
from dotenv import load_dotenv
load_dotenv()

from scrapers.lovecommunity import LovecommunityLoco


def main():
    scraper = LovecommunityLoco()
    save = scraper.save_events

    def guarded_save(events):
        company_id = scraper.get_company_id()
        before = scraper._select_all('*', company_id=company_id)
        confirmed = {event.source_url for event in events}
        result = save(events)
        after = {row['id']: row for row in scraper._select_all('*', company_id=company_id)}
        protected = [row for row in before if row.get('verified') or row['source_url'] not in confirmed]
        for row in protected:
            assert after.get(row['id']) == row, f"보존 대조 실패: {row['id']}"
        assert len(after) >= len(before), '기존 행이 삭제됨'
        print('LOCO_PRESERVATION', len(protected), 'unchanged; deleted=', result['deleted'])
        return result

    scraper.save_events = guarded_save
    result = scraper.run()
    print('LOCO_SAVE_RESULT', result)
    if result['status'] not in ('success', 'partial'):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
