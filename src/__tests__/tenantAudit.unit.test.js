/**
 * Unit tests for scripts/audit-tenant-rls.mjs, the static audit that every
 * RLS policy on a tenant table, and every SECURITY DEFINER function that
 * touches one, filters by tenant.
 *
 * Needs no database. The fixtures are SQL strings; the last block runs the
 * audit over the real supabase/migrations directory, which is the CI gate.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { splitStatements, finalState, audit, auditRepo } from '../../scripts/audit-tenant-rls.mjs'

const files = (...sqls) => sqls.map((sql, i) => ({ name: `2026110200000${i}_f.sql`, sql }))
const run = (...sqls) => audit(finalState(files(...sqls)))

const TENANT_TABLE = `alter table public.widgets add column if not exists tenant text not null default 'a';`

describe('splitStatements', () => {
  it('keeps a $$ body containing semicolons as one statement', () => {
    const sql = `create function f() returns void language plpgsql as $$ begin perform 1; perform 2; end $$; select 1;`
    const out = splitStatements(sql)
    expect(out).toHaveLength(2)
    expect(out[0]).toContain('perform 2;')
  })

  it('respects $tag$ bodies, quotes, escaped quotes and quoted identifiers', () => {
    const sql = [
      `select $q$ a ; b $q$;`,
      `select 'it''s ; fine';`,
      `select "we;ird" from t;`,
      `select E'back\\'slash ; still string';`,
    ].join('\n')
    expect(splitStatements(sql)).toHaveLength(4)
  })

  it('ignores semicolons and quotes inside comments', () => {
    const sql = `-- it's a comment; really\nselect 1; /* a ; ' b */ select 2;`
    const out = splitStatements(sql)
    expect(out).toHaveLength(2)
    expect(out.join(' ')).not.toContain('comment')
  })

  it('does not treat $1 as a dollar quote', () => {
    expect(splitStatements(`select $1; select $2;`)).toHaveLength(2)
  })
})

describe('finalState', () => {
  it('drop policy removes the policy from the final state', () => {
    const state = finalState(files(
      `create policy x on t for select using (true);`,
      `drop policy if exists x on t;`,
    ))
    expect([...state.policies.keys()]).toEqual([])
  })

  it('captures a policy on dotted storage.objects with a quoted name', () => {
    const state = finalState(files(
      `create policy "payment_proofs_owner_select" on storage.objects for select to authenticated
         using (bucket_id = 'payment-proofs');`,
    ))
    const p = state.policies.get('storage.objects::payment_proofs_owner_select')
    expect(p).toBeTruthy()
    expect(p.cmd).toBe('select')
    expect(p.using).toContain('payment-proofs')
  })

  it('treats public. and quotes on a table name as the same table', () => {
    const state = finalState(files(
      `create policy p on "public"."orders" for select using (true);`,
      `drop policy p on public.orders;`,
    ))
    expect(state.policies.size).toBe(0)
  })

  it('keys functions by argument types so overloads do not collide', () => {
    const state = finalState(files(
      `create or replace function public.f(a text) returns int language sql as $$ select 1 $$;`,
      `create or replace function public.f(a text, b integer default 1) returns int language sql as $$ select 2 $$;`,
      `drop function if exists f(text);`,
    ))
    expect([...state.functions.keys()]).toEqual(['f(text,integer)'])
  })

  it('normalises type aliases and multi-word types between create and drop', () => {
    const state = finalState(files(
      `create function g(p_lat double precision, p_n int) returns void language sql as $$ select 1 $$;`,
      `drop function g(double precision, integer);`,
    ))
    expect(state.functions.size).toBe(0)
  })

  it('records security definer from the header, not the body', () => {
    const state = finalState(files(
      `create function a() returns int language sql security definer set search_path = public as $$ select 1 $$;`,
      `create function b() returns text language sql as $$ select 'security definer' $$;`,
    ))
    expect(state.functions.get('a()').securityDefiner).toBe(true)
    expect(state.functions.get('b()').securityDefiner).toBe(false)
  })

  it('create or replace in a later file replaces the earlier definition', () => {
    const state = finalState(files(
      `create function a() returns int language sql security definer as $$ select 1 $$;`,
      `create or replace function a() returns int language sql as $$ select 1 $$;`,
    ))
    expect(state.functions.get('a()').securityDefiner).toBe(false)
  })

  it('applies files in filename order regardless of the order given', () => {
    const state = finalState([
      { name: '20261102000002_b.sql', sql: `drop policy x on t;` },
      { name: '20261102000001_a.sql', sql: `create policy x on t for select using (true);` },
    ])
    expect(state.policies.size).toBe(0)
  })

  it('reads tenant tables from add column and from the dynamic DO-block list', () => {
    const state = finalState(files(
      `alter table public.widgets add column if not exists tenant text;`,
      `do $$ declare t text; begin
         foreach t in array array['gadgets', 'gizmos'] loop
           execute format('alter table public.%I add column if not exists tenant text', t);
         end loop; end $$;`,
      `alter table public.other add column note text;`,
    ))
    expect([...state.tenantTables].sort()).toEqual(['gadgets', 'gizmos', 'widgets'])
  })

  it('reports a DO block that adds a tenant column but lists no tables', () => {
    const state = finalState(files(
      `do $$ begin execute 'alter table x add column tenant text'; end $$;`,
    ))
    const { problems } = audit(state)
    expect(problems.map(p => p.kind)).toContain('unsupported')
  })

  it('refuses statement forms it does not model instead of ignoring them', () => {
    const { problems } = run(`alter function f() security invoker;`, `alter policy p on t using (true);`)
    expect(problems.filter(p => p.kind === 'unsupported')).toHaveLength(2)
  })
})

describe('audit: policies', () => {
  it('reports a tenant-table policy without the predicate; adding it clears the report', () => {
    const bad = run(TENANT_TABLE, `create policy w_sel on widgets for select using (true);`)
    expect(bad.problems).toHaveLength(1)
    expect(bad.problems[0]).toMatchObject({ kind: 'policy', name: 'widgets.w_sel' })
    expect(bad.problems[0].file).toMatch(/\.sql$/)
    expect(bad.problems[0].line).toBe(1)

    const good = run(
      TENANT_TABLE,
      `create policy w_sel on widgets for select using (true);`,
      `drop policy w_sel on widgets;
       create policy w_sel on widgets for select using (tenant = (select public.current_tenant()));`,
    )
    expect(good.problems).toEqual([])
  })

  it('an INSERT policy does not swallow the policy after it', () => {
    // audit-embed-rls.mjs lets an INSERT policy (no USING) run on into the next
    // statement's USING; here the second policy is the broken one.
    const { problems } = run(
      TENANT_TABLE,
      `create policy w_ins on widgets for insert with check (tenant = (select public.current_tenant()));
       create policy w_sel on widgets for select using (true);`,
    )
    expect(problems.map(p => p.name)).toEqual(['widgets.w_sel'])
  })

  it('does not credit a predicate that belongs to a neighbouring policy', () => {
    const { problems } = run(
      TENANT_TABLE,
      `create policy w_ins on widgets for insert with check (true);
       create policy w_sel on widgets for select using (tenant = (select public.current_tenant()));`,
    )
    expect(problems.map(p => p.name)).toEqual(['widgets.w_ins'])
  })

  it('requires the predicate in WITH CHECK for insert and for update', () => {
    const { problems } = run(
      TENANT_TABLE,
      `create policy w_upd on widgets for update using (tenant = (select public.current_tenant())) with check (true);`,
      `create policy w_ins on widgets for insert with check (is_admin());`,
    )
    expect(problems.map(p => p.name).sort()).toEqual(['widgets.w_ins', 'widgets.w_upd'])
  })

  it('accepts UPDATE/ALL with only USING (Postgres reuses it as the check)', () => {
    const { problems } = run(
      TENANT_TABLE,
      `create policy w_all on widgets for all using (is_admin() and tenant = (select public.current_tenant()));`,
    )
    expect(problems).toEqual([])
  })

  it('treats a policy with no FOR clause as ALL', () => {
    const { problems } = run(TENANT_TABLE, `create policy w_all on widgets using (true) with check (true);`)
    expect(problems).toHaveLength(2)
    expect(problems.map(p => p.detail).join(' ')).toContain('for all')
  })

  it('ignores policies on tables that have no tenant column', () => {
    expect(run(`create policy t_sel on tenants for select using (true);`).problems).toEqual([])
  })

  it('audits storage.objects policies for payment-proofs only', () => {
    const bad = run(`create policy pp on storage.objects for select using (bucket_id = 'payment-proofs');`)
    expect(bad.problems.map(p => p.name)).toEqual(['storage.objects.pp'])
    const other = run(`create policy pi on storage.objects for select using (bucket_id = 'product-images');`)
    expect(other.problems).toEqual([])
  })

  it('is not fooled by current_tenant() in a comment or a string', () => {
    const { problems } = run(
      TENANT_TABLE,
      `create policy w_sel on widgets for select
         -- using (tenant = current_tenant())
         using (note = 'current_tenant()');`,
    )
    expect(problems).toHaveLength(1)
  })
})

describe('audit: SECURITY DEFINER functions', () => {
  const sd = (name, body, args = '') =>
    `create or replace function public.${name}(${args}) returns void language plpgsql security definer set search_path = public as $$ ${body} $$;`

  it('reports a definer function that reads a tenant table without a tenant filter', () => {
    const { problems } = run(TENANT_TABLE, sd('leak', `begin perform 1 from public.widgets; end;`))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ kind: 'function', name: 'leak()' })
  })

  it('passes with current_tenant() or v_tenant', () => {
    expect(run(TENANT_TABLE, sd('a', `begin perform 1 from widgets where tenant = public.current_tenant(); end;`)).problems).toEqual([])
    expect(run(TENANT_TABLE, sd('b', `declare v_tenant text := 'x'; begin perform 1 from widgets where tenant = v_tenant; end;`)).problems).toEqual([])
  })

  it('does not match a table name inside a longer identifier, a string or a comment', () => {
    const body = `begin
      -- reads widgets later
      perform widget_id, my_widgets, widgets_total from other_table;
      raise exception 'no widgets here';
    end;`
    expect(run(TENANT_TABLE, sd('quiet', body)).problems).toEqual([])
  })

  it('detects security definer written after the body', () => {
    const trailing = (body, attr = 'security definer') =>
      `create or replace function public.t() returns void as $$ ${body} $$ language plpgsql ${attr};`
    const bad = run(TENANT_TABLE, trailing(`begin perform 1 from widgets; end;`))
    expect(bad.problems.map(p => p.name)).toEqual(['t()'])
    const good = run(TENANT_TABLE, trailing(`declare v_tenant text := public.current_tenant(); begin perform 1 from widgets where tenant = v_tenant; end;`))
    expect(good.problems).toEqual([])
  })

  it('does not treat a trailing security invoker as definer; the last attribute wins', () => {
    const fn = (attrs) =>
      `create function public.t() returns void as $$ begin perform 1 from widgets; end; $$ language plpgsql ${attrs};`
    expect(run(TENANT_TABLE, fn('security invoker')).problems).toEqual([])
    expect(run(TENANT_TABLE, fn('security definer security invoker')).problems).toEqual([])
    expect(run(TENANT_TABLE, fn('security invoker security definer')).problems).toHaveLength(1)
  })

  it('ignores security definer inside a trailing comment or string', () => {
    const fn = `create function public.t() returns void as $$ begin perform 1 from widgets; end; $$ language plpgsql set x.y = 'security definer'; -- security definer`
    expect(run(TENANT_TABLE, fn).problems).toEqual([])
  })

  it('ignores invoker functions', () => {
    const fn = `create function inv() returns void language sql as $$ select 1 from widgets $$;`
    expect(run(TENANT_TABLE, fn).problems).toEqual([])
  })

  it('does not credit a tenant filter that exists only in a replaced definition', () => {
    const { problems } = run(
      TENANT_TABLE,
      sd('f', `begin perform 1 from widgets where tenant = public.current_tenant(); end;`),
      sd('f', `begin perform 1 from widgets; end;`),
    )
    expect(problems.map(p => p.name)).toEqual(['f()'])
  })

  it('allow-lists is_admin, is_driver and the capability probes', () => {
    const lax = (n) => sd(n, `begin perform 1 from widgets; end;`)
    const { problems } = run(
      TENANT_TABLE,
      lax('is_admin'), lax('is_driver'), lax('tenancy_applied'), lax('product_variants_applied'),
      lax('not_allowed'),
    )
    expect(problems.map(p => p.name)).toEqual(['not_allowed()'])
  })
})

describe('real repo', () => {
  it('finds the 19 tenant tables and reports zero problems', () => {
    const { tables, problems } = auditRepo()
    expect(problems).toEqual([])
    expect(tables).toHaveLength(19)
    expect(tables).toContain('orders')
    expect(tables).not.toContain('tenants')
  })

  it('CLI --json prints { tables, problems } and exits 0', () => {
    const out = execFileSync('node', [join(process.cwd(), 'scripts', 'audit-tenant-rls.mjs'), '--json'], {
      encoding: 'utf8',
    })
    const parsed = JSON.parse(out)
    expect(parsed.problems).toEqual([])
    expect(parsed.tables.length).toBe(19)
  })
})
