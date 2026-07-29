const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Khởi tạo Database SQLite
const db = new sqlite3.Database('./baocom.db', (err) => {
    if (err) console.error('Lỗi kết nối DB:', err.message);
    else console.log('Đã kết nối Cơ sở dữ liệu SQLite (baocom.db).');
});

// Tạo bảng & Dữ liệu mẫu khởi tạo
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT CHECK(role IN ('ADMIN', 'COOK', 'MEMBER')) DEFAULT 'MEMBER'
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS duty_schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        duty_date TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id),
        UNIQUE(user_id, duty_date)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS meal_registrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        meal_date TEXT,
        meal_type TEXT CHECK(meal_type IN ('BREAKFAST', 'LUNCH', 'DINNER')),
        status TEXT CHECK(status IN ('REGISTERED', 'CANCELLED')) DEFAULT 'REGISTERED',
        is_duty_meal INTEGER DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id),
        UNIQUE(user_id, meal_date, meal_type)
    )`);

    // Tạo tài khoản mẫu nếu chưa có
    const hashPass = bcrypt.hashSync('123456', 10);
    db.run(`INSERT OR IGNORE INTO users (id, username, password, full_name, role) VALUES 
        (1, 'admin', '${hashPass}', 'Quản trị viên', 'ADMIN'),
        (2, 'bep', '${hashPass}', 'Chị Bếp Trưởng', 'COOK'),
        (3, 'nv_an', '${hashPass}', 'Nguyễn Văn An', 'MEMBER'),
        (4, 'tran_binh', '${hashPass}', 'Trần Văn Bình', 'MEMBER')`);
});

// Giờ chốt cố định (24h)
const CUTOFF_TIMES = {
    BREAKFAST: '07:00',
    LUNCH: '09:00',
    DINNER: '15:00'
};

// Hàm hỗ trợ lấy Ngày và Giờ local dạng YYYY-MM-DD và HH:MM
function getLocalDateTime() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');

    return {
        todayStr: `${year}-${month}-${day}`,
        currentTime: `${hours}:${minutes}`
    };
}

// --- API ENDPOINTS ---

// 1. Đăng nhập
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
        if (err || !user) return res.status(400).json({ error: 'Tài khoản không tồn tại!' });
        if (!bcrypt.compareSync(password, user.password)) {
            return res.status(400).json({ error: 'Mật khẩu không chính xác!' });
        }
        res.json({ id: user.id, username: user.username, full_name: user.full_name, role: user.role });
    });
});

// 2. Lấy danh sách đăng ký cơm ngày hôm nay (Member)
app.get('/api/meals/my-status', (req, res) => {
    const { userId, date } = req.query;
    db.all(`SELECT meal_type, status, is_duty_meal FROM meal_registrations WHERE user_id = ? AND meal_date = ?`, 
    [userId, date], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 3. Đăng ký / Cắt cơm (Member)
app.post('/api/meals/toggle', (req, res) => {
    const { userId, mealDate, mealType, status } = req.body;

    // Kiểm tra giờ chốt theo thời gian địa phương
    const { todayStr, currentTime } = getLocalDateTime();

    if (mealDate === todayStr && currentTime > CUTOFF_TIMES[mealType]) {
        return res.status(400).json({ error: `Đã qua giờ chốt cơm ${mealType} (${CUTOFF_TIMES[mealType]}) hôm nay!` });
    }

    db.run(`INSERT INTO meal_registrations (user_id, meal_date, meal_type, status) 
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, meal_date, meal_type) DO UPDATE SET status = ?, updated_at = CURRENT_TIMESTAMP`,
            [userId, mealDate, mealType, status, status], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: 'Cập nhật trạng thái thành công!' });
    });
});

// 4. Lấy báo cáo thống kê theo ngày (Cook & Admin)
app.get('/api/cook/summary', (req, res) => {
    const { date } = req.query;
    const query = `
        SELECT mr.meal_type, COUNT(*) as total,
               GROUP_CONCAT(u.full_name || (CASE WHEN mr.is_duty_meal = 1 THEN ' (Trực)' ELSE '' END)) as names
        FROM meal_registrations mr
        JOIN users u ON mr.user_id = u.id
        WHERE mr.meal_date = ? AND mr.status = 'REGISTERED'
        GROUP BY mr.meal_type
    `;
    db.all(query, [date], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 5. Gán lịch trực & Tự động báo cơm (Admin)
app.post('/api/duty/assign', (req, res) => {
    const { userId, dutyDate } = req.body;

    db.serialize(() => {
        db.run(`INSERT OR IGNORE INTO duty_schedules (user_id, duty_date) VALUES (?, ?)`, [userId, dutyDate], function(err) {
            if (err) return res.status(500).json({ error: err.message });
        });

        const meals = ['BREAKFAST', 'LUNCH', 'DINNER'];
        meals.forEach(meal => {
            db.run(`INSERT INTO meal_registrations (user_id, meal_date, meal_type, status, is_duty_meal)
                    VALUES (?, ?, ?, 'REGISTERED', 1)
                    ON CONFLICT(user_id, meal_date, meal_type) DO NOTHING`, [userId, dutyDate, meal]);
        });

        res.json({ success: true, message: 'Đã gán lịch trực và tự động tạo suất ăn!' });
    });
});

// 6. Lấy danh sách tất cả nhân sự (Admin)
app.get('/api/users', (req, res) => {
    db.all(`SELECT id, username, full_name, role FROM users`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`Server đang chạy tại: http://localhost:${PORT}`);
    console.log(`Tài khoản thử nghiệm:`);
    console.log(`- Admin:   username: admin    / pass: 123456`);
    console.log(`- Bếp:     username: bep      / pass: 123456`);
    console.log(`- Đơn vị:  username: nv_an    / pass: 123456`);
    console.log(`====================================================`);
});