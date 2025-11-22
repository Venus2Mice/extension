# 🔧 SỬA LỖI "Could not establish connection"

## ✅ Đã sửa!

Lỗi này xảy ra vì content script chưa được load vào trang web khi extension cố gắng gửi message.

### Các thay đổi đã thực hiện:

1. **background.js**: Thêm hàm `ensureContentScript()` để kiểm tra và inject content script nếu cần
2. **content.js**: Thêm handler cho message 'ping' để kiểm tra xem script đã load chưa
3. **popup.js**: Thêm hàm `ensureContentScript()` để inject script trước khi gửi message

### 🔄 Cách reload extension:

**Bước 1: Mở Extensions Page**
```
edge://extensions/
```

**Bước 2: Reload Extension**
```
Tìm "Gemini Translator - Vietnamese"
Click nút "⟳" (Reload) hoặc tắt/bật toggle
```

**Bước 3: Reload trang web**
```
Nhấn F5 trên trang web bạn muốn dịch
```

### 🧪 Test lại:

1. Mở một trang web (ví dụ: https://en.wikipedia.org)
2. Click chuột phải → "Dịch trang này sang tiếng Việt"
3. Extension sẽ tự động inject content script và dịch trang

### ⚡ Extension giờ sẽ:

✅ Tự động kiểm tra content script đã load chưa
✅ Inject content script nếu cần thiết
✅ Không còn lỗi "Could not establish connection"
✅ Hoạt động ngay cả khi trang đã load trước khi cài extension

### 🎯 Lưu ý:

- Extension sẽ tự động inject script vào trang khi cần
- Không cần phải reload trang trước khi sử dụng
- Hoạt động với cả trang đã mở và trang mới

**Thử lại và cho tôi biết nếu còn vấn đề gì! 🚀**
