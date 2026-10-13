"""가격표 동시 갱신, 검증 일정 보호, 부분 수집 보존 회귀 검사."""
from copy import deepcopy
import ast
import inspect
from types import SimpleNamespace

import refresh_soldout
from refresh_soldout import _refresh_via_scraper


class Query:
    def __init__(self, db):
        self.db = db
        self.filters = {}
        self.patch = None

    def select(self, fields):
        self.fields = fields.split(',')
        return self

    def eq(self, field, value):
        self.filters[field] = value
        return self

    def update(self, patch, **kwargs):
        self.patch = patch
        return self

    def execute(self):
        rows = [r for r in self.db.rows
                if all(r.get(k) == v for k, v in self.filters.items())]
        if self.patch is not None:
            assert self.filters.get('verified') is False
            for row in rows:
                self.db.writes.append((row['id'], deepcopy(self.patch)))
                row.update(self.patch)
            return SimpleNamespace(data=[])
        assert self.filters.get('verified') is False
        return SimpleNamespace(data=[{k: r.get(k) for k in self.fields} for r in rows])


class DB:
    def __init__(self, rows):
        self.rows = rows
        self.writes = []

    def table(self, name):
        assert name == 'events'
        return Query(self)


def row(i, **values):
    return dict(id=str(i), company_id='company', is_active=True, verified=False,
                source_url=f'https://example.com/{i}', seats_left_male=None,
                seats_left_female=None, is_closed=False, price_male=59000,
                price_female=59000, price_detail=None, **values)


def scraper(events):
    return lambda: SimpleNamespace(scrape=lambda: [SimpleNamespace(**e) for e in events])


def test_price_and_tiers_updated_together_and_unchanged_skipped():
    db = DB([row(1)])
    tiers = {'male': {'regular': 25000}, 'female': {'regular': 25000}}
    source = dict(source_url='https://example.com/1', price_male=25000,
                  price_female=25000, price_detail=tiers)
    assert _refresh_via_scraper(db, 'company', scraper([source])) == 1
    assert db.rows[0]['price_detail'] == tiers
    assert db.rows[0]['price_male'] == 25000
    assert _refresh_via_scraper(db, 'company', scraper([source])) == 0
    assert len(db.writes) == 1


def test_verified_rows_are_neither_updated_nor_closed():
    protected = row(1)
    protected['verified'] = True
    db = DB([protected, row(2)])
    before = deepcopy(protected)
    _refresh_via_scraper(db, 'company', scraper([
        dict(source_url='https://example.com/1', price_male=1, is_closed=True),
        dict(source_url='https://example.com/2')]))
    assert protected == before
    assert db.writes == []


def test_partial_scrape_preserves_unmatched_events_and_missing_tiers():
    db = DB([row(i) for i in range(4)])
    db.rows[0]['price_detail'] = {'male': {'regular': 59000}}
    _refresh_via_scraper(db, 'company', scraper([
        dict(source_url='https://example.com/0', price_detail=None)]))
    assert not db.writes
    assert all(not r['is_closed'] for r in db.rows)
    assert db.rows[0]['price_detail'] == {'male': {'regular': 59000}}


def test_confirmed_missing_closure_is_not_rewritten():
    db = DB([row(i) for i in range(3)])
    source = [dict(source_url=f'https://example.com/{i}') for i in range(2)]
    _refresh_via_scraper(db, 'company', scraper(source))
    assert db.writes == [('2', {'is_closed': True})]
    _refresh_via_scraper(db, 'company', scraper(source))
    assert len(db.writes) == 1


def test_all_event_query_chains_have_verified_guard():
    # 별도 q 변수에 담는 조회도 검사한다. 모든 가격·마감 경로에서 보호 조건 유지.
    tree = ast.parse(inspect.getsource(refresh_soldout))
    writes = []
    reads = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == 'execute':
            chain = ast.unparse(node)
            if "table('events')" in chain:
                assert "eq('verified', False)" in chain
                if '.update(' in chain:
                    writes.append(chain)
        if isinstance(node, ast.Assign):
            chain = ast.unparse(node.value)
            if "table('events')" in chain and '.select(' in chain:
                reads.append(chain)
                assert "eq('verified', False)" in chain
    assert len(writes) == 7
    assert len(reads) == 4
