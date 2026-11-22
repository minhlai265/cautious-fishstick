# IELTS Practice

Trang web luyện thi IELTS (Academic) đủ 4 kỹ năng, chạy hoàn toàn trên trình duyệt – không cần cài đặt hay build.

## Tính năng
- **Reading**: 2 bài đọc học thuật (24 câu) – True/False/Not Given, trắc nghiệm, matching, điền từ; bấm giờ 20 phút, chấm tự động, giải thích đáp án, quy đổi band.
- **Listening**: 2 section (15 câu) đọc bằng Text-to-Speech của trình duyệt, chỉnh tốc độ, transcript hiện sau khi nộp.
- **Writing**: Task 1 (biểu đồ cột/đường) & 6 đề Task 2, đếm từ, bấm giờ, tự lưu nháp, phân tích bài viết (từ nối, từ lặp, độ dài câu), bài mẫu, tự chấm 4 tiêu chí.
- **Speaking**: Part 1 theo chủ đề, Part 2 cue card (1 phút chuẩn bị + 2 phút nói), Part 3; đọc câu hỏi bằng giọng nói, ghi âm và nghe lại.
- **Từ vựng**: 36 từ theo 6 chủ đề – flashcard, quiz, danh sách, phát âm.
- **Tiến độ**: lịch sử làm bài và band ước tính từng kỹ năng + overall (lưu trong localStorage).
- Giao diện sáng/tối, responsive trên điện thoại.

## Chạy
Mở `index.html` bằng trình duyệt, hoặc:
```bash
python3 -m http.server 8000   # rồi mở http://localhost:8000
```
Ghi âm (Speaking) cần chạy qua `localhost` hoặc HTTPS để trình duyệt cho phép dùng micro.

## Thêm đề
Toàn bộ nội dung nằm trong `data.js` – thêm bài đọc, bài nghe, đề viết, cue card hay từ vựng theo cùng cấu trúc là trang tự hiển thị.
