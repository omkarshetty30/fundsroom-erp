# Fundsroom ERP

A small ERP application implementing:

Customer Enquiry → Quotation → Sales Order → Inventory Reservation → Dispatch

## Stack
- React.js + Vite
- Node.js + Express.js
- PostgreSQL
- JWT authentication
- bcrypt password hashing
- REST APIs

## Folder structure
- `backend/` - Express REST API and PostgreSQL logic
- `frontend/` - React application
- `database/schema.sql` - database schema and seed data
- `docs/ERD.md` - database ER diagram
- `docs/postman_collection.json` - API collection
- `backend/tests/` - automated tests

## 1. PostgreSQL
Create a database named:

`fundsroom_erp`

Run `database/schema.sql` against that database.

The SQL seeds 6 industrial products, inventory, an ADMIN user and a SALES_USER.

Test credentials:
- Admin: `admin@fundsroom.com` / `Admin@123`
- Sales: `sales@fundsroom.com` / `Sales@123`

## 2. Backend
Open a terminal in `backend`:

```bash
npm install
```

Create `.env` from `.env.example` and set your PostgreSQL password.

```bash
npm start
```

Backend: `http://localhost:5000`

## 3. Frontend
Open another terminal in `frontend`:

```bash
npm install
npm run dev
```

Frontend: `http://localhost:5173`

## 4. Tests

From `backend`:

```bash
npm test
```

## Demo flow
Login → create enquiry → create quotation → accept quotation → convert to sales order → admin confirms/reserves stock → dispatch order.

## Notes
Inventory reservation is performed inside a PostgreSQL transaction with row locking. Available inventory is calculated as:

`Physical Quantity - Reserved Quantity`

Dispatch decreases both physical and reserved quantities.
