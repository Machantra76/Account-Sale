const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cors());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

pool.connect()
    .then(() => console.log("Connected to PostgreSQL Database successfully!"))
    .catch(err => console.error("Database connection error:", err));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const initTables = async () => {
    const queryMaster = `
        CREATE TABLE IF NOT EXISTS master_items (
            id SERIAL PRIMARY KEY,
            type VARCHAR(50) DEFAULT 'EXPENSE',
            category VARCHAR(255) NOT NULL,
            item_name VARCHAR(255) NOT NULL,
            image_url TEXT,
            unit VARCHAR(50) DEFAULT 'ដុំ',
            stock_quantity INT DEFAULT 0,
            cost_price DECIMAL(10, 2) DEFAULT 0,
            retail_price DECIMAL(10, 2) DEFAULT 0,
            wholesale_price DECIMAL(10, 2) DEFAULT 0
        );
    `;
    const queryTransactions = `
        CREATE TABLE IF NOT EXISTS transactions (
            id SERIAL PRIMARY KEY,
            date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            type VARCHAR(50) NOT NULL,
            item_id INT,
            category VARCHAR(255) NOT NULL,
            item_name VARCHAR(255) NOT NULL,
            quantity INT NOT NULL DEFAULT 1,
            unit_price DECIMAL(10, 2) NOT NULL,
            amount DECIMAL(10, 2) NOT NULL
        );
    `;
    const queryUsers = `
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(100) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            role VARCHAR(50) DEFAULT 'staff',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;
    const queryInvoices = `
        CREATE TABLE IF NOT EXISTS invoices (
            id VARCHAR(100) PRIMARY KEY,
            date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            items JSONB NOT NULL
        );
    `;
    const queryLogs = `
        CREATE TABLE IF NOT EXISTS activity_logs (
            id SERIAL PRIMARY KEY,
            date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            username VARCHAR(100) NOT NULL,
            role VARCHAR(50) NOT NULL,
            action TEXT NOT NULL
        );
    `;

    const queryDebts = `
        CREATE TABLE IF NOT EXISTS debts (
            id SERIAL PRIMARY KEY,
            debt_type VARCHAR(20) NOT NULL,
            partner_name VARCHAR(255) NOT NULL,
            reference_id VARCHAR(100),
            total_amount DECIMAL(10, 2) NOT NULL,
            paid_amount DECIMAL(10, 2) DEFAULT 0,
            remaining_amount DECIMAL(10, 2) NOT NULL,
            status VARCHAR(50) DEFAULT 'UNPAID',
            due_date TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;

    const queryDebtPayments = `
        CREATE TABLE IF NOT EXISTS debt_payments (
            id SERIAL PRIMARY KEY,
            debt_id INT REFERENCES debts(id) ON DELETE CASCADE,
            payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            paid_amount DECIMAL(10, 2) NOT NULL,
            note TEXT
        );
    `;

    try {
        await pool.query(queryMaster);
        await pool.query(queryTransactions);
        await pool.query(queryUsers);
        await pool.query(queryInvoices);
        await pool.query(queryLogs);
        await pool.query(queryDebts);
        await pool.query(queryDebtPayments);
        
        await pool.query(`ALTER TABLE master_items ADD COLUMN IF NOT EXISTS type VARCHAR(50) DEFAULT 'EXPENSE';`);
        await pool.query(`ALTER TABLE master_items ADD COLUMN IF NOT EXISTS image_url TEXT;`);
        await pool.query(`ALTER TABLE master_items ADD COLUMN IF NOT EXISTS unit VARCHAR(50) DEFAULT 'ដុំ';`);
        await pool.query(`ALTER TABLE master_items ADD COLUMN IF NOT EXISTS stock_quantity INT DEFAULT 0;`);
        await pool.query(`ALTER TABLE master_items ADD COLUMN IF NOT EXISTS cost_price DECIMAL(10, 2) DEFAULT 0;`);
        await pool.query(`ALTER TABLE master_items ADD COLUMN IF NOT EXISTS retail_price DECIMAL(10, 2) DEFAULT 0;`);
        await pool.query(`ALTER TABLE master_items ADD COLUMN IF NOT EXISTS wholesale_price DECIMAL(10, 2) DEFAULT 0;`);
        await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS item_id INT;`);
        await pool.query(`ALTER TABLE debts ADD COLUMN IF NOT EXISTS due_date TIMESTAMP;`);

        await pool.query(`
            INSERT INTO users (username, password, role) 
            VALUES ('admin', '123', 'admin')
            ON CONFLICT (username) DO NOTHING;
        `);

        console.log("Database tables and columns are ready and safe.");
    } catch (err) {
        console.error("Error creating/updating tables:", err);
    }
};
initTables();

// AUTH & USERS API
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await pool.query('SELECT * FROM users WHERE username = $1 AND password = $2', [username, password]);
        if (result.rows.length > 0) {
            res.json({ success: true, user: result.rows[0] });
        } else {
            res.status(401).json({ success: false, error: 'ឈ្មោះអ្នកប្រើប្រាស់ ឬពាក្យសម្ងាត់មិនត្រឹមត្រូវ!' });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/users', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, role, created_at FROM users ORDER BY id ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/users', async (req, res) => {
    try {
        const { username, password, role } = req.body;
        const result = await pool.query(
            'INSERT INTO users (username, password, role) VALUES ($1, $2, $3) RETURNING id, username, role',
            [username, password, role || 'staff']
        );
        res.status(201).json({ success: true, user: result.rows[0] });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

// INVOICES API
app.get('/api/accounting/invoices', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM invoices ORDER BY date DESC');
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/accounting/invoices', async (req, res) => {
    try {
        const { id, date, items } = req.body;
        await pool.query(
            'INSERT INTO invoices (id, date, items) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET items = $3, date = $2',
            [id, date || new Date(), JSON.stringify(items)]
        );
        res.json({ success: true, message: 'Saved invoice successfully' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/accounting/invoices/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM invoices WHERE id = $1', [id]);
        res.json({ success: true, message: 'Deleted invoice successfully' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ACTIVITY LOGS API
app.get('/api/activity-logs', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM activity_logs ORDER BY date DESC LIMIT 200');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/activity-logs', async (req, res) => {
    try {
        const { username, role, action } = req.body;
        await pool.query(
            'INSERT INTO activity_logs (username, role, action) VALUES ($1, $2, $3)',
            [username, role, action]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// MASTER ITEMS API
app.get('/api/accounting/master-items', async (req, res) => {
    try {
        let result = await pool.query('SELECT * FROM master_items ORDER BY category, item_name ASC');
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/accounting/master-items', async (req, res) => {
    try {
        let { type, category, item_name, image_url, unit, stock_quantity, cost_price, retail_price, wholesale_price } = req.body;
        const formattedType = (type && type.trim() !== '') ? type.toUpperCase() : 'EXPENSE';
        const itemUnit = (unit && unit.trim() !== '') ? unit : 'ដុំ';

        const query = `
            INSERT INTO master_items (type, category, item_name, image_url, unit, stock_quantity, cost_price, retail_price, wholesale_price)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *;
        `;
        let result = await pool.query(query, [
            formattedType, 
            category, 
            item_name, 
            image_url || '', 
            itemUnit,
            stock_quantity || 0, 
            cost_price || 0,
            retail_price || 0,
            wholesale_price || 0
        ]);
        
        res.status(201).json({ success: true, message: "Master item added successfully!", data: result.rows[0] });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

app.put('/api/accounting/master-items/:id', async (req, res) => {
    try {
        const { id } = req.params;
        let { category, item_name, image_url, unit, stock_quantity, cost_price, retail_price, wholesale_price } = req.body;
        const itemUnit = (unit && unit.trim() !== '') ? unit : 'ដុំ';

        const query = `
            UPDATE master_items 
            SET category = $1, item_name = $2, image_url = $3, unit = $4, stock_quantity = $5, cost_price = $6, retail_price = $7, wholesale_price = $8
            WHERE id = $9 RETURNING *;
        `;
        let result = await pool.query(query, [
            category, 
            item_name, 
            image_url || '', 
            itemUnit,
            stock_quantity || 0, 
            cost_price || 0, 
            retail_price || 0,
            wholesale_price || 0,
            id
        ]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: "Master item not found!" });
        }

        res.json({ success: true, message: "Master item updated successfully!", data: result.rows[0] });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

app.delete('/api/accounting/master-items/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM master_items WHERE id = $1', [id]);
        res.json({ success: true, message: "Master item deleted successfully!" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// TRANSACTIONS API
app.get('/api/accounting/transactions', async (req, res) => {
    try {
        let result = await pool.query('SELECT * FROM transactions ORDER BY date DESC');
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/accounting/transactions', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { type, item_id, category, item_name, quantity, unit_price } = req.body;
        const formattedType = type ? type.toUpperCase() : 'INCOME';
        const qty = parseInt(quantity) || 1;
        const price = parseFloat(unit_price) || 0;
        const totalAmount = qty * price;

        const insertQuery = `
            INSERT INTO transactions (type, item_id, category, item_name, quantity, unit_price, amount)
            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
        `;
        let result = await client.query(insertQuery, [formattedType, item_id, category, item_name, qty, price, totalAmount]);

        if (item_id) {
            if (formattedType === 'INCOME') {
                await client.query(`UPDATE master_items SET stock_quantity = stock_quantity - $1 WHERE id = $2`, [qty, item_id]);
            } else if (formattedType === 'EXPENSE') {
                let masterRes = await client.query(`SELECT stock_quantity, cost_price FROM master_items WHERE id = $1`, [item_id]);
                
                if (masterRes.rows.length > 0) {
                    let item = masterRes.rows[0];
                    let oldStock = parseInt(item.stock_quantity) || 0;
                    let oldCostPrice = parseFloat(item.cost_price) || 0;
                    
                    let newStock = oldStock + qty;
                    let newCostPrice = oldCostPrice;

                    if (newStock > 0) {
                        newCostPrice = ((oldStock * oldCostPrice) + (qty * price)) / newStock;
                    }

                    await client.query(
                        `UPDATE master_items SET stock_quantity = $1, cost_price = $2 WHERE id = $3`,
                        [newStock, newCostPrice, item_id]
                    );
                }
            }
        }

        await client.query('COMMIT');
        res.status(201).json({ success: true, data: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(400).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

app.put('/api/accounting/transactions/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id } = req.params;
        const { category, item_name, quantity, unit_price } = req.body;
        
        let oldTxData = await client.query('SELECT * FROM transactions WHERE id = $1', [id]);
        if (oldTxData.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: "Transaction not found!" });
        }
        let oldTx = oldTxData.rows[0];

        const qty = parseInt(quantity) || 1;
        const price = parseFloat(unit_price) || 0;
        const totalAmount = qty * price;

        if (oldTx.item_id) {
            if (oldTx.type === 'INCOME') {
                await client.query(`UPDATE master_items SET stock_quantity = stock_quantity + $1 WHERE id = $2`, [oldTx.quantity, oldTx.item_id]);
            } else if (oldTx.type === 'EXPENSE') {
                await client.query(`UPDATE master_items SET stock_quantity = stock_quantity - $1 WHERE id = $2`, [oldTx.quantity, oldTx.item_id]);
            }
        }

        if (oldTx.item_id) {
            if (oldTx.type === 'INCOME') {
                await client.query(`UPDATE master_items SET stock_quantity = stock_quantity - $1 WHERE id = $2`, [qty, oldTx.item_id]);
            } else if (oldTx.type === 'EXPENSE') {
                await client.query(`UPDATE master_items SET stock_quantity = stock_quantity + $1 WHERE id = $2`, [qty, oldTx.item_id]);
            }
        }

        const updateQuery = `
            UPDATE transactions 
            SET category = $1, item_name = $2, quantity = $3, unit_price = $4, amount = $5
            WHERE id = $6 RETURNING *;
        `;
        let result = await client.query(updateQuery, [category, item_name, qty, price, totalAmount, id]);

        await client.query('COMMIT');
        res.json({ success: true, message: "Transaction updated successfully!", data: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(400).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// DEBTS API
app.get('/api/accounting/debts', async (req, res) => {
    try {
        const { debt_type } = req.query;
        let query = 'SELECT * FROM debts';
        let params = [];
        
        if (debt_type) {
            query += ' WHERE debt_type = $1';
            params.push(debt_type.toUpperCase());
        }
        query += ' ORDER BY created_at DESC';

        let result = await pool.query(query, params);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/accounting/debts', async (req, res) => {
    try {
        const { debt_type, partner_name, reference_id, total_amount, due_date } = req.body;
        const type = debt_type ? debt_type.toUpperCase() : 'RECEIVABLE';
        const total = parseFloat(total_amount) || 0;

        const query = `
            INSERT INTO debts (debt_type, partner_name, reference_id, total_amount, paid_amount, remaining_amount, status, due_date)
            VALUES ($1, $2, $3, $4, 0, $5, 'UNPAID', $6) RETURNING *;
        `;
        let result = await pool.query(query, [type, partner_name, reference_id || '', total, total, due_date || null]);
        
        res.status(201).json({ success: true, message: "Debt record created successfully!", data: result.rows[0] });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

app.post('/api/accounting/debts/:id/pay', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id } = req.params;
        const { paid_amount, note } = req.body;
        const payAmount = parseFloat(paid_amount) || 0;

        let debtRes = await client.query('SELECT * FROM debts WHERE id = $1', [id]);
        if (debtRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: "Debt record not found!" });
        }

        let debt = debtRes.rows[0];
        let newPaidAmount = parseFloat(debt.paid_amount) + payAmount;
        let newRemaining = parseFloat(debt.total_amount) - newPaidAmount;
        
        let newStatus = 'PARTIAL';
        if (newRemaining <= 0) {
            newRemaining = 0;
            newStatus = 'PAID';
        }

        await client.query(
            'INSERT INTO debt_payments (debt_id, paid_amount, note) VALUES ($1, $2, $3)',
            [id, payAmount, note || '']
        );

        let updateRes = await client.query(
            `UPDATE debts SET paid_amount = $1, remaining_amount = $2, status = $3 WHERE id = $4 RETURNING *;`,
            [newPaidAmount, newRemaining, newStatus, id]
        );

        await client.query('COMMIT');
        res.json({ success: true, message: "Payment recorded successfully!", data: updateRes.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(400).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

app.delete('/api/accounting/debts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM debts WHERE id = $1', [id]);
        res.json({ success: true, message: "Debt record deleted successfully!" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// SUMMARY API
app.get('/api/accounting/summary', async (req, res) => {
    try {
        let txResult = await pool.query("SELECT * FROM transactions WHERE type = 'INCOME'");
        let masterResult = await pool.query("SELECT * FROM master_items");
        
        let totalIncome = 0;
        let totalProfit = 0;

        let costPriceMap = {};
        masterResult.rows.forEach(m => {
            costPriceMap[m.id] = parseFloat(m.cost_price) || 0;
        });

        txResult.rows.forEach(tx => {
            let incomeAmt = parseFloat(tx.amount) || 0;
            totalIncome += incomeAmt;

            let costPrice = costPriceMap[tx.item_id] || 0;
            let profitPerUnit = parseFloat(tx.unit_price) - costPrice;
            totalProfit += (profitPerUnit * tx.quantity);
        });

        let totalInventoryValue = 0;
        masterResult.rows.forEach(m => {
            totalInventoryValue += (parseInt(m.stock_quantity) * parseFloat(m.cost_price));
        });

        res.json({
            success: true,
            summary: {
                total_income: totalIncome,
                total_purchase_value: totalInventoryValue,
                net_profit: totalProfit
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/accounting/transactions/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id } = req.params;

        await client.query('DELETE FROM transactions WHERE id = $1', [id]);

        await client.query('COMMIT');
        res.json({ success: true, message: "Transaction deleted successfully!" });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Accounting API Server is running on port ${PORT}`);
});
