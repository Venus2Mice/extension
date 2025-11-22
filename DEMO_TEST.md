# 🎯 DEMO & TEST

## Test Extension nhanh

### Test 1: Kiểm tra Extension đã cài đặt
```
1. Mở Edge → edge://extensions/
2. Tìm "Gemini Translator - Vietnamese"
3. Kiểm tra trạng thái: ON (màu xanh)
```

### Test 2: Kiểm tra API Key
```
1. Click icon extension (góc phải trên)
2. Xem có API key trong ô input không
3. Nếu chưa có → Nhập API key → Click "Lưu API Key"
```

### Test 3: Dịch văn bản đơn giản
```
1. Mở trang: https://en.wikipedia.org/wiki/Vietnam
2. Chọn đoạn text: "Vietnam, officially the Socialist Republic of Vietnam"
3. Click chuột phải → "Dịch văn bản đã chọn"
4. Popup hiển thị bản dịch tiếng Việt
```

### Test 4: Dịch toàn trang
```
1. Vẫn ở trang Wikipedia
2. Click chuột phải → "Dịch trang này sang tiếng Việt"
3. Loading indicator xuất hiện
4. Trang được dịch từng phần
5. Notification "Đã dịch trang thành công!" xuất hiện
```

### Test 5: Khôi phục trang gốc
```
1. Click chuột phải → "Dịch trang này sang tiếng Việt" (lần 2)
2. Hoặc: Click icon extension → "Khôi Phục Gốc"
3. Trang trở về nội dung tiếng Anh ban đầu
```

## Các trang web hay để test

### Tiếng Anh
- https://en.wikipedia.org/wiki/Artificial_intelligence
- https://www.bbc.com/news
- https://edition.cnn.com

### Tiếng Nhật
- https://ja.wikipedia.org/wiki/人工知能
- https://www3.nhk.or.jp/news/

### Tiếng Hàn
- https://ko.wikipedia.org/wiki/인공지능
- https://www.naver.com

### Tiếng Trung
- https://zh.wikipedia.org/wiki/人工智能
- https://www.baidu.com

## Kết quả mong đợi

✅ **Thành công khi:**
- Văn bản được dịch sang tiếng Việt
- Định dạng trang web được giữ nguyên
- Link, button vẫn hoạt động bình thường
- Có thể khôi phục trang gốc

❌ **Lỗi khi:**
- "API key chưa được cấu hình" → Chưa nhập API key
- "API error: 403" → API key sai hoặc hết quota
- "API error: 429" → Quá nhiều requests, đợi 1 phút
- Trang không thay đổi → Có thể trang dùng JavaScript render động

## Performance Tips

### Trang nhỏ (< 100 đoạn văn)
- Dịch nhanh: 5-15 giây
- Ít lỗi

### Trang trung bình (100-500 đoạn văn)
- Dịch mất: 30-60 giây
- Có thể bị rate limit

### Trang lớn (> 500 đoạn văn)
- Nên dịch từng phần bằng cách chọn văn bản
- Hoặc tăng BATCH_SIZE trong config.js

## Debug Mode

Nếu gặp lỗi, mở Console để xem logs:
```
1. F12 → Console tab
2. Lọc theo: "gemini" hoặc "translation"
3. Xem error messages
```

## Các tình huống đặc biệt

### Trang SPA (Single Page Application)
- Trang load bằng AJAX/React/Vue
- Extension chỉ dịch nội dung ban đầu
- Cần reload page để dịch nội dung mới

### Trang có iframe
- Iframe không được dịch (giới hạn bảo mật)
- Chỉ dịch content trong main page

### Trang có video/audio
- Không dịch được subtitle tự động
- Chỉ dịch text descriptions

## Video Demo Script

Muốn record video demo? Làm theo script này:

```
1. [0:00-0:10] Giới thiệu extension
   "Xin chào, hôm nay mình demo extension dịch web sang tiếng Việt"

2. [0:10-0:30] Cài đặt
   - Mở edge://extensions/
   - Load unpacked
   - Chọn thư mục

3. [0:30-0:50] Cấu hình API key
   - Click icon extension
   - Paste API key
   - Save

4. [0:50-1:30] Demo dịch văn bản
   - Mở Wikipedia
   - Chọn text
   - Right click → Translate
   - Show popup result

5. [1:30-2:30] Demo dịch toàn trang
   - Right click → Translate page
   - Show loading
   - Show result
   - Restore original

6. [2:30-3:00] Kết thúc
   "Extension hoàn toàn free, các bạn có thể customize code"
```

## Screenshots để document

Chụp các màn hình sau:
1. Extension popup với API key form
2. Context menu với 2 options
3. Translation popup hiển thị kết quả
4. Before/After dịch trang
5. Loading indicator
6. Notification success
