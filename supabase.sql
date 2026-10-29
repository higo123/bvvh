-- Lịch trực Bảo Vệ Việt Hưng: lược đồ Supabase
-- Chạy toàn bộ tệp này một lần trong Supabase → SQL Editor → New query → Run.
-- Có thể chạy lại an toàn (không xóa dữ liệu).
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

create table if not exists public.accounts (
  staff_id     text primary key,
  code         text not null,
  pin_hash     text not null,
  is_head      boolean not null default false,
  failed       int not null default 0,
  locked_until timestamptz
);
create unique index if not exists accounts_code_lower on public.accounts (lower(code));

create table if not exists public.sessions (
  token      text primary key,
  staff_id   text not null references public.accounts (staff_id) on delete cascade,
  expires_at timestamptz not null
);
create index if not exists sessions_staff on public.sessions (staff_id);

alter table public.docs     enable row level security;
alter table public.accounts enable row level security;
alter table public.sessions enable row level security;
revoke all on public.docs, public.accounts, public.sessions from anon, authenticated;

-- ---------------------------------------------------------------- hàm nội bộ
create or replace function public._me(p_token text)
returns public.accounts
language sql stable security definer
set search_path = public, extensions
as $$
  select a.* from public.sessions s
  join public.accounts a on a.staff_id = s.staff_id
  where s.token = p_token and s.expires_at > now()
$$;
revoke all on function public._me(text) from public, anon, authenticated;

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
revoke all on function public._login_result(text) from public, anon, authenticated;

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
declare sid text;
begin
  lock table public.accounts in share row exclusive mode;
  if exists (select 1 from public.accounts) then
    return jsonb_build_object('ok', false, 'error', 'Đã thiết lập rồi, hãy đăng nhập.');
  end if;
  if coalesce(trim(p_code), '') = '' or coalesce(trim(p_name), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'Nhập họ tên và mã số.');
  end if;
  if length(coalesce(p_pin, '')) < 6 then
    return jsonb_build_object('ok', false, 'error', 'PIN cần ít nhất 6 ký tự.');
  end if;
  sid := 's' || substr(md5(random()::text || clock_timestamp()::text), 1, 10);
  insert into public.accounts (staff_id, code, pin_hash, is_head)
  values (sid, trim(p_code), crypt(p_pin, gen_salt('bf')), true);
  insert into public.docs (col, id, data) values ('staff', sid, jsonb_build_object(
    'code', trim(p_code), 'name', trim(p_name), 'role', 'head', 'phone', '',
    'emergency', trim(coalesce(p_emergency, '')), 'offDay', -1, 'active', true));
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
    return jsonb_build_object('ok', false, 'error', 'Sai mã số hoặc PIN.');
  end if;
  if a.locked_until is not null and a.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'Nhập sai nhiều lần, tài khoản tạm khóa ít phút. Hãy thử lại sau.');
  end if;
  if a.pin_hash <> crypt(coalesce(p_pin, ''), a.pin_hash) then
    update public.accounts
       set failed = case when failed + 1 >= 5 then 0 else failed + 1 end,
           locked_until = case when failed + 1 >= 5 then now() + interval '10 minutes' else locked_until end
     where staff_id = a.staff_id;
    return jsonb_build_object('ok', false, 'error', 'Sai mã số hoặc PIN.');
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
declare m public.accounts; docs jsonb;
begin
  m := public._me(p_token);
  if m.staff_id is null then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;
  select coalesce(jsonb_object_agg(col, d), '{}'::jsonb) into docs
  from (
    select col, jsonb_object_agg(id, data) d
    from public.docs
    where col in ('staff', 'leaves', 'months')
       or updated_at > now() - interval '150 days'
    group by col
  ) x;
  return jsonb_build_object('ok', true, 'docs', docs,
    'me', jsonb_build_object('id', m.staff_id, 'is_head', m.is_head));
end $$;

