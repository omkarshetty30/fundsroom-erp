const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const {
  calculateQuotationTotal,
  canCreateSalesOrder,
  canConfirmOrder,
  canDispatchOrder,
  canReserve,
  canRole
} = require('./logic');

dotenv.config();

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(cors());
app.use(express.json());

function asyncHandler(fn) {
  return (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
}

function auth(req,res,next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({message:'Authentication required'});
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({message:'Invalid or expired token'});
  }
}

function allow(...roles) {
  return (req,res,next) => {
    if (!req.user || !canRole(req.user.role, roles)) {
      return res.status(403).json({message:'Forbidden'});
    }
    next();
  };
}

app.get('/', (req,res) => res.json({message:'Fundsroom ERP Backend is running'}));
app.get('/api/health/db', asyncHandler(async (req,res) => {
  const r = await pool.query('SELECT NOW() AS current_time');
  res.json({message:'PostgreSQL connected successfully', time:r.rows[0].current_time});
}));

app.post('/api/auth/login', asyncHandler(async (req,res) => {
  const {email,password} = req.body;
  if (!email || !password) return res.status(400).json({message:'Email and password are required'});
  const r = await pool.query('SELECT * FROM users WHERE email=$1',[email]);
  if (!r.rowCount) return res.status(401).json({message:'Invalid credentials'});
  const user = r.rows[0];
  const ok = await bcrypt.compare(password,user.password_hash);
  if (!ok) return res.status(401).json({message:'Invalid credentials'});
  const token = jwt.sign({id:user.id,email:user.email,role:user.role,name:user.name},
    process.env.JWT_SECRET,{expiresIn:'8h'});
  res.json({token,user:{id:user.id,name:user.name,email:user.email,role:user.role}});
}));

app.get('/api/products', auth, asyncHandler(async (req,res) => {
  const r = await pool.query(`
    SELECT p.id,p.product_code,p.product_name,p.category,p.unit,p.base_price,
           i.physical_quantity,i.reserved_quantity,
           (i.physical_quantity-i.reserved_quantity) AS available_quantity
    FROM products p JOIN inventory i ON i.product_id=p.id
    ORDER BY p.id`);
  res.json(r.rows);
}));

app.get('/api/customers', auth, asyncHandler(async (req,res) => {
  const r = await pool.query('SELECT * FROM customers ORDER BY id DESC');
  res.json(r.rows);
}));

app.post('/api/customers', auth, allow('ADMIN','SALES_USER'), asyncHandler(async (req,res) => {
  const {companyName,contactPerson,mobile,email,city} = req.body;
  if (!companyName || !contactPerson || !mobile || !city) return res.status(400).json({message:'Required customer fields missing'});
  const r = await pool.query(`
    INSERT INTO customers(company_name,contact_person,mobile,email,city)
    VALUES($1,$2,$3,$4,$5) RETURNING *`,
    [companyName,contactPerson,mobile,email||null,city]);
  res.status(201).json(r.rows[0]);
}));

app.get('/api/enquiries', auth, asyncHandler(async (req,res) => {
  const r = await pool.query(`
    SELECT e.*, c.company_name
    FROM enquiries e JOIN customers c ON c.id=e.customer_id
    ORDER BY e.id DESC`);
  res.json(r.rows);
}));

