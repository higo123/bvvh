-- Lịch trực Bảo Vệ Việt Hưng: lược đồ Supabase
-- Chạy toàn bộ tệp này một lần trong Supabase → SQL Editor → New query → Run.
-- Có thể chạy lại an toàn (không xóa dữ liệu). Mỗi lần repo có bản mới, hãy chạy lại tệp này.
--
-- Cách hoạt động: các bảng bị khóa hoàn toàn với khóa công khai (anon). Ứng dụng chỉ gọi
-- các hàm bên dưới. Mỗi hàm tự kiểm tra phiên đăng nhập và quyền trưởng ban/nhân viên.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- bảng
create table if not exists public.docs (
  col        text not null,
  id         text not null,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (col, id)
);
-- version: tăng 1 sau mỗi lần ghi, dùng để phát hiện hai người sửa cùng lúc.
alter table public.docs add column if not exists version int not null default 1;

create table if not exists public.accounts (
  staff_id     text primary key,
  code         text not null,
  pin_hash     text not null,
  is_head      boolean not null default false,
  failed       int not null default 0,
  locked_until timestamptz
);
-- Tài khoản đối chiếu (chỉ xem, ví dụ phòng nhân sự): is_viewer = true, không có hồ sơ nhân viên.
alter table public.accounts add column if not exists is_viewer boolean not null default false;
alter table public.accounts add column if not exists display_name text;
-- must_change: PIN do trưởng ban cấp hoặc đặt lại, người dùng phải tự đổi ở lần đăng nhập đầu.
alter table public.accounts add column if not exists must_change boolean not null default false;
create unique index if not exists accounts_code_lower on public.accounts (lower(code));

create table if not exists public.sessions (
  token      text primary key,
  staff_id   text not null references public.accounts (staff_id) on delete cascade,
  expires_at timestamptz not null
);
create index if not exists sessions_staff on public.sessions (staff_id);

-- Nhật ký thay đổi: ai làm gì, lúc nào.
create table if not exists public.audit_log (
  id       bigserial primary key,
  at       timestamptz not null default now(),
  staff_id text,
  actor    text,
  action   text not null,
  target   text,
  summary  text,
  detail   jsonb
);
create index if not exists audit_log_at on public.audit_log (at desc);

alter table public.docs      enable row level security;
alter table public.accounts  enable row level security;
alter table public.sessions  enable row level security;
alter table public.audit_log enable row level security;
revoke all on public.docs, public.accounts, public.sessions, public.audit_log from anon, authenticated;
revoke all on sequence public.audit_log_id_seq from anon, authenticated;

-- Hàm bản cũ có chữ ký khác, bỏ đi để không bị gọi nhầm.
drop function if exists public.api_put(text, text, text, jsonb);

-- ---------------------------------------------------------------- hàm nội bộ
create or replace function public._err(p_msg text)
returns jsonb language sql immutable
as $$ select jsonb_build_object('ok', false, 'error', p_msg) $$;

-- Phiên hợp lệ và không bị buộc đổi PIN.
create or replace function public._me(p_token text)
returns public.accounts
language sql stable security definer
set search_path = public, extensions
as $$
  select a.* from public.sessions s
  join public.accounts a on a.staff_id = s.staff_id
  where s.token = p_token and s.expires_at > now() and not a.must_change
$$;

-- Phiên hợp lệ, kể cả khi đang bị buộc đổi PIN.
create or replace function public._me_any(p_token text)
returns public.accounts
language sql stable security definer
set search_path = public, extensions
as $$
  select a.* from public.sessions s
  join public.accounts a on a.staff_id = s.staff_id
  where s.token = p_token and s.expires_at > now()
$$;

create or replace function public._actor(a public.accounts)
returns text
language sql stable security definer
set search_path = public
as $$
  select coalesce((select data ->> 'name' from public.docs where col = 'staff' and id = a.staff_id),
                  a.display_name, a.code)
$$;

create or replace function public._sname(p_id text)
returns text
language sql stable security definer
set search_path = public
as $$
  select coalesce((select data ->> 'name' from public.docs where col = 'staff' and id = p_id), p_id)
$$;

create or replace function public._log(a public.accounts, p_action text, p_target text,
                                       p_summary text, p_detail jsonb default null)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.audit_log (staff_id, actor, action, target, summary, detail)
  values (a.staff_id, public._actor(a), p_action, p_target, p_summary, p_detail);
  delete from public.audit_log where at < now() - interval '3 years';