create or replace function public.api_put(p_token text, p_col text, p_id text, p_data jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare m public.accounts; mon text;
begin
  m := public._me(p_token);
  if m.staff_id is null then return jsonb_build_object('ok', false, 'error', 'expired'); end if;
  if p_col not in ('leaves', 'months', 'notes', 'swaps', 'approvals') then
    return jsonb_build_object('ok', false, 'error', 'Không hợp lệ.');
  end if;
  if p_id is null or p_id !~ '^[A-Za-z0-9_:.-]{1,80}$' then
    return jsonb_build_object('ok', false, 'error', 'Mã bản ghi không hợp lệ.');
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' or length(p_data::text) > 200000 then
    return jsonb_build_object('ok', false, 'error', 'Dữ liệu không hợp lệ.');
  end if;
  -- Khóa tháng cũ: nhân viên không ghi được vào giao ban hoặc đề nghị đổi ca của tháng đã khóa.
  mon := case p_col when 'notes' then substr(p_id, 1, 7)
                    when 'swaps' then substr(coalesce(p_data ->> 'date', ''), 1, 7) else null end;
  -- Tháng M khóa từ 00:00 ngày 10 của tháng M+1 (giờ Việt Nam).
  if not m.is_head and mon ~ '^[0-9]{4}-[0-9]{2}$'
     and (now() at time zone 'Asia/Ho_Chi_Minh')::date
         >= (to_date(mon || '-01', 'YYYY-MM-DD') + interval '1 month' + interval '9 days')::date then
    return jsonb_build_object('ok', false, 'error', 'Tháng này đã khóa, chỉ trưởng ban sửa được.');
  end if;
  if p_col in ('notes') then
    null; -- mọi nhân viên đã đăng nhập được ghi giao ban
  elsif p_col = 'swaps' then
    if not m.is_head then
      if (p_data ->> 'from') is distinct from m.staff_id then
        return jsonb_build_object('ok', false, 'error', 'Bạn chỉ đề nghị đổi ca cho chính mình.');
      end if;
      if exists (select 1 from public.docs where col = 'swaps' and id = p_id) then
        return jsonb_build_object('ok', false, 'error', 'Không sửa được đề nghị đã gửi.');
      end if;
    end if;
  elsif not m.is_head then
    return jsonb_build_object('ok', false, 'error', 'Chỉ trưởng ban thực hiện được.');
  end if;
  insert into public.docs (col, id, data, updated_at) values (p_col, p_id, p_data, now())
  on conflict (col, id) do update set data = excluded.data, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.api_del(p_token text, p_col text, p_id text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare m public.accounts;
begin
  m := public._me(p_token);
  if m.staff_id is null then return jsonb_build_object('ok', false, 'error', 'expired'); end if;
  if not m.is_head then return jsonb_build_object('ok', false, 'error', 'Chỉ trưởng ban thực hiện được.'); end if;
  if p_col not in ('leaves', 'months', 'notes', 'swaps', 'approvals') then
    return jsonb_build_object('ok', false, 'error', 'Không hợp lệ.');
  end if;
  delete from public.docs where col = p_col and id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.api_save_staff(p_token text, p_id text, p_data jsonb, p_pin text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare m public.accounts; code_new text; head_new boolean; exists_acc boolean; heads int;
begin
  m := public._me(p_token);
  if m.staff_id is null then return jsonb_build_object('ok', false, 'error', 'expired'); end if;
  if not m.is_head then return jsonb_build_object('ok', false, 'error', 'Chỉ trưởng ban sửa được hồ sơ.'); end if;
  if p_id is null or p_id !~ '^[A-Za-z0-9_:.-]{1,80}$' then
    return jsonb_build_object('ok', false, 'error', 'Mã nhân viên không hợp lệ.');
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'Dữ liệu không hợp lệ.');
  end if;
  code_new := trim(coalesce(p_data ->> 'code', ''));
  head_new := (p_data ->> 'role') = 'head';
  if code_new = '' or trim(coalesce(p_data ->> 'name', '')) = '' then
    return jsonb_build_object('ok', false, 'error', 'Nhập họ tên và mã số.');
  end if;
  if length(trim(coalesce(p_data ->> 'emergency', ''))) < 8 then
    return jsonb_build_object('ok', false, 'error', 'SĐT khẩn cấp là bắt buộc.');
  end if;
  p_data := p_data - 'pin';
  select exists (select 1 from public.accounts where staff_id = p_id) into exists_acc;
  if not exists_acc and length(coalesce(p_pin, '')) < 6 then
    return jsonb_build_object('ok', false, 'error', 'Nhân viên mới cần PIN ít nhất 6 ký tự.');
  end if;
  if p_pin is not null and p_pin <> '' and length(p_pin) < 6 then
    return jsonb_build_object('ok', false, 'error', 'PIN cần ít nhất 6 ký tự.');
  end if;
  begin
    if exists_acc then
      update public.accounts
         set code = code_new, is_head = head_new,
             pin_hash = case when coalesce(p_pin, '') <> '' then crypt(p_pin, gen_salt('bf')) else pin_hash end,
             failed = case when coalesce(p_pin, '') <> '' then 0 else failed end,
             locked_until = case when coalesce(p_pin, '') <> '' then null else locked_until end
       where staff_id = p_id;
      if coalesce(p_pin, '') <> '' then
        delete from public.sessions where staff_id = p_id and token <> p_token;
      end if;
    else
      insert into public.accounts (staff_id, code, pin_hash, is_head)
      values (p_id, code_new, crypt(p_pin, gen_salt('bf')), head_new);
    end if;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'Mã số đã có người dùng.');
  end;
  select count(*) into heads from public.accounts where is_head;
  if heads = 0 then
    raise exception 'Phải còn ít nhất một trưởng ban.';
  end if;
  insert into public.docs (col, id, data, updated_at) values ('staff', p_id, p_data, now())
  on conflict (col, id) do update set data = excluded.data, updated_at = now();
  return jsonb_build_object('ok', true);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;

create or replace function public.api_delete_staff(p_token text, p_id text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare m public.accounts; target public.accounts; heads int;
begin
  m := public._me(p_token);
  if m.staff_id is null then return jsonb_build_object('ok', false, 'error', 'expired'); end if;
  if not m.is_head then return jsonb_build_object('ok', false, 'error', 'Chỉ trưởng ban xóa được.'); end if;
  if p_id = m.staff_id then
    return jsonb_build_object('ok', false, 'error', 'Không tự xóa tài khoản đang đăng nhập.');
  end if;
  select * into target from public.accounts where staff_id = p_id;
  if found and target.is_head then
    select count(*) into heads from public.accounts where is_head;
    if heads <= 1 then
      return jsonb_build_object('ok', false, 'error', 'Phải còn ít nhất một trưởng ban.');
    end if;
  end if;
  delete from public.accounts where staff_id = p_id;
  delete from public.docs where col = 'staff' and id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.api_change_pin(p_token text, p_old text, p_new text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare m public.accounts;
begin
  m := public._me(p_token);
  if m.staff_id is null then return jsonb_build_object('ok', false, 'error', 'expired'); end if;
  if length(coalesce(p_new, '')) < 6 then
    return jsonb_build_object('ok', false, 'error', 'PIN mới cần ít nhất 6 ký tự.');
  end if;
  if m.pin_hash <> crypt(coalesce(p_old, ''), m.pin_hash) then
    return jsonb_build_object('ok', false, 'error', 'PIN hiện tại chưa đúng.');
  end if;
  update public.accounts set pin_hash = crypt(p_new, gen_salt('bf')) where staff_id = m.staff_id;
  delete from public.sessions where staff_id = m.staff_id and token <> p_token;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- quyền gọi hàm
revoke all on function
  public.needs_setup(), public.setup_head(text, text, text, text), public.login(text, text),
  public.api_logout(text), public.api_get(text), public.api_put(text, text, text, jsonb),
  public.api_del(text, text, text), public.api_save_staff(text, text, jsonb, text),
  public.api_delete_staff(text, text), public.api_change_pin(text, text, text)
from public;
grant execute on function
  public.needs_setup(), public.setup_head(text, text, text, text), public.login(text, text),
  public.api_logout(text), public.api_get(text), public.api_put(text, text, text, jsonb),
  public.api_del(text, text, text), public.api_save_staff(text, text, jsonb, text),
  public.api_delete_staff(text, text), public.api_change_pin(text, text, text)
to anon, authenticated;
