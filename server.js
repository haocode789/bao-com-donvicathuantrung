const express = require('express');
const { createClient } = require('@libsql/client');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

// KIỂM TRA BIẾN MÔI TRƯỜNG TURSO TRƯỚC KHI KHỞI CHẠY
if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
  console.error('❌ LỖI NGHIÊM TRỌNG: Chưa cấu hình TURSO_DATABASE_URL hoặc TURSO_AUTH_TOKEN trong Environment Variables!');
  process.exit(1); // Dừng ngay ứng dụng để phát hiện lỗi lập tức
}

// 1. KẾT NỐI DATABASE TURSO
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

// 2. KHỞI TẠO BẢNG DỮ LIỆU BẰNG ASYNC/AWAIT
async function initDB() {
    try {
        await db.execute(`
            CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY,
                password TEXT,
                role TEXT,
                name TEXT,
                canViewStats INTEGER
            )
        `);

        await db.execute(`
            CREATE TABLE IF NOT EXISTS meal_registrations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT,
                date TEXT,
                trua INTEGER DEFAULT 0,
                toi INTEGER DEFAULT 0,
                createdAt TEXT
            )
        `);

        // Kiểm tra và khởi tạo tài khoản mặc định
        const adminCheck = await db.execute({
            sql: `SELECT * FROM users WHERE username = 'admin'`,
            args: []
        });

        if (adminCheck.rows.length === 0) {
            await db.execute({
                sql: `INSERT INTO users VALUES ('admin', '123', 'admin', 'Quản trị viên', 1)`,
                args: []
            });
            await db.execute({
                sql: `INSERT INTO users VALUES ('user1', '123', 'user', 'Nguyễn Văn A', 0)`,
                args: []
            });
            console.log('✅ Khởi tạo tài khoản mặc định thành công trên Turso!');
        }

        console.log('🚀 Đã kết nối và đồng bộ cơ sở dữ liệu Turso thành công!');
    } catch (err) {
        console.error('❌ Lỗi kết nối/khởi tạo CSDL Turso:', err.message);
        process.exit(1); // BẮT BUỘC DỪNG SERVER ĐỂ PHÁT HIỆN LỖI TRÊN DEPLOY LOGS
    }
}
initDB();

// API Health Check cho dịch vụ Ping (chống sleep server) & Kiểm tra kết nối Turso
app.get('/api/health', async (req, res) => {
    try {
        await db.execute('SELECT 1');
        res.json({ status: 'OK', database: 'Connected to Turso Cloud' });
    } catch (err) {
        res.status(500).json({ status: 'ERROR', message: err.message });
    }
});

// --- CÁC API KHÁC (GIỮ NGUYÊN) ---

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await db.execute({
            sql: `SELECT * FROM users WHERE username = ? AND password = ?`,
            args: [username, password]
        });

        if (result.rows.length > 0) {
            const user = result.rows[0];
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
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/change-password', async (req, res) => {
    const { username, oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
        return res.json({ success: false, message: 'Vui lòng nhập đầy đủ thông tin!' });
    }

    try {
        const result = await db.execute({
            sql: `SELECT * FROM users WHERE username = ? AND password = ?`,
            args: [username, oldPassword]
        });

        if (result.rows.length === 0) {
            return res.json({ success: false, message: 'Mật khẩu cũ không chính xác!' });
        }

        await db.execute({
            sql: `UPDATE users SET password = ? WHERE username = ?`,
            args: [newPassword, username]
        });

        res.json({ success: true, message: 'Đổi mật khẩu thành công!' });
    } catch (err) {
        res.json({ success: false, message: 'Lỗi khi cập nhật mật khẩu!' });
    }
});

app.post('/api/admin/create-user', async (req, res) => {
    const { username, name } = req.body;
    try {
        const checkUser = await db.execute({
            sql: `SELECT * FROM users WHERE username = ?`,
            args: [username]
        });

        if (checkUser.rows.length > 0) {
            return res.json({ success: false, message: 'Tên đăng nhập đã tồn tại!' });
        }

        await db.execute({
            sql: `INSERT INTO users VALUES (?, '123456', 'user', ?, 0)`,
            args: [username, name]
        });

        res.json({ success: true, message: `Tạo tài khoản ${username} thành công! Mật khẩu: 123456` });
    } catch (err) {
        res.json({ success: false, message: 'Lỗi khi tạo tài khoản!' });
    }
});

app.get('/api/admin/users', async (req, res) => {
    try {
        const result = await db.execute(`SELECT username, name, role, canViewStats FROM users`);
        const userList = result.rows.map(u => ({ ...u, canViewStats: Boolean(u.canViewStats) }));
        res.json(userList);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/admin/toggle-stats-permission', async (req, res) => {
    const { username, canViewStats } = req.body;
    try {
        await db.execute({
            sql: `UPDATE users SET canViewStats = ? WHERE username = ?`,
            args: [canViewStats ? 1 : 0, username]
        });
        res.json({ success: true, message: 'Cập nhật quyền thành công!' });
    } catch (err) {
        res.json({ success: false, message: 'Cập nhật thất bại!' });
    }
});

app.get('/api/get-user-meal', async (req, res) => {
    const { username, date } = req.query;
    try {
        const result = await db.execute({
            sql: `SELECT * FROM meal_registrations WHERE username = ? AND date = ?`,
            args: [username, date]
        });

        if (result.rows.length > 0) {
            const row = result.rows[0];
            res.json({ success: true, trua: Boolean(row.trua), toi: Boolean(row.toi) });
        } else {
            res.json({ success: true, trua: false, toi: false });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/register-meal', async (req, res) => {
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

    try {
        await db.execute({
            sql: `DELETE FROM meal_registrations WHERE username = ? AND date = ?`,
            args: [username, date]
        });

        await db.execute({
            sql: `INSERT INTO meal_registrations (username, date, trua, toi, createdAt) VALUES (?, ?, ?, ?, ?)`,
            args: [username, date, trua ? 1 : 0, toi ? 1 : 0, new Date().toISOString()]
        });

        res.json({ success: true, message: 'Báo cơm thành công rồi nha' });
    } catch (err) {
        res.json({ success: false, message: 'Lưu báo cơm thất bại!' });
    }
});

app.get('/api/meals', async (req, res) => {
    try {
        const result = await db.execute(`SELECT * FROM meal_registrations ORDER BY date DESC`);
        const meals = result.rows.map(m => ({
            ...m,
            trua: Boolean(m.trua),
            toi: Boolean(m.toi)
        }));
        res.json(meals);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/stats/daily', async (req, res) => {
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
    try {
        const result = await db.execute(query);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/stats/user-range', async (req, res) => {
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

    try {
        const result = await db.execute({ sql: query, args: params });
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/export/user-meals', async (req, res) => {
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

    try {
        const result = await db.execute({ sql: query, args: params });
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});