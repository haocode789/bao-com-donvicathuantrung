const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

// 1. KẾT NỐI DATABASE SQLITE
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) console.error('Lỗi kết nối CSDL:', err.message);
    else console.log('Đã kết nối cơ sở dữ liệu SQLite thành công!');
});

// 2. KHỞI TẠO BẢNG DỮ LIỆU
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        password TEXT,
        role TEXT,
        name TEXT,
        canViewStats INTEGER
    )`);

    // Bổ sung trường sang (sáng) vào bảng meal_registrations
    db.run(`CREATE TABLE IF NOT EXISTS meal_registrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT,
        date TEXT,
        sang INTEGER DEFAULT 0,
        trua INTEGER DEFAULT 0,
        toi INTEGER DEFAULT 0,
        createdAt TEXT
    )`);

    // Cập nhật cấu trúc bảng nếu đã tồn tại bảng cũ chưa có trường sang
    db.run(`ALTER TABLE meal_registrations ADD COLUMN sang INTEGER DEFAULT 0`, (err) => {});

    db.get(`SELECT * FROM users WHERE username = 'admin'`, (err, row) => {
        if (!row) {
            db.run(`INSERT INTO users VALUES ('admin', '123', 'admin', 'Quản trị viên', 1)`);
            db.run(`INSERT INTO users VALUES ('user1', '123', 'user', 'Nguyễn Văn A', 0)`);
        }
    });
});

// --- CÁC API ---

// Đăng nhập
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, [username, password], (err, user) => {
        if (user) {
            res.json({ 
                success: true, 
                user: { 
                    username: user.username, 
                    name: user.name, 
                    role: user.role,
                    canViewStats: Boolean(user.canViewStats) || user.role === 'admin'
                } 
            });
        } else {
            res.json({ success: false, message: 'Tên đăng nhập hoặc mật khẩu không đúng!' });
        }
    });
});

// Admin tạo tài khoản
app.post('/api/admin/create-user', (req, res) => {
    const { username, name } = req.body;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, row) => {
        if (row) return res.json({ success: false, message: 'Tên đăng nhập đã tồn tại!' });
        
        db.run(`INSERT INTO users VALUES (?, '123456', 'user', ?, 0)`, [username, name], (err) => {
            if (err) return res.json({ success: false, message: 'Lỗi khi tạo tài khoản!' });
            res.json({ success: true, message: `Tạo tài khoản ${username} thành công! Mật khẩu: 123456` });
        });
    });
});

// Admin lấy danh sách user
app.get('/api/admin/users', (req, res) => {
    db.all(`SELECT username, name, role, canViewStats FROM users`, [], (err, rows) => {
        const userList = rows.map(u => ({ ...u, canViewStats: Boolean(u.canViewStats) }));
        res.json(userList);
    });
});

// Admin cập nhật quyền
app.post('/api/admin/toggle-stats-permission', (req, res) => {
    const { username, canViewStats } = req.body;
    db.run(`UPDATE users SET canViewStats = ? WHERE username = ?`, [canViewStats ? 1 : 0, username], (err) => {
        if (err) return res.json({ success: false, message: 'Cập nhật thất bại!' });
        res.json({ success: true, message: 'Cập nhật quyền thành công!' });
    });
});

// Thành viên Báo cơm
app.post('/api/register-meal', (req, res) => {
    const { username, date, sang, trua, toi } = req.body;

    const now = new Date();
    const nowLocalDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    if (date < nowLocalDateStr) {
        return res.json({ success: false, message: 'Không thể báo cơm cho các ngày đã qua!' });
    }

    if (date === nowLocalDateStr) {
        const currentHour = now.getHours();
        if (sang && currentHour >= 6) {
            return res.json({ success: false, message: 'Đã quá 06:00 sáng! Bạn không thể báo/sửa cơm sáng hôm nay.' });
        }
        if (trua && currentHour >= 8) {
            return res.json({ success: false, message: 'Đã quá 08:00 sáng! Bạn không thể báo/sửa cơm trưa hôm nay.' });
        }
        if (toi && currentHour >= 15) {
            return res.json({ success: false, message: 'Đã quá 15:00 chiều! Bạn không thể báo/sửa cơm tối hôm nay.' });
        }
    }

    db.run(`DELETE FROM meal_registrations WHERE username = ? AND date = ?`, [username, date], (err) => {
        db.run(
            `INSERT INTO meal_registrations (username, date, sang, trua, toi, createdAt) VALUES (?, ?, ?, ?, ?, ?)`,
            [username, date, sang ? 1 : 0, trua ? 1 : 0, toi ? 1 : 0, new Date().toISOString()],
            (err) => {
                if (err) return res.json({ success: false, message: 'Lưu báo cơm thất bại!' });
                res.json({ success: true, message: 'Đăng ký báo cơm thành công!' });
            }
        );
    });
});

// Thống kê chi tiết từng lượt đăng ký
app.get('/api/meals', (req, res) => {
    db.all(`SELECT * FROM meal_registrations ORDER BY date DESC`, [], (err, rows) => {
        const meals = rows.map(m => ({
            ...m,
            sang: Boolean(m.sang),
            trua: Boolean(m.trua),
            toi: Boolean(m.toi)
        }));
        res.json(meals);
    });
});

// API 1: Thống kê tổng số suất ăn theo từng ngày (Sáng, Trưa, Tối) của toàn đơn vị
app.get('/api/stats/daily', (req, res) => {
    const query = `
        SELECT 
            date,
            SUM(sang) as total_sang,
            SUM(trua) as total_trua,
            SUM(toi) as total_toi,
            (SUM(sang) + SUM(trua) + SUM(toi)) as total_day
        FROM meal_registrations
        GROUP BY date
        ORDER BY date DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json(rows);
    });
});

// API 2: Tra cứu & thống kê tổng số suất ăn theo khoảng thời gian của từng tài khoản
app.get('/api/stats/user-range', (req, res) => {
    const { fromDate, toDate, username } = req.query;
    
    let query = `
        SELECT 
            m.username,
            u.name,
            SUM(m.sang) as total_sang,
            SUM(m.trua) as total_trua,
            SUM(m.toi) as total_toi,
            (SUM(m.sang) + SUM(m.trua) + SUM(m.toi)) as grand_total
        FROM meal_registrations m
        LEFT JOIN users u ON m.username = u.username
        WHERE 1=1
    `;
    const params = [];

    if (fromDate) {
        query += ` AND m.date >= ?`;
        params.push(fromDate);
    }
    if (toDate) {
        query += ` AND m.date <= ?`;
        params.push(toDate);
    }
    if (username) {
        query += ` AND m.username = ?`;
        params.push(username);
    }

    query += ` GROUP BY m.username ORDER BY grand_total DESC`;

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json(rows);
    });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});