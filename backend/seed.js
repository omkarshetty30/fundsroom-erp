require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    const adminHash = await bcrypt.hash('Admin@123', 10);
    const salesHash = await bcrypt.hash('Sales@123', 10);

    await pool.query(`
      INSERT INTO users (name,email,password_hash,role)
      VALUES ('System Admin','admin@fundsroom.com',$1,'ADMIN')
      ON CONFLICT (email) DO NOTHING
    `,[adminHash]);

    await pool.query(`
      INSERT INTO users (name,email,password_hash,role)
      VALUES ('Sales User','sales@fundsroom.com',$1,'SALES_USER')
      ON CONFLICT (email) DO NOTHING
    `,[salesHash]);

    console.log('Seed users ready.');
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
