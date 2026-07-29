const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

// Cơ sở dữ liệu mẫu (thêm trường canViewStats)
let users = [
    { username: 'admin', password: '123', role: 'admin', name: 'Quản trị viên', canViewStats: true },
    { username: 'user1', password: '123', role: 'user', name: 'Nguyễn Văn A', canViewStats: false }
];

let mealRegistrations = []; // Danh sách báo cơm

// Đăng nhập
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username && u.password === password);
    if (user) {
        res.json({ 
            success: true, 
            user: { 
                username: user.username, 
                name: user.name, 
                role: user.role,
                canViewStats: user.canViewStats || user.role === 'admin'
            } 
        });
    } else {
        res.json({ success: false, message: 'Tên đăng nhập hoặc mật khẩu không đúng!' });
    }
});

// Admin tạo tài khoản mới (Mật khẩu mặc định 123456)
app.post('/api/admin/create-user', (req, res) => {
    const { username, name } = req.body;
    if (users.some(u => u.username === username)) {
        return res.json({ success: false, message: 'Tên đăng nhập đã tồn tại!' });
    }
    users.push({ username, password: '123456', role: 'user', name, canViewStats: false });
    res.json({ success: true, message: `Tạo tài khoản ${username} thành công! Mật khẩu: 123456` });
});

// Admin lấy danh sách user để quản lý quyền
app.get('/api/admin/users', (req, res) => {
    const userList = users.map(u => ({ username: u.username, name: u.name, role: u.role, canViewStats: !!u.canViewStats }));
    res.json(userList);
});

// Admin cập nhật quyền xem thống kê
app.post('/api/admin/toggle-stats-permission', (req, res) => {
    const { username, canViewStats } = req.body;
    const user = users.find(u => u.username === username);
    if (user) {
        user.canViewStats = canViewStats;
        return res.json({ success: true, message: 'Cập nhật quyền thành công!' });
    }
    res.json({ success: false, message: 'Không tìm thấy người dùng!' });
});

// Thành viên báo cơm (Kiểm tra giới hạn thời gian)
app.post('/api/register-meal', (req, res) => {
    const { username, date, trua, toi, isLichTruc } = req.body;

    const now = new Date();
    // Chuyển đổi ngày đăng ký sang định dạng YYYY-MM-DD theo giờ địa phương
    const nowLocalDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    // Kiểm tra thời gian nếu đăng ký cơm cho ngày HÔM NAY hoặc NGÀY TRONG QUÁ KHỨ
    if (date < nowLocalDateStr) {
        return res.json({ success: false, message: 'Không thể báo cơm cho các ngày đã qua!' });
    }

    if (date === nowLocalDateStr) {
        const currentHour = now.getHours();

        // Cơm trưa: Không được báo sau 8h sáng
        if (trua && currentHour >= 8) {
            return res.json({ success: false, message: 'Đã quá 08:00 sáng! Bạn không thể báo/sửa cơm trưa hôm nay.' });
        }

        // Cơm tối: Không được báo sau 15h (3h chiều)
        if (toi && currentHour >= 15) {
            return res.json({ success: false, message: 'Đã quá 15:00 chiều! Bạn không thể báo/sửa cơm tối hôm nay.' });
        }
    }

    // Xóa đăng ký cũ của ngày đó để cập nhật mới
    mealRegistrations = mealRegistrations.filter(m => !(m.username === username && m.date === date));
    
    mealRegistrations.push({
        username,
        date,
        trua: !!trua,
        toi: !!toi,
        isLichTruc: !!isLichTruc,
        createdAt: new Date().toISOString()
    });

    res.json({ success: true, message: 'Đăng ký báo cơm thành công!' });
});

// Lấy danh sách/thống kê báo cơm
app.get('/api/meals', (req, res) => {
    res.json(mealRegistrations);
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});