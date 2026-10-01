const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cors());

// 🔗 ប្តូរ Connection String ខាងក្រោមទៅ Database ថ្មីរបស់អ្នក
const pool = new Pool({
    connectionString: 'postgresql://USER:PASSWORD@HOST:PORT/DATABASE_NAME?sslmode=require',
    ssl: { rejectUnauthorized: false }
});

pool.connect()
    .then(() => console.log("Connected to New PostgreSQL Database successfully!"))
    .catch(err => console.error("Database connection error:", err));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ស្វ័យប្រវត្តបង្កើត Database Tables
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
    try {
        await pool.query(queryMaster);
        await pool.query(queryTransactions);
        console.log("Database tables are initialized successfully.");
    } catch (err) {
        console.error("Error creating tables:", err);
    }
};
initTables();

// Master Items APIs
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
        const query = `
            INSERT INTO master_items (type, category, item_name, image_url, unit, stock_quantity, cost_price, retail_price, wholesale_price)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *;
        `;
        let result = await pool.query(query, [
            type ? type.toUpperCase() : 'EXPENSE', category, item_name, image_url || '', unit || 'ដុំ',
            stock_quantity || 0, cost_price || 0, retail_price || 0, wholesale_price || 0
        ]);
        res.status(201).json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

app.put('/api/accounting/master-items/:id', async (req, res) => {
    try {
        const { id } = req.params;
        let { category, item_name, image_url, unit, stock_quantity, cost_price, retail_price, wholesale_price } = req.body;
        const query = `
            UPDATE master_items 
            SET category = $1, item_name = $2, image_url = $3, unit = $4, stock_quantity = $5, cost_price = $6, retail_price = $7, wholesale_price = $8
            WHERE id = $9 RETURNING *;
        `;
        let result = await pool.query(query, [
            category, item_name, image_url || '', unit || 'ដុំ', stock_quantity || 0, cost_price || 0, retail_price || 0, wholesale_price || 0, id
        ]);
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

app.delete('/api/accounting/master-items/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM master_items WHERE id = $1', [req.params.id]);
        res.json({ success: true, message: "Deleted successfully" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Transactions APIs
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
        let qty = parseInt(quantity) || 1;
        let price = parseFloat(unit_price) || 0;
        let formattedType = type ? type.toUpperCase() : 'INCOME';

        let result = await client.query(
            `INSERT INTO transactions (type, item_id, category, item_name, quantity, unit_price, amount) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;`,
            [formattedType, item_id, category, item_name, qty, price, qty * price]
        );

        if (item_id) {
            if (formattedType === 'INCOME') {
                await client.query(`UPDATE master_items SET stock_quantity = stock_quantity - $1 WHERE id = $2`, [qty, item_id]);
            } else if (formattedType === 'EXPENSE') {
                await client.query(`UPDATE master_items SET stock_quantity = stock_quantity + $1 WHERE id = $2`, [qty, item_id]);
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

app.delete('/api/accounting/transactions/:id', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        let txData = await client.query('SELECT * FROM transactions WHERE id = $1', [req.params.id]);
        if (txData.rows.length > 0) {
            let tx = txData.rows[0];
            if (tx.item_id) {
                if (tx.type === 'INCOME') {
                    await client.query(`UPDATE master_items SET stock_quantity = stock_quantity + $1 WHERE id = $2`, [tx.quantity, tx.item_id]);
                } else if (tx.type === 'EXPENSE') {
                    await client.query(`UPDATE master_items SET stock_quantity = stock_quantity - $1 WHERE id = $2`, [tx.quantity, tx.item_id]);
                }
            }
            await client.query('DELETE FROM transactions WHERE id = $1', [req.params.id]);
        }
        await client.query('COMMIT');
        res.json({ success: true, message: "Deleted successfully" });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// Summary API
app.get('/api/accounting/summary', async (req, res) => {
    try {
        let txResult = await pool.query("SELECT * FROM transactions WHERE type = 'INCOME'");
        let masterResult = await pool.query("SELECT * FROM master_items");
        
        let totalIncome = 0;
        let totalProfit = 0;
        let costPriceMap = {};
        masterResult.rows.forEach(m => { costPriceMap[m.id] = parseFloat(m.cost_price) || 0; });

        txResult.rows.forEach(tx => {
            totalIncome += parseFloat(tx.amount) || 0;
            let costPrice = costPriceMap[tx.item_id] || 0;
            totalProfit += (parseFloat(tx.unit_price) - costPrice) * tx.quantity;
        });

        let totalInventoryValue = 0;
        masterResult.rows.forEach(m => {
            totalInventoryValue += (parseInt(m.stock_quantity) * parseFloat(m.cost_price));
        });

        res.json({
            success: true,
            summary: { total_income: totalIncome, total_purchase_value: totalInventoryValue, net_profit: totalProfit }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
