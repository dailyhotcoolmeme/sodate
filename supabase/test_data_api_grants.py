"""Offline guard regression tests; optional real Postgres test uses a disposable DB."""
import os
import re
import subprocess
import unittest
from urllib.parse import urlsplit

from check_data_api_grants import CREATE, NAME, ROOT, check, main, name, statements


class MigrationGrantsTests(unittest.TestCase):
    def test_repository(self):
        self.assertFalse(main())

    def test_missing_grants(self):
        self.assertTrue(check('create table public.example(id int);')[1])

    def test_comments_cannot_satisfy_grants(self):
        self.assertTrue(check('create table example(id int); -- grant select, insert, update, delete on example to service_role;')[1])

    def test_other_table_or_function_cannot_satisfy_grants(self):
        sql = '''create table example(id int);
        grant select, insert, update, delete on other_table to service_role;
        create function f() returns void language sql as $$
          grant select, insert, update, delete on example to service_role;
        $$;'''
        self.assertTrue(check(sql)[1])

    def test_service_and_rls_required_together(self):
        grant = 'grant select, insert, update, delete on example to service_role;'
        self.assertTrue(check('create table example(id int);' + grant)[1])
        self.assertFalse(check('create table example(id int);' + grant + 'alter table example enable row level security;')[1])

    def test_column_grant_is_not_server_table_grant(self):
        self.assertTrue(check('create table example(id int); grant select(id) on example to service_role; alter table example enable row level security;')[1])

    def test_public_write_rejected(self):
        self.assertTrue(check('create table example(id int); grant all on example to anon;')[1])

    def test_quoted_and_multiline(self):
        sql = '''CREATE TABLE IF NOT EXISTS "public"."example" (id int);
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."example" TO service_role;
        ALTER TABLE "public"."example" ENABLE ROW LEVEL SECURITY;'''
        tables, errors = check(sql)
        self.assertEqual(tables, ['public.example'])
        self.assertFalse(errors)

    def test_split_ignores_nested_comments_and_semicolons(self):
        self.assertEqual(len(statements("/* outer /* nested ; */ */ select ';'; select 2;")), 2)

    def test_admin_view_migration_is_narrow(self):
        sql = (ROOT / 'migrations/20261023022526_lock_down_company_admin_stats.sql').read_text()
        commands = statements(sql)
        self.assertEqual(len(commands), 4)
        self.assertTrue(commands[0].lower().startswith('alter view public.company_admin_stats set (security_invoker = true)'))
        self.assertTrue(commands[1].lower().startswith('revoke all on table public.company_admin_stats from public, anon, authenticated'))
        self.assertTrue(commands[2].lower().startswith('grant select on table public.company_admin_stats to service_role'))

    @unittest.skipUnless(os.environ.get('GRANTS_TEST_DB_URL'), 'requires disposable PostgreSQL database')
    def test_admin_view_access_in_postgres(self):
        url = os.environ['GRANTS_TEST_DB_URL']
        self.assertIn(urlsplit(url).hostname, {'localhost', '127.0.0.1', '::1'})
        sql = '''BEGIN;
        CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
        GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
        CREATE TABLE public.stats_fixture(id int);
        INSERT INTO public.stats_fixture VALUES (1), (2);
        ALTER TABLE public.stats_fixture ENABLE ROW LEVEL SECURITY;
        CREATE POLICY fixture_anon ON public.stats_fixture FOR SELECT TO anon USING(id=1);
        GRANT SELECT ON public.stats_fixture TO anon, authenticated, service_role;
        CREATE VIEW public.company_admin_stats AS SELECT * FROM public.stats_fixture;
        GRANT SELECT ON public.company_admin_stats TO anon, authenticated, service_role;
        '''
        sql += (ROOT / 'migrations/20261023022526_lock_down_company_admin_stats.sql').read_text()
        sql += '''
        SET LOCAL ROLE service_role;
        DO $$ BEGIN
          IF (SELECT count(*) FROM public.company_admin_stats) <> 2 THEN
            RAISE EXCEPTION 'Admin statistics changed'; END IF;
        END $$;
        RESET ROLE;
        DO $$ DECLARE role_name text; BEGIN
          IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.company_admin_stats'::regclass
            AND 'security_invoker=true'=ANY(reloptions)) THEN
            RAISE EXCEPTION 'Invoker option missing'; END IF;
          FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
            IF has_table_privilege(role_name, 'public.company_admin_stats','SELECT') THEN
              RAISE EXCEPTION 'Public grant remains'; END IF;
            EXECUTE format('SET LOCAL ROLE %I', role_name);
            BEGIN
              PERFORM * FROM public.company_admin_stats;
              RAISE EXCEPTION 'Public request unexpectedly succeeded';
            EXCEPTION WHEN insufficient_privilege THEN NULL;
            END;
            RESET ROLE;
          END LOOP;
        END $$;
        ROLLBACK;'''
        result = subprocess.run(['psql', url, '-X', '-v', 'ON_ERROR_STOP=1', '-q'], input=sql, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    @unittest.skipUnless(os.environ.get('GRANTS_TEST_DB_URL'), 'requires disposable PostgreSQL database')
    def test_postgres_without_default_grants(self):
        self.assertIn(urlsplit(os.environ['GRANTS_TEST_DB_URL']).hostname, {'localhost', '127.0.0.1', '::1'}, 'Only disposable local/CI PostgreSQL is allowed')
        # Only table declarations/access statements are replayed. No seed data,
        # production connection, schedules, triggers or migration business logic.
        files = sorted((ROOT / 'migrations').glob('*.sql'))
        creates, access = [], []
        for path in files:
            sql = path.read_text()
            created_here = {name(m[1]) for s in statements(sql) if (m := CREATE.match(s))}
            for s in statements(sql):
                if CREATE.match(s):
                    creates.append(s + ';')
                target = re.search(rf'\bon\s+(?:table\s+)?({NAME})\s+(?:to|from)\b', s, re.I)
                if s.lower().startswith(('grant ', 'revoke ')) and target and name(target[1]) in created_here:
                    if '(' not in s or path.name == '20260731_board.sql':
                        access.append(s + ';')
            if '-- Data API 2026-10-30:' in sql:
                block = sql.split('-- Data API 2026-10-30:')[1].split('\n', 1)[1]
                access.extend(s + ';' for s in statements(block) if s.lower().startswith('alter table'))
        setup = '''BEGIN;
        CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
        GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated, service_role;
        '''
        assertions = '''
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND NOT rowsecurity) THEN
            RAISE EXCEPTION 'RLS missing'; END IF;
          IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND
            (NOT has_table_privilege('service_role', format('%I.%I', schemaname, tablename), 'SELECT') OR
             NOT has_table_privilege('service_role', format('%I.%I', schemaname, tablename), 'INSERT') OR
             NOT has_table_privilege('service_role', format('%I.%I', schemaname, tablename), 'UPDATE') OR
             NOT has_table_privilege('service_role', format('%I.%I', schemaname, tablename), 'DELETE'))) THEN
            RAISE EXCEPTION 'Server grant missing'; END IF;
          IF has_table_privilege('anon','public.auto_board_posts','SELECT') OR
             has_table_privilege('authenticated','public.partner_accounts','SELECT') OR
             has_table_privilege('anon','public.board_scraps','SELECT') THEN
            RAISE EXCEPTION 'Internal table exposed'; END IF;
          IF NOT has_table_privilege('anon','public.events','SELECT') OR
             NOT has_column_privilege('anon','public.board_posts','title','SELECT') OR
             NOT has_table_privilege('anon','public.analytics_events','INSERT') THEN
            RAISE EXCEPTION 'App grant missing'; END IF;
        END $$;
        ROLLBACK;'''
        result = subprocess.run(['psql', os.environ['GRANTS_TEST_DB_URL'], '-X', '-v', 'ON_ERROR_STOP=1', '-q'], input=setup + '\n'.join(creates + access) + assertions, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
