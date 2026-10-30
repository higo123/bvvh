# Lịch trực Bảo Vệ Việt Hưng

Ứng dụng web xếp lịch trực 3 ca (K1 06–14, K2 14–22, K3 22–06) cho tổ bảo vệ. Chạy trên điện thoại, không cần cài đặt, không cần tài khoản Claude.

**Tính năng**
- Lịch tháng theo số ngày thật, mỗi ca một màu, tự chia đều và ai cũng có ca K3.
- Nghỉ phiên (một ngày cố định mỗi tuần) và nghỉ phép (trưởng ban đánh dấu ngày bắt đầu, ngày kết thúc).
- Đổi ca giữa hai người: người kia phải đồng ý trước, sau đó trưởng ban duyệt thì lịch mới đổi.
- Giao ban theo từng ca mỗi ngày, ghi nối tiếp (mỗi ghi chú là một dòng có tên người và giờ, gửi rồi không sửa được).
- Cảnh báo nghỉ ngơi: K3 rồi K1 liền ngày, làm quá 6 ngày liên tục (trên lịch, khi điều chuyển, khi đổi ca). Bộ xếp ca tự tránh K3 rồi K1.
- Công thực tế: trưởng ban ghi nghỉ đột xuất, vắng không phép, giờ làm thêm, đánh dấu ngày lễ; bảng tổng hợp có giờ theo lịch, giờ thực tế, giờ ngày lễ (tải CSV được).
- Nhật ký thay đổi (ai sửa gì, lúc nào, lý do mở khóa), sao lưu và khôi phục toàn bộ dữ liệu.
- Chống ghi đè: nếu hai người sửa cùng một mục, người lưu sau được báo và tải lại bản mới thay vì âm thầm đè lên nhau.
- PIN: tối thiểu 6 ký tự, chặn PIN dễ đoán, PIN do trưởng ban cấp hoặc đặt lại thì người dùng phải tự đổi ở lần đăng nhập đầu.
- Mỗi nhân viên có mã số và PIN riêng. Chỉ trưởng ban sửa được mã số, hồ sơ, SĐT khẩn cấp (bắt buộc).

**Cách hoạt động:** trang tĩnh (GitHub Pages) + cơ sở dữ liệu Supabase. Các bảng bị khóa hoàn toàn với bên ngoài, ứng dụng chỉ gọi các hàm trong `supabase.sql`; mỗi hàm tự kiểm tra đăng nhập và quyền. PIN được băm bằng bcrypt, sai 5 lần thì tạm khóa 10 phút.

## Cài đặt (làm một lần, khoảng 10 phút)

### 1. Tạo dự án Supabase
1. Vào https://supabase.com, đăng ký và bấm **New project** (gói miễn phí là đủ). Đặt tên bất kỳ, tạo mật khẩu cơ sở dữ liệu, chọn vùng gần Việt Nam (Singapore).
2. Đợi dự án khởi tạo xong.

### 2. Tạo bảng và hàm
1. Trong Supabase mở **SQL Editor → New query**.
2. Dán toàn bộ nội dung tệp `supabase.sql` rồi bấm **Run**. Thấy "Success" là xong.

### 2b. (Tùy chọn) Nạp dữ liệu demo
Muốn dùng thử ngay với 12 người mẫu và lịch tháng 10, tháng 11 đã xếp sẵn: trong SQL Editor, dán nội dung tệp `demo-data.sql` rồi bấm **Run**. Tài khoản trưởng ban là mã số `VH01`, nhân viên là `VH02` đến `VH12`. PIN demo ghi trong đầu tệp `demo-data.sql` và rất yếu, nên lần đầu đăng nhập ứng dụng bắt mỗi người đổi PIN. **Trước khi dùng thật, không nên nạp demo và nên xóa `demo-data.sql` khỏi repo công khai** vì PIN demo ai cũng đọc được. Nếu nạp demo thì sẽ không hiện màn hình thiết lập lần đầu ở bước 5.

### 3. Điền khóa kết nối
1. Trong Supabase mở **Project Settings → API**.
2. Chép **Project URL** và khóa **anon public**.
3. Mở tệp `config.js` trong repo, dán hai giá trị vào `SUPABASE_URL` và `SUPABASE_ANON_KEY`, rồi lưu (commit).
   Khóa `anon` được phép nằm trong mã nguồn công khai. Không bao giờ dán khóa `service_role` vào repo.

### 4. Bật GitHub Pages
1. Vào repo → **Settings → Pages**.
2. Mục **Build and deployment**: Source chọn **Deploy from a branch**, Branch chọn `main`, thư mục `/ (root)`, bấm **Save**.
3. Sau 1–2 phút trang có địa chỉ dạng `https://<tên-tài-khoản>.github.io/bvvh/`.

### 5. Thiết lập lần đầu
1. Mở địa chỉ trên. Lần đầu trang hiện màn hình **Thiết lập lần đầu**: nhập họ tên, mã số, SĐT khẩn cấp và PIN cho trưởng ban.
2. Vào tab **Nhân sự → Thêm nhân viên** để tạo từng người. Mỗi người có mã số và PIN riêng (nút "Tạo ngẫu nhiên" sinh PIN 6 số). Đưa mã số và PIN cho nhân viên.
3. Vào tab **Nghỉ phép** để nhập kỳ nghỉ nếu có, rồi vào tab **Lịch trực** bấm **Tạo lịch tháng**.