end $$;

-- Tháng M khóa từ 00:00 ngày 10 của tháng M+1 (giờ Việt Nam).
create or replace function public._month_locked(p_mon text)
returns boolean
language sql stable
as $$
  select coalesce(p_mon ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    and (now() at time zone 'Asia/Ho_Chi_Minh')::date
        >= (to_date(p_mon || '-01', 'YYYY-MM-DD') + interval '1 month' + interval '9 days')::date, false)
$$;

-- PIN do người dùng tự chọn: ít nhất 6 ký tự, không quá dễ đoán.
create or replace function public._pin_error(p_pin text, p_code text)
returns text
language sql immutable
as $$
  select case
    when length(coalesce(p_pin, '')) < 6 then 'PIN cần ít nhất 6 ký tự.'
    when p_pin ~ '^(.)\1+$' then 'PIN không được gồm toàn một ký tự lặp lại.'
    when lower(p_pin) in ('123456', '1234567', '12345678', '123456789', '654321', '987654', '987654321',
                          '121212', '123123', '112233', '102030', '147258', '159753', '696969',
                          'abcdef', 'qwerty', 'password', 'matkhau') then 'PIN này quá dễ đoán, hãy chọn PIN khác.'
    when lower(p_pin) = lower(coalesce(p_code, '')) then 'PIN không được trùng mã số.'
    else null end
$$;

