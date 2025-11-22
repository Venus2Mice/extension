# 🌐 Gemini Translator - Vietnamese

Extension trình duyệt Microsoft Edge để dịch trang web sang Tiếng Việt sử dụng Gemini AI API.

## ✨ Tính năng

- **Dịch toàn bộ trang web** từ bất kỳ ngôn ngữ nào sang Tiếng Việt
- **Dịch văn bản được chọn** với popup hiển thị kết quả
- **Menu chuột phải** tích hợp để dễ dàng sử dụng
- **Khôi phục nội dung gốc** với một click
- **Cache thông minh** để tránh dịch lại cùng một nội dung
- **Giao diện đẹp mắt** với loading indicator và notifications

## 🚀 Cài đặt

### Bước 1: Lấy Gemini API Key (Miễn phí)

1. Truy cập [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Đăng nhập bằng tài khoản Google
3. Click "Create API Key"
4. Sao chép API key

### Bước 2: Tạo icons cho extension

1. Mở file `icons/generate-icons.html` trong trình duyệt
2. File sẽ tự động tạo và tải xuống 3 file icons: `icon16.png`, `icon48.png`, `icon128.png`
3. Lưu các file icons vào thư mục `icons/`

### Bước 3: Cài đặt Extension vào Edge

1. Mở Microsoft Edge
2. Vào `edge://extensions/`
3. Bật "Developer mode" (ở góc dưới bên trái)
4. Click "Load unpacked"
5. Chọn thư mục `extension`
6. Extension sẽ xuất hiện trong thanh công cụ

### Bước 4: Cấu hình API Key

1. Click vào icon extension trên thanh công cụ
2. Dán Gemini API Key vào ô "Gemini API Key"
3. Click "Lưu API Key"

## 📖 Cách sử dụng

### Dịch toàn bộ trang web

**Cách 1:** Sử dụng context menu
1. Click chuột phải trên bất kỳ đâu trên trang
2. Chọn "Dịch trang này sang tiếng Việt"
3. Đợi quá trình dịch hoàn tất

**Cách 2:** Sử dụng popup
1. Click vào icon extension
2. Click nút "Dịch Trang Hiện Tại"

### Dịch văn bản được chọn

1. Chọn (bôi đen) văn bản cần dịch
2. Click chuột phải
3. Chọn "Dịch văn bản đã chọn"
4. Popup hiển thị bản dịch sẽ xuất hiện

### Khôi phục nội dung gốc

**Cách 1:** Click lại "Dịch trang này sang tiếng Việt" trong context menu

**Cách 2:** 
1. Click vào icon extension
2. Click nút "Khôi Phục Gốc"

## 🛠️ Cấu trúc dự án

```
extension/
├── manifest.json          # Cấu hình extension
├── background.js          # Service worker xử lý background tasks
├── content.js            # Script inject vào trang web
├── content.css           # Styles cho các thành phần trên trang
├── popup.html            # Giao diện popup
├── popup.js              # Logic cho popup
├── popup.css             # Styles cho popup
├── icons/                # Thư mục chứa icons
│   ├── icon16.png
│   ├── icon48.png
│   ├── icon128.png
│   └── generate-icons.html
└── README.md            # File hướng dẫn này
```

## 🔧 Kỹ thuật sử dụng

- **Manifest V3:** Chuẩn mới nhất cho Chrome/Edge extensions
- **Gemini Pro API:** Model AI mạnh mẽ của Google
- **Content Scripts:** Inject code vào trang web
- **Chrome Storage API:** Lưu trữ API key an toàn
- **Context Menus API:** Tích hợp menu chuột phải
- **TreeWalker API:** Duyệt qua tất cả text nodes hiệu quả

## ⚠️ Lưu ý

- API key được lưu trữ local trên máy tính của bạn
- Extension hoạt động offline sau khi tải trang (chỉ cần internet để gọi API)
- Gemini API có giới hạn rate limiting, nên dịch từng batch nhỏ
- Một số trang web có thể block extension do CSP policy

## 🐛 Xử lý lỗi thường gặp

### "API key chưa được cấu hình"
→ Bạn cần nhập API key trong popup extension

### "API error: 403"
→ API key không hợp lệ hoặc đã hết quota

### "API error: 429"
→ Vượt quá giới hạn requests, đợi một chút rồi thử lại

### Extension không hoạt động trên một số trang
→ Một số trang có security policy nghiêm ngặt, thử tải lại trang

## 📝 Phát triển thêm

Một số ý tưởng để cải thiện:

- [ ] Thêm lựa chọn ngôn ngữ đích khác (không chỉ Tiếng Việt)
- [ ] Auto-detect ngôn ngữ nguồn
- [ ] Lưu lịch sử dịch
- [ ] Dịch nội dung dynamic (AJAX)
- [ ] Hỗ trợ dịch hình ảnh (OCR + translate)
- [ ] Shortcuts keyboard
- [ ] Dịch subtitle video

## 📄 License

MIT License - Tự do sử dụng và chỉnh sửa theo ý muốn.

## 🤝 Đóng góp

Mọi đóng góp đều được hoan nghênh! Feel free to open issues hoặc pull requests.

---

**Tác giả:** AI Assistant  
**Phiên bản:** 1.0.0  
**Ngày tạo:** November 23, 2025
