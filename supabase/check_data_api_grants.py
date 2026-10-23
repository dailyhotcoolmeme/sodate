"""Offline migration guard: table creation must include grants and RLS.

No credentials, database writes, network calls or third-party dependencies.
Run: python3 supabase/check_data_api_grants.py [migration.sql ...]
"""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent
IDENT = r'(?:"[a-zA-Z_][\w]*"|[a-zA-Z_][\w]*)'
NAME = rf'{IDENT}(?:\s*\.\s*{IDENT})?'
CREATE = re.compile(rf'^create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?({NAME})(?=\s|\()', re.I)


def statements(sql):
    """Split SQL without reading comments/strings/function bodies as statements."""
    result, current = [], []
    i = 0
    while i < len(sql):
        if sql.startswith('--', i):
            end = sql.find('\n', i)
            i = len(sql) if end < 0 else end
            current.append(' ')
        elif sql.startswith('/*', i):
            depth = 1
            i += 2
            while i < len(sql) and depth:
                if sql.startswith('/*', i):
                    depth += 1
                    i += 2
                elif sql.startswith('*/', i):
                    depth -= 1
                    i += 2
                else:
                    i += 1
            current.append(' ')
        elif sql[i] in "'\"":
            quote, start = sql[i], i
            i += 1
            while i < len(sql):
                if sql[i] == quote:
                    i += 1
                    if i < len(sql) and sql[i] == quote:
                        i += 1
                        continue
                    break
                if sql[i] == '\\' and quote == "'":
                    i += 1
                i += 1
            current.append(sql[start:i])
        elif sql[i] == '$' and (m := re.match(r'\$(?:[a-zA-Z_]\w*)?\$', sql[i:])):
            tag = m.group()
            end = sql.find(tag, i + len(tag))
            if end < 0:
                raise ValueError('Unterminated dollar quote')
            current.append(sql[i:end + len(tag)])
            i = end + len(tag)
        elif sql[i] == ';':
            result.append(''.join(current).strip())
            current = []
            i += 1
        else:
            current.append(sql[i])
            i += 1
    if ''.join(current).strip():
        result.append(''.join(current).strip())
    return result


def name(value):
    parts = value.replace('"', '').replace(' ', '').lower().split('.')
    return '.'.join(parts) if len(parts) > 1 else 'public.' + parts[0]


def check(sql):
    sql_statements = statements(sql)
    tables = [name(m[1]) for s in sql_statements if (m := CREATE.match(s))]
    errors = []
    for table in tables:
        if not table.startswith('public.'):
            continue
        permissions = set()
        rls = False
        for s in sql_statements:
            grant = re.match(rf'^grant\s+(.+?)\s+on\s+(?:table\s+)?({NAME})\s+to\s+(.+)$', s, re.I | re.S)
            if grant and name(grant[2]) == table:
                roles = {r.strip().strip('"').lower() for r in grant[3].split(',')}
                # A column-only grant is not sufficient for the server role.
                if 'service_role' in roles and '(' not in grant[1]:
                    permissions.update(p.strip().lower() for p in grant[1].split(','))
                if roles & {'anon', 'authenticated', 'public'}:
                    privileges = grant[1].lower()
                    if re.search(r'\b(all|update|delete|truncate|references|trigger)\b', privileges):
                        errors.append(f'{table}: public write/broad grants require a separate security review')
                    if re.search(r'\binsert\b', privileges) and table != 'public.analytics_events':
                        errors.append(f'{table}: public INSERT is not an approved access path')
            enable = re.match(rf'^alter\s+table\s+(?:only\s+)?({NAME})\s+enable\s+row\s+level\s+security$', s, re.I)
            if enable and name(enable[1]) == table:
                rls = True
        missing = {'select', 'insert', 'update', 'delete'} - permissions
        if missing:
            errors.append(f'{table}: missing explicit service_role grants: {", ".join(sorted(missing))}')
        if not rls:
            errors.append(f'{table}: missing ENABLE ROW LEVEL SECURITY in the creation migration')
    return tables, errors


def main(paths=None):
    paths = [Path(p) for p in paths] if paths else sorted((ROOT / 'migrations').glob('*.sql'))
    errors, tables = [], []
    for path in paths:
        found, failures = check(path.read_text())
        tables.extend(found)
        errors.extend(f'{path.name}: {e}' for e in failures)
    for error in errors:
        print(error, file=sys.stderr)
    print(f'Data API grants: {len(tables)} table definitions, {len(errors)} errors')
    return bool(errors)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