-- So sánh hai bản lịch tháng, trả về số ô thay đổi và vài ô đầu tiên.
create or replace function public._assign_diff(p_old jsonb, p_new jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare r jsonb := '[]'::jsonb; n int := 0; d text; s text; o text; nw text;
begin
  for d in
    select k from (select jsonb_object_keys(coalesce(p_old -> 'assign', '{}'::jsonb)) k
                   union
                   select jsonb_object_keys(coalesce(p_new -> 'assign', '{}'::jsonb)) k) x
    order by k
  loop
    for s in
      select k from (select jsonb_object_keys(coalesce(p_old -> 'assign' -> d, '{}'::jsonb)) k
                     union
                     select jsonb_object_keys(coalesce(p_new -> 'assign' -> d, '{}'::jsonb)) k) y
    loop
      o := p_old -> 'assign' -> d ->> s;
      nw := p_new -> 'assign' -> d ->> s;
      if o is distinct from nw then
        n := n + 1;
        if n <= 10 then
          r := r || to_jsonb(substr(d, 9, 2) || '/' || substr(d, 6, 2) || ' ' || public._sname(s)
                             || ': ' || coalesce(o, '–') || '→' || coalesce(nw, '–'));
        end if;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('n', n, 'items', r);
end $$;

create or replace function public._login_result(p_staff_id text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare t text;
begin
  delete from public.sessions where expires_at < now();
  t := encode(gen_random_bytes(24), 'hex');
  insert into public.sessions (token, staff_id, expires_at)
  values (t, p_staff_id, now() + interval '30 days');
  return jsonb_build_object('ok', true, 'token', t);
end $$;

-- ---------------------------------------------------------------- hàm cho ứng dụng
create or replace function public.needs_setup()
returns boolean
language sql stable security definer
set search_path = public
as $$ select not exists (select 1 from public.accounts) $$;

create or replace function public.setup_head(p_code text, p_name text, p_pin text, p_emergency text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare sid text; e text; a public.accounts;
begin
  lock table public.accounts in share row exclusive mode;
  if exists (select 1 from public.accounts) then
    return public._err('Đã thiết lập rồi, hãy đăng nhập.');
  end if;
  if coalesce(trim(p_code), '') = '' or coalesce(trim(p_name), '') = '' then
    return public._err('Nhập họ tên và mã số.');
  end if;
  e := public._pin_error(p_pin, trim(p_code));
  if e is not null then return public._err(e); end if;
  sid := 's' || substr(md5(random()::text || clock_timestamp()::text), 1, 10);
  insert into public.accounts (staff_id, code, pin_hash, is_head)
  values (sid, trim(p_code), crypt(p_pin, gen_salt('bf')), true) returning * into a;
  insert into public.docs (col, id, data) values ('staff', sid, jsonb_build_object(
    'code', trim(p_code), 'name', trim(p_name), 'role', 'head', 'phone', '',
    'emergency', trim(coalesce(p_emergency, '')), 'offDay', -1, 'active', true));
  perform public._log(a, 'Thiết lập', sid, 'Tạo tài khoản trưởng ban đầu tiên: ' || trim(p_name));
  return public._login_result(sid);
end $$;

create or replace function public.login(p_code text, p_pin text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare a public.accounts;
begin
  select * into a from public.accounts where lower(code) = lower(trim(coalesce(p_code, '')));
  if not found then
    return public._err('Sai mã số hoặc PIN.');
  end if;
  if a.locked_until is not null and a.locked_until > now() then
    return public._err('Nhập sai nhiều lần, tài khoản tạm khóa ít phút. Hãy thử lại sau.');
  end if;
  if a.pin_hash <> crypt(coalesce(p_pin, ''), a.pin_hash) then
    update public.accounts
       set failed = case when failed + 1 >= 5 then 0 else failed + 1 end,
           locked_until = case when failed + 1 >= 5 then now() + interval '10 minutes' else locked_until end
     where staff_id = a.staff_id;
    return public._err('Sai mã số hoặc PIN.');
  end if;
  update public.accounts set failed = 0, locked_until = null where staff_id = a.staff_id;
  return public._login_result(a.staff_id);
end $$;

create or replace function public.api_logout(p_token text)
returns jsonb
language sql security definer
set search_path = public
as $$
  with d as (delete from public.sessions where token = p_token returning 1)
  select jsonb_build_object('ok', true)
$$;

create or replace function public.api_get(p_token text)
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare m public.accounts; docs jsonb; lb timestamptz; today text;
begin
  m := public._me_any(p_token);
  if m.staff_id is null then return public._err('expired'); end if;
  today := to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD');
  if m.must_change then
    return jsonb_build_object('ok', true, 'docs', '{}'::jsonb, 'today', today,
      'me', jsonb_build_object('id', m.staff_id, 'is_head', m.is_head, 'is_viewer', m.is_viewer,
                               'name', coalesce(m.display_name, ''), 'must_change', true));
  end if;
  select coalesce(jsonb_object_agg(col, d), '{}'::jsonb) into docs
  from (
    select col, jsonb_object_agg(id, data || jsonb_build_object('_v', version)) d
    from public.docs
    where col in ('staff', 'leaves', 'months')
       or updated_at > now() - interval '150 days'
    group by col
  ) x;
  if m.is_head then
    select max(at) into lb from public.audit_log where action = 'Sao lưu';
  end if;
  return jsonb_build_object('ok', true, 'docs', docs, 'today', today,
    'last_backup', case when lb is null then null else to_char(lb at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') end,
    'me', jsonb_build_object('id', m.staff_id, 'is_head', m.is_head, 'is_viewer', m.is_viewer,
                             'name', coalesce(m.display_name, ''), 'must_change', false));
end $$;

create or replace function public.api_put(p_token text, p_col text, p_id text, p_data jsonb,
                                          p_ver int default null, p_reason text default null)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  m public.accounts; mon text; old jsonb; v int; ex boolean; swp jsonb; txt text;
  diff jsonb; items text; summ text; ms bigint; sa text; sb text; n1 text; n2 text;
begin
  m := public._me(p_token);
  if m.staff_id is null then return public._err('expired'); end if;
  if m.is_viewer then
    return public._err('Tài khoản đối chiếu chỉ được xem, không sửa được dữ liệu.');
  end if;
  if p_col not in ('leaves', 'months', 'notes', 'swaps', 'swapacks', 'approvals') then
    return public._err('Không hợp lệ.');
  end if;
  if p_id is null or p_id !~ '^[A-Za-z0-9_:.-]{1,80}$' then
    return public._err('Mã bản ghi không hợp lệ.');
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' or length(p_data::text) > 200000 then
    return public._err('Dữ liệu không hợp lệ.');
  end if;
  p_data := p_data - '_v';
  ms := (extract(epoch from clock_timestamp()) * 1000)::bigint;

  -- Khóa tháng cũ cho nhân viên thường.
  mon := case p_col
    when 'notes' then substr(p_id, 1, 7)
    when 'swaps' then substr(coalesce(p_data ->> 'date', ''), 1, 7)
    when 'swapacks' then (select substr(d.data ->> 'date', 1, 7) from public.docs d where d.col = 'swaps' and d.id = p_id)
    else null end;
  if not m.is_head and public._month_locked(mon) then
    return public._err('Tháng này đã khóa, chỉ trưởng ban sửa được.');
  end if;

  -- Khóa dòng và kiểm tra phiên bản để không ghi đè thay đổi của người khác.
  select d.data, d.version into old, v from public.docs d where d.col = p_col and d.id = p_id for update;
  ex := found;
  if ex then
    if p_ver is not null and v <> p_ver then return public._err('conflict'); end if;
  elsif p_ver is not null and p_ver > 0 then
    return public._err('conflict');
  end if;

  if p_col = 'notes' then
    if p_id !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}_K[123]_[A-Za-z0-9]{3,20}$' then
      return public._err('Mã ghi chú không hợp lệ.');
    end if;
    if ex then return public._err('Ghi chú đã gửi không sửa được, hãy thêm ghi chú mới.'); end if;
    txt := trim(coalesce(p_data ->> 'text', ''));
    if txt = '' then return public._err('Ghi chú đang trống.'); end if;
    if length(txt) > 2000 then return public._err('Ghi chú quá dài (tối đa 2000 ký tự).'); end if;
    p_data := jsonb_build_object('date', substr(p_id, 1, 10), 'shift', substr(p_id, 12, 2), 'text', txt,
                                 'byId', m.staff_id, 'by', public._actor(m), 'at', ms);

  elsif p_col = 'swaps' then
    if ex then return public._err('Không sửa được đề nghị đã gửi.'); end if;
    sa := p_data ->> 'fromShift'; sb := p_data ->> 'toShift';
    if not m.is_head and (p_data ->> 'from') is distinct from m.staff_id then
      return public._err('Bạn chỉ đề nghị đổi ca cho chính mình.');
    end if;
    if coalesce(p_data ->> 'to', '') = '' or (p_data ->> 'to') = (p_data ->> 'from')
       or coalesce(p_data ->> 'date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or sa not in ('K1', 'K2', 'K3') or sb not in ('K1', 'K2', 'K3') or sa = sb then
      return public._err('Đề nghị đổi ca không hợp lệ.');
    end if;
    if not exists (select 1 from public.docs where col = 'staff' and id = p_data ->> 'from')
       or not exists (select 1 from public.docs where col = 'staff' and id = p_data ->> 'to') then
      return public._err('Không tìm thấy nhân viên trong đề nghị.');
    end if;
    p_data := jsonb_build_object('from', p_data ->> 'from', 'to', p_data ->> 'to', 'date', p_data ->> 'date',
                                 'fromShift', sa, 'toShift', sb, 'reason', left(coalesce(p_data ->> 'reason', ''), 200),
                                 'createdAt', ms, 'byId', m.staff_id);

  elsif p_col = 'swapacks' then
    select d.data into swp from public.docs d where d.col = 'swaps' and d.id = p_id;
    if swp is null then return public._err('Không tìm thấy đề nghị đổi ca.'); end if;
    if jsonb_typeof(p_data -> 'ok') is distinct from 'boolean' then return public._err('Dữ liệu không hợp lệ.'); end if;
    if not m.is_head then
      if (swp ->> 'to') is distinct from m.staff_id then
        return public._err('Chỉ người được đề nghị đổi ca mới trả lời được.');
      end if;
      if ex then return public._err('Bạn đã trả lời đề nghị này rồi.'); end if;
    end if;
    p_data := jsonb_build_object('ok', (p_data ->> 'ok')::boolean, 'byId', m.staff_id, 'at', ms, 'byHead', m.is_head);

  elsif p_col = 'approvals' then
    if not m.is_head then return public._err('Chỉ trưởng ban thực hiện được.'); end if;
    if (p_data ->> 'status') not in ('approved', 'rejected') then return public._err('Dữ liệu không hợp lệ.'); end if;
    p_data := jsonb_build_object('status', p_data ->> 'status', 'at', ms, 'byId', m.staff_id);

  elsif p_col = 'leaves' then
    if not m.is_head then return public._err('Chỉ trưởng ban thực hiện được.'); end if;
    if coalesce(p_data ->> 'from', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or coalesce(p_data ->> 'to', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or (p_data ->> 'to') < (p_data ->> 'from')
       or not exists (select 1 from public.docs where col = 'staff' and id = p_data ->> 'staffId') then
      return public._err('Kỳ nghỉ phép không hợp lệ.');
    end if;

  else -- months
    if not m.is_head then return public._err('Chỉ trưởng ban thực hiện được.'); end if;
  end if;

  insert into public.docs (col, id, data, updated_at, version) values (p_col, p_id, p_data, now(), 1)
  on conflict (col, id) do update set data = excluded.data, updated_at = now(), version = public.docs.version + 1
  returning version into v;

  -- Nhật ký
  if p_col = 'months' then
    diff := public._assign_diff(old, p_data);
    select string_agg(x.value #>> '{}', '; ') into items from jsonb_array_elements(diff -> 'items') x;
    summ := case when not ex then 'Tạo lịch tháng ' || p_id
                 else 'Sửa lịch tháng ' || p_id end;
    if (diff ->> 'n')::int > 0 then
      summ := summ || ': ' || (diff ->> 'n') || ' ô thay đổi'
              || case when items is not null then ' (' || items || case when (diff ->> 'n')::int > 10 then '; …' else '' end || ')' else '' end;
    end if;
    if ex and old -> 'adj' is distinct from p_data -> 'adj' then summ := summ || '. Công thực tế có thay đổi'; end if;
    if ex and old -> 'holidays' is distinct from p_data -> 'holidays' then summ := summ || '. Ngày lễ có thay đổi'; end if;
    if ex and old -> 'headShift' is distinct from p_data -> 'headShift' then summ := summ || '. Ca cố định trưởng ban: ' || coalesce(p_data ->> 'headShift', ''); end if;
    if coalesce(trim(p_reason), '') <> '' then summ := summ || '. Lý do: ' || left(trim(p_reason), 300); end if;
    if not ex or old is distinct from p_data then
      perform public._log(m, case when ex then 'Sửa lịch' else 'Tạo lịch' end, p_id, summ,
                          jsonb_build_object('reason', left(coalesce(p_reason, ''), 300), 'changes', diff));
    end if;
  elsif p_col = 'leaves' then
    perform public._log(m, 'Nghỉ phép', p_id,
      'Đánh dấu nghỉ phép: ' || public._sname(p_data ->> 'staffId') || ' từ ' || (p_data ->> 'from') || ' đến ' || (p_data ->> 'to')
      || case when coalesce(p_data ->> 'note', '') <> '' then ' (' || (p_data ->> 'note') || ')' else '' end);
  elsif p_col = 'swaps' then
    perform public._log(m, 'Đề nghị đổi ca', p_id,
      public._sname(p_data ->> 'from') || ' (' || (p_data ->> 'fromShift') || ') ⇄ ' || public._sname(p_data ->> 'to')
      || ' (' || (p_data ->> 'toShift') || ') ngày ' || (p_data ->> 'date'));
  elsif p_col = 'swapacks' then
    perform public._log(m, 'Trả lời đổi ca', p_id,
      public._actor(m) || case when (p_data ->> 'ok')::boolean then ' đồng ý' else ' từ chối' end || ' đề nghị đổi ca '
      || coalesce((select (d.data ->> 'date') from public.docs d where d.col = 'swaps' and d.id = p_id), ''));
  elsif p_col = 'approvals' then
    swp := (select d.data from public.docs d where d.col = 'swaps' and d.id = p_id);
    perform public._log(m, 'Duyệt đổi ca', p_id,
      case when p_data ->> 'status' = 'approved' then 'Đồng ý' else 'Từ chối' end || ' đổi ca: '
      || coalesce(public._sname(swp ->> 'from') || ' ⇄ ' || public._sname(swp ->> 'to') || ' ngày ' || (swp ->> 'date'), p_id));
  end if;
  return jsonb_build_object('ok', true, 'version', v);
end $$;

create or replace function public.api_del(p_token text, p_col text, p_id text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare m public.accounts; old jsonb;
begin
  m := public._me(p_token);
  if m.staff_id is null then return public._err('expired'); end if;
  if not m.is_head then return public._err('Chỉ trưởng ban thực hiện được.'); end if;
  if p_col not in ('leaves', 'months', 'notes', 'swaps', 'swapacks', 'approvals') then
    return public._err('Không hợp lệ.');
  end if;
  select d.data into old from public.docs d where d.col = p_col and d.id = p_id;
  if old is null then return jsonb_build_object('ok', true); end if;
  delete from public.docs where col = p_col and id = p_id;
  perform public._log(m, 'Xóa', p_col || '/' || p_id,
    case p_col
      when 'leaves' then 'Xóa kỳ nghỉ phép: ' || public._sname(old ->> 'staffId') || ' từ ' || (old ->> 'from') || ' đến ' || (old ->> 'to')
      when 'notes' then 'Xóa ghi chú giao ban ' || p_id || ' của ' || coalesce(old ->> 'by', '?') || ': ' || left(coalesce(old ->> 'text', ''), 120)
      when 'months' then 'Xóa lịch tháng ' || p_id
      else 'Xóa ' || p_col || ' ' || p_id end,
    old);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.api_save_staff(p_token text, p_id text, p_data jsonb, p_pin text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare m public.accounts; code_new text; head_new boolean; exists_acc boolean; heads int; old jsonb; summ text;
begin
  m := public._me(p_token);
  if m.staff_id is null then return public._err('expired'); end if;
  if not m.is_head then return public._err('Chỉ trưởng ban sửa được hồ sơ.'); end if;
  if p_id is null or p_id !~ '^[A-Za-z0-9_:.-]{1,80}$' then
    return public._err('Mã nhân viên không hợp lệ.');
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    return public._err('Dữ liệu không hợp lệ.');
  end if;
  code_new := trim(coalesce(p_data ->> 'code', ''));
  head_new := (p_data ->> 'role') = 'head';
  if code_new = '' or trim(coalesce(p_data ->> 'name', '')) = '' then
    return public._err('Nhập họ tên và mã số.');
  end if;
  if length(trim(coalesce(p_data ->> 'emergency', ''))) < 8 then
    return public._err('SĐT khẩn cấp là bắt buộc.');
  end if;
  p_data := (p_data - 'pin' - '_v');
  select exists (select 1 from public.accounts where staff_id = p_id) into exists_acc;
  if not exists_acc and length(coalesce(p_pin, '')) < 6 then
    return public._err('Nhân viên mới cần PIN ít nhất 6 ký tự.');
  end if;
  if p_pin is not null and p_pin <> '' and length(p_pin) < 6 then
    return public._err('PIN cần ít nhất 6 ký tự.');
  end if;
  select data into old from public.docs where col = 'staff' and id = p_id;
  begin
    if exists_acc then
      update public.accounts
         set code = code_new, is_head = head_new,
             pin_hash = case when coalesce(p_pin, '') <> '' then crypt(p_pin, gen_salt('bf')) else pin_hash end,
             must_change = case when coalesce(p_pin, '') <> '' and p_id <> m.staff_id then true else must_change end,
             failed = case when coalesce(p_pin, '') <> '' then 0 else failed end,
             locked_until = case when coalesce(p_pin, '') <> '' then null else locked_until end
       where staff_id = p_id;
      if coalesce(p_pin, '') <> '' then
        delete from public.sessions where staff_id = p_id and token <> p_token;
      end if;
    else
      insert into public.accounts (staff_id, code, pin_hash, is_head, must_change)
      values (p_id, code_new, crypt(p_pin, gen_salt('bf')), head_new, true);
    end if;
  exception when unique_violation then
    return public._err('Mã số đã có người dùng.');
  end;
  select count(*) into heads from public.accounts where is_head;
  if heads = 0 then
    raise exception 'Phải còn ít nhất một trưởng ban.';
  end if;
  insert into public.docs (col, id, data, updated_at, version) values ('staff', p_id, p_data, now(), 1)
  on conflict (col, id) do update set data = excluded.data, updated_at = now(), version = public.docs.version + 1;
  summ := case when old is null then 'Thêm nhân viên ' else 'Sửa hồ sơ ' end
          || (p_data ->> 'name') || ' (mã ' || code_new || ')';
  if old is not null then
    if (old ->> 'offDay') is distinct from (p_data ->> 'offDay') then summ := summ || '; ngày nghỉ phiên đổi'; end if;
    if (old ->> 'active') is distinct from (p_data ->> 'active') then
      summ := summ || case when (p_data ->> 'active')::boolean then '; đang làm việc lại' else '; ngừng làm việc' end;
    end if;
    if (old ->> 'role') is distinct from (p_data ->> 'role') then summ := summ || '; vai trò đổi'; end if;
    if (old ->> 'emergency') is distinct from (p_data ->> 'emergency') then summ := summ || '; đổi SĐT khẩn cấp'; end if;
  end if;
  if coalesce(p_pin, '') <> '' then summ := summ || '; đặt PIN mới'; end if;
  perform public._log(m, case when old is null then 'Thêm nhân viên' else 'Sửa nhân viên' end, p_id, summ);
  return jsonb_build_object('ok', true);
exception when others then
  return public._err(sqlerrm);
end $$;

create or replace function public.api_delete_staff(p_token text, p_id text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare m public.accounts; target public.accounts; heads int; nm text;
begin
  m := public._me(p_token);
  if m.staff_id is null then return public._err('expired'); end if;
  if not m.is_head then return public._err('Chỉ trưởng ban xóa được.'); end if;
  if p_id = m.staff_id then
    return public._err('Không tự xóa tài khoản đang đăng nhập.');
  end if;
  select * into target from public.accounts where staff_id = p_id;
  if found and target.is_head then
    select count(*) into heads from public.accounts where is_head;
    if heads <= 1 then
      return public._err('Phải còn ít nhất một trưởng ban.');
    end if;
  end if;
  nm := public._sname(p_id);
  delete from public.accounts where staff_id = p_id;
  delete from public.docs where col = 'staff' and id = p_id;
  perform public._log(m, 'Xóa nhân viên', p_id, 'Xóa nhân viên ' || nm || ' cùng tài khoản đăng nhập');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.api_change_pin(p_token text, p_old text, p_new text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare m public.accounts; e text;
begin
  m := public._me_any(p_token);
  if m.staff_id is null then return public._err('expired'); end if;
  if m.pin_hash <> crypt(coalesce(p_old, ''), m.pin_hash) then
    return public._err('PIN hiện tại chưa đúng.');
  end if;
  e := public._pin_error(p_new, m.code);
  if e is not null then return public._err(e); end if;
  if p_new = p_old then return public._err('PIN mới phải khác PIN hiện tại.'); end if;
  update public.accounts set pin_hash = crypt(p_new, gen_salt('bf')), must_change = false where staff_id = m.staff_id;
  delete from public.sessions where staff_id = m.staff_id and token <> p_token;
  perform public._log(m, 'Đổi PIN', m.staff_id, public._actor(m) || ' tự đổi PIN');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.api_reset_viewer_pin(p_token text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare m public.accounts; n int;
begin
  m := public._me(p_token);
  if m.staff_id is null then return public._err('expired'); end if;
  if not m.is_head then
    return public._err('Chỉ trưởng ban thực hiện được.');
  end if;
  update public.accounts
     set pin_hash = crypt('123456', gen_salt('bf')), failed = 0, locked_until = null, must_change = true
   where staff_id = 'viewer_doichieu';
  get diagnostics n = row_count;
  if n = 0 then
    return public._err('Chưa có tài khoản đối chiếu. Hãy chạy tệp tai-khoan-doi-chieu.sql trước.');
  end if;
  delete from public.sessions where staff_id = 'viewer_doichieu';
  perform public._log(m, 'Đặt lại PIN', 'viewer_doichieu', 'Đặt lại PIN tài khoản đối chiếu về mặc định');
  return jsonb_build_object('ok', true);
end $$;

-- Bắt mọi tài khoản khác phải đổi PIN ở lần đăng nhập tới.
create or replace function public.api_force_pin_change(p_token text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare m public.accounts; n int;
begin
  m := public._me(p_token);
  if m.staff_id is null then return public._err('expired'); end if;
  if not m.is_head then return public._err('Chỉ trưởng ban thực hiện được.'); end if;
  update public.accounts set must_change = true where staff_id <> m.staff_id;
  get diagnostics n = row_count;
  delete from public.sessions where staff_id <> m.staff_id;
  perform public._log(m, 'Bắt đổi PIN', null, 'Bắt ' || n || ' tài khoản phải đổi PIN ở lần đăng nhập tới');
  return jsonb_build_object('ok', true, 'count', n);
end $$;

-- Nhật ký: trưởng ban và tài khoản đối chiếu xem được.
create or replace function public.api_audit(p_token text, p_limit int default 300)
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare m public.accounts; rows jsonb;
begin
  m := public._me(p_token);
  if m.staff_id is null then return public._err('expired'); end if;
  if not (m.is_head or m.is_viewer) then return public._err('Chỉ trưởng ban hoặc tài khoản đối chiếu xem được.'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'at', (extract(epoch from t.at) * 1000)::bigint,
           'actor', t.actor, 'action', t.action, 'target', t.target, 'summary', t.summary) order by t.id desc), '[]'::jsonb)
    into rows
  from (select * from public.audit_log order by id desc limit greatest(1, least(coalesce(p_limit, 300), 1000))) t;
  return jsonb_build_object('ok', true, 'rows', rows);
end $$;

-- Sao lưu toàn bộ dữ liệu (không gồm mã băm PIN).
create or replace function public.api_export(p_token text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare m public.accounts; docs jsonb; accs jsonb; aud jsonb;
begin
  m := public._me(p_token);
  if m.staff_id is null then return public._err('expired'); end if;
  if not m.is_head then return public._err('Chỉ trưởng ban thực hiện được.'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('col', col, 'id', id, 'data', data, 'version', version) order by col, id), '[]'::jsonb)
    into docs from public.docs;
  select coalesce(jsonb_agg(jsonb_build_object('staff_id', staff_id, 'code', code, 'is_head', is_head,
           'is_viewer', is_viewer, 'display_name', display_name) order by staff_id), '[]'::jsonb) into accs from public.accounts;
  select coalesce(jsonb_agg(jsonb_build_object('at', at, 'actor', actor, 'action', action, 'target', target, 'summary', summary)
           order by id desc), '[]'::jsonb) into aud
    from (select * from public.audit_log order by id desc limit 2000) a;
  perform public._log(m, 'Sao lưu', null, 'Tải bản sao lưu toàn bộ dữ liệu (' || jsonb_array_length(docs) || ' bản ghi)');
  return jsonb_build_object('ok', true, 'backup', jsonb_build_object(
    'app', 'bvvh', 'format', 1, 'exported_at', now(), 'docs', docs, 'accounts', accs, 'audit', aud));
end $$;

-- Khôi phục từ bản sao lưu: ghi đè các bản ghi có trong tệp; không động tới tài khoản, PIN, nhật ký.
create or replace function public.api_restore(p_token text, p_backup jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare m public.accounts; e jsonb; n int := 0; c text; i text; d jsonb;
begin
  m := public._me(p_token);
  if m.staff_id is null then return public._err('expired'); end if;
  if not m.is_head then return public._err('Chỉ trưởng ban thực hiện được.'); end if;
  if p_backup is null or (p_backup ->> 'app') is distinct from 'bvvh' or jsonb_typeof(p_backup -> 'docs') <> 'array' then
    return public._err('Tệp không phải bản sao lưu của ứng dụng này.');
  end if;
  if jsonb_array_length(p_backup -> 'docs') > 20000 then return public._err('Tệp quá lớn.'); end if;
  for e in select value from jsonb_array_elements(p_backup -> 'docs') loop
    c := e ->> 'col'; i := e ->> 'id'; d := e -> 'data';
    continue when c not in ('staff', 'leaves', 'months', 'notes', 'swaps', 'swapacks', 'approvals');
    continue when i is null or i !~ '^[A-Za-z0-9_:.-]{1,80}$' or jsonb_typeof(d) <> 'object';
    d := d - '_v';
    insert into public.docs (col, id, data, updated_at, version) values (c, i, d, now(), 1)
    on conflict (col, id) do update set data = excluded.data, updated_at = now(), version = public.docs.version + 1;
    n := n + 1;
  end loop;
  perform public._log(m, 'Khôi phục', null, 'Khôi phục ' || n || ' bản ghi từ tệp sao lưu tạo lúc ' || coalesce(p_backup ->> 'exported_at', '?'));
  return jsonb_build_object('ok', true, 'count', n);
end $$;

-- ---------------------------------------------------------------- quyền gọi hàm
-- Hàm bắt đầu bằng _ là hàm nội bộ, không cho khóa công khai gọi.
-- Hàm api_*, login, needs_setup, setup_head là hàm ứng dụng gọi.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as f, p.proname as n
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
    where s.nspname = 'public'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.f);
    if r.n like 'api\_%' or r.n in ('login', 'needs_setup', 'setup_head') then
      execute format('grant execute on function %s to anon, authenticated', r.f);
    end if;
  end loop;
end $$;

-- Báo cho Supabase nạp lại danh sách hàm ngay (tránh lỗi "Could not find the function ... in the schema cache").
notify pgrst, 'reload schema';