### 6. Cho nhân viên dùng trên điện thoại
Gửi địa chỉ trang cho từng người. Trên điện thoại mở bằng trình duyệt rồi:
- iPhone (Safari): nút Chia sẻ → **Thêm vào Màn hình chính**.
- Android (Chrome): menu ⋮ → **Thêm vào màn hình chính** hoặc **Cài đặt ứng dụng**.

## Dùng hằng tháng
- Ngày mùng 1: trưởng ban vào tab **Lịch trực**, chọn đúng tháng và bấm **Tạo lịch tháng**.
- Có người vào hoặc nghỉ giữa tháng: sửa ở tab **Nhân sự**, rồi bấm **Xếp lại từ ngày N** (các ngày trước N giữ nguyên).
- Nhân viên muốn đổi ca: tab **Đổi ca** → gửi đề nghị. Người được đề nghị bấm **Tôi đồng ý đổi**, sau đó trưởng ban bấm **Đồng ý** thì lịch tự cập nhật (nếu có cảnh báo nghỉ ngơi hoặc người kia chưa đồng ý, trưởng ban phải xác nhận lần nữa).
- Ghi nhận thực tế: trên tab **Lịch trực** bấm ô của một người, chọn Nghỉ đột xuất, Vắng không phép hoặc nhập giờ làm thêm; bấm **Đánh dấu ngày lễ** cho ngày lễ. Số liệu vào tab **Tổng hợp**.
- Lịch mỗi tháng tự khóa vào 00:00 ngày 10 của tháng sau (ví dụ tháng 10 khóa từ 10/11), để còn vài ngày điều chỉnh. Sau đó nhân viên không ghi được giao ban hay đề nghị đổi ca của tháng đó, và không ai chỉnh được lịch tháng đó. Chỉ trưởng ban thấy nút **Mở khóa để chỉnh sửa** trên thanh thông báo của tháng đó, phải nhập lý do (ghi vào Nhật ký), bấm **Khóa lại** khi xong. Ngày nghỉ phiên của từng người được lưu cố định theo từng tháng nên đổi hồ sơ sau này không làm thay đổi bảng công cũ.
- Cuối tháng: tab **Tổng hợp**, bấm **Tải CSV** nếu cần gửi đi.
- Mỗi tháng nên bấm **Tải bản sao lưu** (tab Nhân sự) và cất tệp ở Google Drive hoặc máy. Ứng dụng nhắc khi quá 30 ngày chưa sao lưu. Khôi phục: chọn tệp ở cùng khung rồi xác nhận.
- Tab **Nhật ký** (trưởng ban và tài khoản đối chiếu xem được) cho biết ai đã sửa gì.

## Tài khoản đối chiếu (chỉ xem)

Dành cho phòng nhân sự hoặc người kiểm tra. Xem được mọi tab nhưng không có nút thao tác nào, và máy chủ từ chối mọi lệnh ghi. Tài khoản này không phải nhân viên nên không có tên trong bảng lịch, bảng tổng hợp hay danh sách nhân sự.

Cách tạo: dán lại `supabase.sql` (bản mới nhất) vào SQL Editor rồi Run, sau đó dán và Run `tai-khoan-doi-chieu.sql`. Tệp này tạo tài khoản mã đăng nhập `0001`, PIN `12345`. Lần đăng nhập đầu ứng dụng bắt đổi PIN (ít nhất 6 ký tự). Tài khoản này xem được cả tab Nhật ký. Nếu họ quên PIN, trưởng ban vào tab **Nhân sự** và bấm nút đỏ **Đặt lại PIN DoiChieu về 123456** (có bước xác nhận), không cần chạy SQL. Muốn xóa tài khoản, chạy lệnh `delete` ghi ở cuối tệp `tai-khoan-doi-chieu.sql`.

## Lưu ý
- Bản cập nhật này đổi cấu trúc cơ sở dữ liệu: **dán lại toàn bộ `supabase.sql` và Run** trước khi dùng giao diện mới (không mất dữ liệu). Nếu dùng tài khoản đối chiếu, chạy lại cả `tai-khoan-doi-chieu.sql`.
- Sau khi cập nhật, các tài khoản demo và tài khoản đối chiếu bị buộc đổi PIN ở lần đăng nhập đầu. Muốn bắt toàn bộ nhân viên đổi PIN (ví dụ nghi lộ PIN), vào Nhân sự bấm **Bắt tất cả đổi PIN**.
- Mỗi khi repo có thay đổi ở `supabase.sql`, hãy dán lại toàn bộ tệp vào SQL Editor và Run một lần (chạy lại an toàn, không mất dữ liệu).
- Quên PIN của nhân viên: trưởng ban vào Nhân sự → Sửa và đặt PIN mới.
- Trưởng ban quên PIN: vào Supabase → SQL Editor, chạy lệnh sau (đổi `PIN_MOI` thành PIN mới, ít nhất 6 ký tự):
  ```sql
  update public.accounts
     set pin_hash = extensions.crypt('PIN_MOI', extensions.gen_salt('bf')), failed = 0, locked_until = null
   where is_head;
  ```
- Dữ liệu cập nhật tự động mỗi 15 giây và khi mở lại ứng dụng.
- Gói miễn phí của Supabase tạm dừng dự án sau một tuần không có truy cập. Nếu gặp lỗi kết nối, vào Supabase bấm **Restore project**.
