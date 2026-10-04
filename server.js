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
    // បន្ថែមតារាងសម្រាប់គ្រប់គ្រងបំណុល
    const querySales = `
        CREATE TABLE IF NOT EXISTS sales (
            id SERIAL PRIMARY KEY,
            customer_name VARCHAR(255) NOT NULL,
            total_amount NUMERIC(12, 2) NOT NULL,
            paid_amount NUMERIC(12, 2) DEFAULT 0,
            debt_amount NUMERIC(12, 2) GENERATED ALWAYS AS (total_amount - paid_amount) STORED,
            status VARCHAR(50) DEFAULT 'Unpaid',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;
    const queryPurchases = `
        CREATE TABLE IF NOT EXISTS purchases (
            id SERIAL PRIMARY KEY,
            supplier_name VARCHAR(255) NOT NULL,
            total_cost NUMERIC(12, 2) NOT NULL,
            paid_cost NUMERIC(12, 2) DEFAULT 0,
            remaining_debt NUMERIC(12, 2) GENERATED ALWAYS AS (total_cost - paid_cost) STORED,
            status VARCHAR(50) DEFAULT 'Unpaid',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;

    try {
        await pool.query(queryMaster);
        await pool.query(queryTransactions);
        await pool.query(querySales);
        await pool.query(queryPurchases);
        
        await pool.query(`ALTER TABLE master_items ADD COLUMN IF NOT EXISTS type VARCHAR(50) DEFAULT 'EXPENSE';`);
        await pool.query(`ALTER TABLE master_items ADD COLUMN IF NOT EXISTS image_url TEXT;`);
        await pool.query(`ALTER TABLE master_items ADD COLUMN IF NOT EXISTS unit VARCHAR(50) DEFAULT 'ដុំ';`);
        await pool.query(`ALTER TABLE master_items ADD COLUMN IF NOT EXISTS stock_quantity INT DEFAULT 0;`);
        await pool.query(`ALTER TABLE master_items ADD COLUMN IF NOT EXISTS cost_price DECIMAL(10, 2) DEFAULT 0;`);
        await pool.query(`ALTER TABLE master_items ADD COLUMN IF NOT EXISTS retail_price DECIMAL(10, 2) DEFAULT 0;`);
        await pool.query(`ALTER TABLE master_items ADD COLUMN IF NOT EXISTS wholesale_price DECIMAL(10, 2) DEFAULT 0;`);
        await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS item_id INT;`);

        console.log("Database tables and columns are ready and safe.");
    } catch (err) {
        console.error("Error creating/updating tables:", err);
    }
};
initTables();

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

        let txData = await client.query('SELECT * FROM transactions WHERE id = $1', [id]);
        if (txData.rows.length > 0) {
            let tx = txData.rows[0];
            if (tx.item_id) {
                if (tx.type === 'INCOME') {
                    await client.query(`UPDATE master_items SET stock_quantity = stock_quantity + $1 WHERE id = $2`, [tx.quantity, tx.item_id]);
                } else if (tx.type === 'EXPENSE') {
                    await client.query(`UPDATE master_items SET stock_quantity = stock_quantity - $1 WHERE id = $2`, [tx.quantity, tx.item_id]);
                }
            }
            await client.query('DELETE FROM transactions WHERE id = $1', [id]);
        }

        await client.query('COMMIT');
        res.json({ success: true, message: "Transaction deleted successfully!" });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// ==========================================
// 🆕 DEBTS API (មុខងារគ្រប់គ្រងបំណុលថ្មី)
// ==========================================

// ១. មើលបញ្ជីភ្ញៀវជំពាក់ (Customer Debts)
app.get('/api/accounting/customer-debts', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM sales WHERE debt_amount > 0 ORDER BY created_at DESC');
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// បន្ថែមវិក្កយបត្រលក់ជំពាក់ថ្មី (Customer Debt)
app.post('/api/accounting/customer-debts', async (req, res) => {
    try {
        const { customer_name, total_amount, paid_amount } = req.body;
        const paid = parseFloat(paid_amount) || 0;
        const total = parseFloat(total_amount) || 0;
        
        let status = 'Unpaid';
        if (paid > 0 && paid < total) status = 'Partially Paid';
        if (paid >= total) status = 'Paid';

        const query = `
            INSERT INTO sales (customer_name, total_amount, paid_amount, status)
            VALUES ($1, $2, $3, $4) RETURNING *;
        `;
        const result = await pool.query(query, [customer_name, total, paid, status]);
        res.status(201).json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

// បង់ប្រាក់បន្ថែមសម្រាប់ភ្ញៀវជំពាក់
app.put('/api/accounting/customer-debts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { payment_amount } = req.body;

        const sale = await pool.query('SELECT * FROM sales WHERE id = $1', [id]);
        if (sale.rows.length === 0) return res.status(404).json({ success: false, error: 'ไม่พบข้อมูล' });

        const currentPaid = parseFloat(sale.rows[0].paid_amount);
        const total = parseFloat(sale.rows[0].total_amount);
        const newPaid = currentPaid + parseFloat(payment_amount || 0);
        
        let status = 'Partially Paid';
        if (newPaid >= total) {
            status = 'Paid';
        }

        const updateQuery = `
            UPDATE sales 
            SET paid_amount = $1, status = $2 
            WHERE id = $3 RETURNING *;
        `;
        const updated = await pool.query(updateQuery, [newPaid, status, id]);
        res.json({ success: true, data: updated.rows[0] });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

// ២. មើលបញ្ជីที่เราជំពាក់ Supplier (Supplier Debts)
app.get('/api/accounting/supplier-debts', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM purchases WHERE remaining_debt > 0 ORDER BY created_at DESC');
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// បន្ថែមការទិញស្តុកជំពាក់ Supplier ថ្មី
app.post('/api/accounting/supplier-debts', async (req, res) => {
    try {
        const { supplier_name, total_cost, paid_cost } = req.body;
        const paid = parseFloat(paid_cost) || 0;
        const total = parseFloat(total_cost) || 0;

        let status = 'Unpaid';
        if (paid > 0 && paid < total) status = 'Partially Paid';
        if (paid >= total) status = 'Paid';

        const query = `
            INSERT INTO purchases (supplier_name, total_cost, paid_cost, status)
            VALUES ($1, $2, $3, $4) RETURNING *;
        `;
        const result = await pool.query(query, [supplier_name, total, paid, status]);
        res.status(201).json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

// សងលុយ Supplier វិញ
app.put('/api/accounting/supplier-debts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { payment_amount } = req.body;

        const purchase = await pool.query('SELECT * FROM purchases WHERE id = $1', [id]);
        if (purchase.rows.length === 0) return res.status(404).json({ success: false, error: 'ไม่พบข้อมูล' });

        const currentPaid = parseFloat(purchase.rows[0].paid_cost);
        const total = parseFloat(purchase.rows[0].total_cost);
        const newPaid = currentPaid + parseFloat(payment_amount || 0);

        let status = 'Partially Paid';
        if (newPaid >= total) {
            status = 'Paid';
        }

        const updateQuery = `
            UPDATE purchases 
            SET paid_cost = $1, status = $2 
            WHERE id = $3 RETURNING *;
        `;
        const updated = await pool.query(updateQuery, [newPaid, status, id]);
        res.json({ success: true, data: updated.rows[0] });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Accounting API Server is running on port ${PORT}`);
});
