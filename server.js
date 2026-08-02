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

    // Bảng lưu thông tin báo cơm (Trưa và Tối)
    db.run(`CREATE TABLE IF NOT EXISTS meal_registrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT,
        date TEXT,
        trua INTEGER DEFAULT 0,
        toi INTEGER DEFAULT 0,
        createdAt TEXT
    )`);

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

// API Đổi mật khẩu
app.post('/api/change-password', (req, res) => {
    const { username, oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
        return res.json({ success: false, message: 'Vui lòng nhập đầy đủ thông tin!' });
    }

    db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, [username, oldPassword], (err, user) => {
        if (!user) {
            return res.json({ success: false, message: 'Mật khẩu cũ không chính xác!' });
        }

        db.run(`UPDATE users SET password = ? WHERE username = ?`, [newPassword, username], (err) => {
            if (err) return res.json({ success: false, message: 'Lỗi khi cập nhật mật khẩu!' });
            res.json({ success: true, message: 'Đổi mật khẩu thành công!' });
        });
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

// API Lấy dữ liệu báo cơm đã đăng ký của 1 tài khoản theo ngày
app.get('/api/get-user-meal', (req, res) => {
    const { username, date } = req.query;
    db.get(`SELECT * FROM meal_registrations WHERE username = ? AND date = ?`, [username, date], (err, row) => {
        if (row) {
            res.json({ success: true, trua: Boolean(row.trua), toi: Boolean(row.toi) });
        } else {
            res.json({ success: true, trua: false, toi: false });
        }
    });
});

// Thành viên Báo cơm
app.post('/api/register-meal', (req, res) => {
    const { username, date, trua, toi } = req.body;

    const now = new Date();
    const nowLocalDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    if (date < nowLocalDateStr) {
        return res.json({ success: false, message: 'Không thể báo cơm cho các ngày đã qua!' });
    }

    if (date === nowLocalDateStr) {
        const currentHour = now.getHours();
        if (trua && currentHour >= 8) {
            return res.json({ success: false, message: 'Đã quá 08:00 sáng! Bạn không thể báo/sửa cơm trưa hôm nay.' });
        }
        if (toi && currentHour >= 15) {
            return res.json({ success: false, message: 'Đã quá 15:00 chiều! Bạn không thể báo/sửa cơm tối hôm nay.' });
        }
    }

    db.run(`DELETE FROM meal_registrations WHERE username = ? AND date = ?`, [username, date], (err) => {
        db.run(
            `INSERT INTO meal_registrations (username, date, trua, toi, createdAt) VALUES (?, ?, ?, ?, ?)`,
            [username, date, trua ? 1 : 0, toi ? 1 : 0, new Date().toISOString()],
            (err) => {
                if (err) return res.json({ success: false, message: 'Lưu báo cơm thất bại!' });
                res.json({ success: true, message: 'Báo cơm thành công rồi nha' });
            }
        );
    });
});

// Thống kê chi tiết từng lượt đăng ký
app.get('/api/meals', (req, res) => {
    db.all(`SELECT * FROM meal_registrations ORDER BY date DESC`, [], (err, rows) => {
        const meals = rows.map(m => ({
            ...m,
            trua: Boolean(m.trua),
            toi: Boolean(m.toi)
        }));
        res.json(meals);
    });
});

// API 1: Thống kê tổng số suất ăn theo từng ngày (Trưa, Tối)
app.get('/api/stats/daily', (req, res) => {
    const query = `
        SELECT 
            date,
            SUM(trua) as total_trua,
            SUM(toi) as total_toi,
            (SUM(trua) + SUM(toi)) as total_day
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
            SUM(m.trua) as total_trua,
            SUM(m.toi) as total_toi,
            (SUM(m.trua) + SUM(m.toi)) as grand_total
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

// YÊU CẦU 4: API TRÍCH XUẤT SỐ LIỆU BÁO CƠM THEO TÀI KHOẢN (XUẤT CHI TIẾT NGÀY/TUẦN/THÁNG)
app.get('/api/export/user-meals', (req, res) => {
    const { username, fromDate, toDate } = req.query;

    if (!username) {
        return res.status(400).json({ success: false, message: 'Thiếu tên tài khoản!' });
    }

    let query = `
        SELECT 
            m.date, 
            m.trua, 
            m.toi,
            u.name
        FROM meal_registrations m
        LEFT JOIN users u ON m.username = u.username
        WHERE m.username = ?
    `;
    const params = [username];

    if (fromDate) {
        query += ` AND m.date >= ?`;
        params.push(fromDate);
    }
    if (toDate) {
        query += ` AND m.date <= ?`;
        params.push(toDate);
    }

    query += ` ORDER BY m.date DESC`;

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, data: rows });
    });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});