const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

// Cơ sở dữ liệu mẫu
let users = [
    { username: 'admin', password: '123', role: 'admin', name: 'Quản trị viên' }
];

let mealRegistrations = []; // Danh sách báo cơm

// Đăng nhập
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username && u.password === password);
    if (user) {
        res.json({ success: true, user: { username: user.username, name: user.name, role: user.role } });
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
    users.push({ username, password: '123456', role: 'user', name });
    res.json({ success: true, message: `Tạo tài khoản ${username} thành công! Mật khẩu: 123456` });
});

// Thành viên báo cơm (Chỉ Trưa & Tối + Lịch Trực)
app.post('/api/register-meal', (req, res) => {
    const { username, date, trua, toi, isLichTruc } = req.body;
    
    // Xóa đăng ký cũ của ngày đó (nếu có) để cập nhật mới
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

// Lấy danh sách báo cơm
app.get('/api/meals', (req, res) => {
    res.json(mealRegistrations);
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});