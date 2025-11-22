# 📸 VISUAL INSTALLATION GUIDE

## Hướng dẫn cài đặt có hình ảnh mô tả

---

## PHẦN 1: LẤY GEMINI API KEY

### Bước 1.1: Truy cập Google AI Studio
```
URL: https://makersuite.google.com/app/apikey
```

**Màn hình hiện ra:**
- Tiêu đề: "Get an API Key"
- Nút xanh: "Create API Key"
- Dropdown: Chọn project

### Bước 1.2: Đăng nhập Google
```
- Nếu chưa đăng nhập, sẽ có popup Google Login
- Nhập email và password
- Cho phép quyền truy cập
```

### Bước 1.3: Tạo API Key
```
1. Click nút "Create API Key"
2. Hoặc "Create API Key in new project" nếu chưa có project
3. Đợi vài giây
```

**Kết quả:**
```
API key được hiển thị (dạng):
AIzaSyC-xxxxxxxxxxxxxxxxxxxxxxxxxxxx

[Copy] button bên cạnh
```

### Bước 1.4: Copy và lưu lại
```
✓ Click nút "Copy"
✓ Dán vào Notepad tạm để lưu
✓ QUAN TRỌNG: Giữ kín API key này!
```

---

## PHẦN 2: CÀI ĐẶT EXTENSION VÀO EDGE

### Bước 2.1: Mở Extensions Page
```
Cách 1: Gõ vào address bar: edge://extensions/
Cách 2: Menu (⋯) → Extensions → Manage Extensions
```

**Màn hình Extensions:**
```
┌─────────────────────────────────────────────────┐
│ Extensions                                       │
│                                                  │
│ [Search extensions]                              │
│                                                  │
│ Developer mode                          [OFF/ON] │
│                                                  │
│ [ Load unpacked ] [ Pack extension ]             │
│                                                  │
│ Installed extensions:                            │
│ (danh sách extensions đã cài)                    │
└─────────────────────────────────────────────────┘
```

### Bước 2.2: Bật Developer Mode
```
1. Tìm toggle "Developer mode" ở góc dưới bên trái
2. Click để chuyển sang ON (màu xanh)
```

**Sau khi bật:**
```
- Xuất hiện thêm các nút:
  • Load unpacked
  • Pack extension
  • Update
```

### Bước 2.3: Load Extension
```
1. Click nút "Load unpacked"
2. File Explorer mở ra
3. Navigate đến: C:\Users\acer\Desktop\extension
4. Click "Select Folder"
```

**Kết quả:**
```
┌─────────────────────────────────────────────────┐
│ 🟣 Gemini Translator - Vietnamese       [ON]    │
│    ID: abcdefghijklmnopqrstuvwxyz              │
│    Version: 1.0.0                               │
│    Dịch trang web sang tiếng Việt bằng Gemini  │
│                                                  │
│    [Details] [Remove] [Errors]                  │
└─────────────────────────────────────────────────┘
```

### Bước 2.4: Pin Extension (Optional)
```
1. Click icon puzzle (Extensions) trên toolbar
2. Tìm "Gemini Translator"
3. Click icon pin (📌) để ghim lên toolbar
```

**Kết quả:**
- Icon màu tím với chữ "VI" xuất hiện trên toolbar

---

## PHẦN 3: CẤU HÌNH API KEY

### Bước 3.1: Mở Popup Extension
```
Click vào icon extension (màu tím) trên toolbar
```

**Popup hiển thị:**
```
┌─────────────────────────────────────────────┐
│  🌐 Gemini Translator                       │
│     Dịch sang Tiếng Việt                    │
├─────────────────────────────────────────────┤
│                                             │
│  Gemini API Key:                            │
│  [_________________________________]        │
│  [        Lưu API Key         ]             │
│                                             │
│  Lấy API key miễn phí tại: Google AI Studio│
│                                             │
├─────────────────────────────────────────────┤
│  Cách sử dụng:                              │
│  • Dịch toàn trang: Click chuột phải...     │
│  • Dịch văn bản: Chọn text → Click...       │
│  • Khôi phục: Click lại "Dịch trang..."     │
├─────────────────────────────────────────────┤
│  [    Dịch Trang Hiện Tại    ]              │
│  [      Khôi Phục Gốc        ]              │
├─────────────────────────────────────────────┤
│  Phiên bản 1.0.0                            │
└─────────────────────────────────────────────┘
```