app.post('/api/enquiries', auth, allow('ADMIN','SALES_USER'), asyncHandler(async (req,res) => {
  const {enquiryNumber,customerId,requiredDate,notes,items} = req.body;
  if (!enquiryNumber || !customerId || !Array.isArray(items) || items.length===0)
    return res.status(400).json({message:'Enquiry number, customer and items are required'});
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const er = await client.query(`
      INSERT INTO enquiries(enquiry_number,customer_id,required_date,notes,created_by)
      VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [enquiryNumber,customerId,requiredDate||null,notes||null,req.user.id]);
    for (const item of items) {
      if (!Number.isInteger(Number(item.quantity)) || Number(item.quantity)<=0) throw new Error('Invalid enquiry quantity');
      await client.query(
        `INSERT INTO enquiry_items(enquiry_id,product_id,quantity) VALUES($1,$2,$3)`,
        [er.rows[0].id,item.productId,Number(item.quantity)]
      );
    }
    await client.query('COMMIT');
    res.status(201).json(er.rows[0]);
  } catch(e) {
    await client.query('ROLLBACK');
    res.status(400).json({message:e.message});
  } finally { client.release(); }
}));

app.get('/api/quotations', auth, asyncHandler(async (req,res) => {
  const r = await pool.query(`
    SELECT q.*, c.company_name, e.enquiry_number
    FROM quotations q
    JOIN customers c ON c.id=q.customer_id
    JOIN enquiries e ON e.id=q.enquiry_id
    ORDER BY q.id DESC`);
  res.json(r.rows);
}));

app.post('/api/quotations', auth, allow('ADMIN','SALES_USER'), asyncHandler(async (req,res) => {
  const {quotationNumber,enquiryId,validUntil,items} = req.body;
  if (!quotationNumber || !enquiryId || !Array.isArray(items) || items.length===0)
    return res.status(400).json({message:'Quotation number, enquiry and items are required'});

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const e = await client.query('SELECT * FROM enquiries WHERE id=$1',[enquiryId]);
    if (!e.rowCount) throw new Error('Enquiry not found');
    const totalItems = items.map(x => ({
      quantity:Number(x.quantity), unitPrice:Number(x.unitPrice),
      discountPercent:Number(x.discountPercent||0), gstPercent:Number(x.gstPercent||0)
    }));
    const total = calculateQuotationTotal(totalItems);
    const q = await client.query(`
      INSERT INTO quotations(quotation_number,enquiry_id,customer_id,valid_until,grand_total,created_by)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [quotationNumber,enquiryId,e.rows[0].customer_id,validUntil||null,total,req.user.id]);
    for (let i=0;i<items.length;i++) {
      const item=items[i];
      const line=calculateQuotationTotal([totalItems[i]]);
      await client.query(`
        INSERT INTO quotation_items
        (quotation_id,product_id,quantity,unit_price,discount_percent,gst_percent,line_amount)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [q.rows[0].id,item.productId,totalItems[i].quantity,totalItems[i].unitPrice,
         totalItems[i].discountPercent,totalItems[i].gstPercent,line]);
    }
    await client.query('UPDATE enquiries SET status=$1 WHERE id=$2',['QUOTED',enquiryId]);
    await client.query('COMMIT');
    res.status(201).json(q.rows[0]);
  } catch(e) {
    await client.query('ROLLBACK');
    res.status(400).json({message:e.message});
  } finally { client.release(); }
}));

app.patch('/api/quotations/:id/status', auth, allow('ADMIN','SALES_USER'), asyncHandler(async (req,res) => {
  const allowed=['DRAFT','SENT','ACCEPTED','REJECTED'];
  const status=String(req.body.status||'').toUpperCase();
  if (!allowed.includes(status)) return res.status(400).json({message:'Invalid quotation status'});
  const r=await pool.query('UPDATE quotations SET status=$1 WHERE id=$2 RETURNING *',[status,req.params.id]);
  if (!r.rowCount) return res.status(404).json({message:'Quotation not found'});
  res.json(r.rows[0]);
}));

app.post('/api/quotations/:id/convert', auth, allow('ADMIN','SALES_USER'), asyncHandler(async (req,res) => {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const q=await client.query('SELECT * FROM quotations WHERE id=$1 FOR UPDATE',[req.params.id]);
    if (!q.rowCount) throw new Error('Quotation not found');
    if (!canCreateSalesOrder(q.rows[0].status)) throw new Error('Only ACCEPTED quotation can create Sales Order');
    const existing=await client.query('SELECT id FROM sales_orders WHERE quotation_id=$1',[req.params.id]);
    if (existing.rowCount) throw new Error('This quotation already has a Sales Order');
    const orderNumber='SO-'+Date.now();
    const so=await client.query(`
      INSERT INTO sales_orders(order_number,quotation_id,customer_id,total_amount)
      VALUES($1,$2,$3,$4) RETURNING *`,
      [orderNumber,q.rows[0].id,q.rows[0].customer_id,q.rows[0].grand_total]);
    const qi=await client.query('SELECT * FROM quotation_items WHERE quotation_id=$1',[q.rows[0].id]);
    for(const item of qi.rows) {
      await client.query(
        'INSERT INTO sales_order_items(sales_order_id,product_id,quantity) VALUES($1,$2,$3)',
        [so.rows[0].id,item.product_id,item.quantity]
      );
    }
    await client.query('UPDATE enquiries SET status=$1 WHERE id=(SELECT enquiry_id FROM quotations WHERE id=$2)',['WON',req.params.id]);
    await client.query('COMMIT');
    res.status(201).json(so.rows[0]);
  } catch(e) {
    await client.query('ROLLBACK');
    res.status(400).json({message:e.message});
  } finally { client.release(); }
}));

app.get('/api/sales-orders', auth, asyncHandler(async (req,res) => {
  const r=await pool.query(`
    SELECT so.*, c.company_name, q.quotation_number
    FROM sales_orders so
    JOIN customers c ON c.id=so.customer_id
    JOIN quotations q ON q.id=so.quotation_id
    ORDER BY so.id DESC`);
  res.json(r.rows);
}));

app.post('/api/sales-orders/:id/confirm', auth, allow('ADMIN'), asyncHandler(async (req,res) => {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const so=await client.query('SELECT * FROM sales_orders WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!so.rowCount) throw new Error('Sales Order not found');
    if(!canConfirmOrder(so.rows[0].status)) throw new Error('Only PENDING order can be confirmed');
    const items=await client.query('SELECT * FROM sales_order_items WHERE sales_order_id=$1',[req.params.id]);
    for(const item of items.rows){
      const inv=await client.query('SELECT * FROM inventory WHERE product_id=$1 FOR UPDATE',[item.product_id]);
      if(!inv.rowCount) throw new Error('Inventory not found');
      const {physical_quantity:physical,reserved_quantity:reserved}=inv.rows[0];
      if(!canReserve(Number(physical),Number(reserved),Number(item.quantity)))
        throw new Error(`Insufficient available stock for product ${item.product_id}`);
    }
    for(const item of items.rows){
      await client.query(
        'UPDATE inventory SET reserved_quantity=reserved_quantity+$1 WHERE product_id=$2',
        [item.quantity,item.product_id]
      );
    }
    const updated=await client.query('UPDATE sales_orders SET status=$1 WHERE id=$2 RETURNING *',['CONFIRMED',req.params.id]);
    await client.query('COMMIT');
    res.json(updated.rows[0]);
  } catch(e) {
    await client.query('ROLLBACK');
    res.status(400).json({message:e.message});
  } finally { client.release(); }
}));

app.post('/api/sales-orders/:id/dispatch', auth, allow('ADMIN'), asyncHandler(async (req,res) => {
  const {vehicleNumber,driverName}=req.body;
  if(!vehicleNumber || !driverName) return res.status(400).json({message:'Vehicle number and driver name are required'});
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const so=await client.query('SELECT * FROM sales_orders WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!so.rowCount) throw new Error('Sales Order not found');
    if(!canDispatchOrder(so.rows[0].status)) throw new Error('Only CONFIRMED order can be dispatched');

    const existing=await client.query('SELECT id FROM dispatches WHERE sales_order_id=$1',[req.params.id]);
    if(existing.rowCount) throw new Error('Order already dispatched');

    const items=await client.query('SELECT * FROM sales_order_items WHERE sales_order_id=$1',[req.params.id]);
    for(const item of items.rows){
      const inv=await client.query('SELECT * FROM inventory WHERE product_id=$1 FOR UPDATE',[item.product_id]);
      if(!inv.rowCount || Number(inv.rows[0].reserved_quantity) < Number(item.quantity))
        throw new Error(`Reserved stock is insufficient for product ${item.product_id}`);
    }

    const dn='DN-'+Date.now();
    const d=await client.query(`
      INSERT INTO dispatches(dispatch_number,sales_order_id,vehicle_number,driver_name)
      VALUES($1,$2,$3,$4) RETURNING *`,
      [dn,req.params.id,vehicleNumber,driverName]);

    for(const item of items.rows){
      await client.query(`
        INSERT INTO dispatch_items(dispatch_id,product_id,quantity)
        VALUES($1,$2,$3)`,[d.rows[0].id,item.product_id,item.quantity]);
      await client.query(`
        UPDATE inventory
        SET physical_quantity=physical_quantity-$1,
            reserved_quantity=reserved_quantity-$1
        WHERE product_id=$2`,[item.quantity,item.product_id]);
    }

    const updated=await client.query('UPDATE sales_orders SET status=$1 WHERE id=$2 RETURNING *',['DISPATCHED',req.params.id]);
    await client.query('COMMIT');
    res.json({dispatch:d.rows[0],order:updated.rows[0]});
  } catch(e) {
    await client.query('ROLLBACK');
    res.status(400).json({message:e.message});
  } finally { client.release(); }
}));

app.use((err,req,res,next) => {
  console.error(err);
  res.status(500).json({message:'Internal server error'});
});

const PORT=process.env.PORT||5000;
app.listen(PORT,()=>console.log(`Server running on http://localhost:${PORT}`));
