# IELTS Practice

Trang web luyện thi IELTS (Academic) đủ 4 kỹ năng, chạy hoàn toàn trên trình duyệt – không cần cài đặt hay build.

## Tính năng
- **Reading**: 4 bài đọc học thuật (49 câu, có Matching Headings) – True/False/Not Given, trắc nghiệm, matching, điền từ; bấm giờ 20 phút, chấm tự động, giải thích đáp án, quy đổi band.
- **Listening**: 4 section 1–4 (32 câu) đọc bằng Text-to-Speech của trình duyệt, chỉnh tốc độ, transcript hiện sau khi nộp.
- **Writing**: 4 đề Task 1 (biểu đồ cột/đường) & 10 đề Task 2 (2 bài mẫu), đếm từ, bấm giờ, tự lưu nháp, phân tích bài viết (từ nối, từ lặp, độ dài câu), bài mẫu, tự chấm 4 tiêu chí.
- **Speaking**: 9 chủ đề Part 1, 8 cue card Part 2 (1 phút chuẩn bị + 2 phút nói), Part 3; đọc câu hỏi bằng giọng nói, ghi âm và nghe lại.
- **Từ vựng**: 60 từ theo 10 chủ đề – flashcard, quiz, danh sách, phát âm.
- **Tiến độ**: lịch sử làm bài và band ước tính từng kỹ năng + overall (lưu trong localStorage).
- **Menu** kiểu thư viện đề: thả xuống trên máy tính, ngăn kéo dạng accordion trên điện thoại.
- **Bộ đề tổng hợp**, **Mẹo IELTS** (8 bài), **Lộ trình học cá nhân**, **Lớp trực tuyến** (lịch mẫu, đăng ký), **Khóa học** (3 khóa, tự đánh dấu tiến độ), **Du học** (mức IELTS tham khảo + công cụ kiểm tra), **HSK Test** (quiz HSK 1).
- **Tài khoản**: bảng điều khiển, ví credit (nạp demo, không thanh toán thật), dịch vụ luyện thi, hồ sơ, mã giới thiệu.
- Giao diện sáng/tối, responsive trên điện thoại.

> Các phần lớp trực tuyến, ví, dịch vụ và giới thiệu hiện là bản demo phía trình duyệt (lưu trong localStorage). Muốn chạy thật cần thêm máy chủ, cổng thanh toán và hệ thống tài khoản.

## Chạy
Mở `index.html` bằng trình duyệt, hoặc:
```bash
python3 -m http.server 8000   # rồi mở http://localhost:8000
```
Ghi âm (Speaking) cần chạy qua `localhost` hoặc HTTPS để trình duyệt cho phép dùng micro.

## Thêm đề
Toàn bộ nội dung nằm trong `data.js` – thêm bài đọc, bài nghe, đề viết, cue card hay từ vựng theo cùng cấu trúc là trang tự hiển thị.