### Bước 3.2: Nhập API Key
```
1. Click vào ô "Gemini API Key"
2. Paste API key (Ctrl+V)
3. API key sẽ hiển thị dạng: •••••••••••
```

### Bước 3.3: Lưu API Key
```
1. Click nút "Lưu API Key" (màu xanh)
2. Đợi 1 giây
```

**Thông báo thành công:**
```
┌─────────────────────────────────────────────┐
│ ✓ Đã lưu API key thành công!                │
└─────────────────────────────────────────────┘
(Hiển thị 3 giây rồi tự động ẩn)
```

---

## PHẦN 4: TEST EXTENSION

### Test 1: Dịch Văn Bản Được Chọn

#### Bước 4.1: Mở trang test
```
URL: https://en.wikipedia.org/wiki/Vietnam
```

#### Bước 4.2: Chọn văn bản
```
Chọn (bôi đen) đoạn text:
"Vietnam, officially the Socialist Republic of Vietnam..."
```

#### Bước 4.3: Context Menu
```
1. Click chuột phải trên text đã chọn
2. Menu hiện ra với options:
   - Cut
   - Copy
   - Paste
   ...
   - Dịch văn bản đã chọn ← Click vào đây
   - Dịch trang này sang tiếng Việt
```

#### Bước 4.4: Xem kết quả
```
Popup dịch hiển thị:
┌─────────────────────────────────────────────┐
│ Bản dịch                              [×]   │
├─────────────────────────────────────────────┤
│ Gốc:                                        │
│ Vietnam, officially the Socialist           │
│ Republic of Vietnam...                      │
│                                             │
│ Tiếng Việt:                                 │
│ Việt Nam, tên chính thức là Cộng hòa        │
│ Xã hội chủ nghĩa Việt Nam...                │
└─────────────────────────────────────────────┘
```

---

### Test 2: Dịch Toàn Trang

#### Bước 4.5: Context Menu
```
1. Click chuột phải bất kỳ đâu trên trang
2. Chọn "Dịch trang này sang tiếng Việt"
```

#### Bước 4.6: Loading
```
Loading indicator xuất hiện giữa màn hình:
┌─────────────────────────────────────────────┐
│         ⟳ Đang dịch...                      │
└─────────────────────────────────────────────┘
(spinner animation)
```

#### Bước 4.7: Quá trình dịch
```
- Extension dịch từng đoạn văn
- Văn bản dần dần chuyển sang tiếng Việt
- Có thể thấy text thay đổi real-time
- Thời gian: 5-30 giây tùy độ dài trang
```

#### Bước 4.8: Hoàn tất
```
Notification góc phải trên:
┌─────────────────────────────────────────────┐
│ ✓ Đã dịch trang thành công!                 │
└─────────────────────────────────────────────┘
(Hiển thị 3 giây)
```

**Kết quả:**
- Toàn bộ text trên trang đã chuyển sang tiếng Việt
- Layout, images, links vẫn giữ nguyên
- Trang vẫn scroll và click được bình thường

---

### Test 3: Khôi Phục Trang Gốc

#### Bước 4.9: Khôi phục
```
Cách 1: 
- Click chuột phải → "Dịch trang này..." (lần 2)

Cách 2:
- Click icon extension
- Click nút "Khôi Phục Gốc"
```

**Kết quả:**
```
Notification:
┌─────────────────────────────────────────────┐
│ ✓ Đã khôi phục nội dung gốc                 │
└─────────────────────────────────────────────┘

Trang trở về tiếng Anh ban đầu
```

---

## PHẦN 5: XỬ LÝ LỖI

### Lỗi 1: "API key chưa được cấu hình"

