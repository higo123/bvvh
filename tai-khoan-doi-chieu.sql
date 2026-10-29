-- Tài khoản ĐỐI CHIẾU (chỉ xem) cho phòng nhân sự.
--   Tên hiển thị: DoiChieu   Mã đăng nhập: 0001   PIN: 12345
-- Xem được mọi tab như trưởng ban nhưng không có nút thao tác và máy chủ từ chối mọi lệnh ghi.
-- Chạy SAU khi đã chạy supabase.sql bản mới nhất. Chạy lại được: sẽ đặt lại PIN về 12345.
-- PIN 12345 rất yếu. Hãy đăng nhập rồi bấm "Đổi PIN" để đặt PIN riêng (ít nhất 6 ký tự).
-- Quên PIN: trưởng ban vào tab Nhân sự, bấm nút đỏ "Đặt lại PIN DoiChieu về 123456" (không cần chạy lại SQL).

alter table public.accounts add column if not exists is_viewer boolean not null default false;
alter table public.accounts add column if not exists display_name text;

insert into public.accounts (staff_id, code, pin_hash, is_head, is_viewer, display_name)
values ('viewer_doichieu', '0001', extensions.crypt('12345', extensions.gen_salt('bf')), false, true, 'DoiChieu')
on conflict (staff_id) do update
  set code = excluded.code, pin_hash = excluded.pin_hash, is_head = false, is_viewer = true,
      display_name = excluded.display_name, failed = 0, locked_until = null;

-- Nếu muốn khóa hoặc xóa tài khoản này sau này:
--   delete from public.accounts where staff_id = 'viewer_doichieu';