**Màn hình:**
```
Notification đỏ:
┌─────────────────────────────────────────────┐
│ ⚠ API key chưa được cấu hình. Vui lòng thêm │
│   Gemini API key trong popup extension      │
└─────────────────────────────────────────────┘
```

**Giải quyết:**
- Quay lại PHẦN 3 để cấu hình API key

---

### Lỗi 2: "API error: 403"

**Màn hình:**
```
Notification đỏ:
┌─────────────────────────────────────────────┐
│ ⚠ Lỗi: API error: 403 Forbidden             │
└─────────────────────────────────────────────┘
```

**Nguyên nhân:**
- API key không đúng
- API key bị vô hiệu hóa
- Chưa enable Gemini API

**Giải quyết:**
1. Kiểm tra lại API key
2. Tạo API key mới
3. Paste lại vào extension

---

### Lỗi 3: "API error: 429"

**Màn hình:**
```
Notification đỏ:
┌─────────────────────────────────────────────┐
│ ⚠ Lỗi: API error: 429 Too Many Requests     │
└─────────────────────────────────────────────┘
```

**Nguyên nhân:**
- Quá nhiều requests trong thời gian ngắn
- Vượt quá rate limit của API

**Giải quyết:**
- Đợi 1-2 phút
- Thử lại

---

### Lỗi 4: Extension không hiển thị

**Kiểm tra:**
```
1. edge://extensions/
2. Tìm "Gemini Translator"
3. Toggle phải ở trạng thái ON (màu xanh)
```

**Nếu extension bị tắt:**
- Click toggle để BẬT lại

**Nếu không thấy extension:**
- Reload lại: Click nút "Update" trên trang extensions
- Hoặc: Remove và Load unpacked lại

---

## PHẦN 6: TIPS & TRICKS

### Tip 1: Shortcut nhanh
```
Thay vì click chuột phải:
- Pin extension lên toolbar
- Click icon → "Dịch Trang Hiện Tại"
```

### Tip 2: Dịch nhiều tab
```
Extension hoạt động độc lập trên mỗi tab:
- Tab 1: Dịch Wikipedia
- Tab 2: Dịch BBC News
- Tab 3: Dịch CNN
Không ảnh hưởng lẫn nhau!
```

### Tip 3: Tăng tốc độ dịch
```
Mở file: config.js
Thay đổi:
  BATCH_SIZE: 10 → 20 (dịch nhiều hơn mỗi lần)
  DELAY_BETWEEN_TRANSLATIONS: 100 → 50 (delay ít hơn)

⚠️ Cẩn thận: Có thể bị rate limit!
```

### Tip 4: Chỉ dịch phần cần thiết
```
Thay vì dịch toàn trang:
1. Chọn đoạn văn cần dịch
2. Right click → "Dịch văn bản đã chọn"
3. Nhanh hơn và tiết kiệm API quota
```

---

## CHECKLIST HOÀN TẤT

Tick vào các ô khi hoàn thành:

**Cài đặt:**
- [ ] Đã lấy Gemini API key
- [ ] Đã cài extension vào Edge
- [ ] Extension hiển thị trên toolbar
- [ ] Đã paste và lưu API key

**Test:**
- [ ] Test dịch văn bản thành công
- [ ] Test dịch toàn trang thành công
- [ ] Test khôi phục trang thành công
- [ ] Context menu hiển thị đúng

**Xác nhận:**
- [ ] Không có lỗi trong Console (F12)
- [ ] Notification hiển thị đúng
- [ ] Loading indicator hoạt động
- [ ] Popup mở được

---

## HOÀN TẤT! 🎉

Bạn đã cài đặt thành công extension!

**Bây giờ bạn có thể:**
✓ Dịch bất kỳ trang web nào sang tiếng Việt
✓ Dịch nhanh văn bản được chọn
✓ Khôi phục trang gốc dễ dàng

**Chúc bạn sử dụng vui vẻ! 🚀**

---

Need help? Check:
- README.md - Full documentation
- DEMO_TEST.md - Testing guide
- SUMMARY.md - Project overview
