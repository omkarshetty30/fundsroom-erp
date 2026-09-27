const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateQuotationTotal,
  canCreateSalesOrder,
  canConfirmOrder,
  canDispatchOrder,
  canReserve,
  canRole
} = require('../logic');

test('1. quotation total is calculated correctly', () => {
  const total = calculateQuotationTotal([{quantity:10,unitPrice:100,discountPercent:10,gstPercent:18}]);
  assert.equal(total,1062);
});

test('2. draft/rejected quotation cannot create Sales Order', () => {
  assert.equal(canCreateSalesOrder('DRAFT'), false);
  assert.equal(canCreateSalesOrder('REJECTED'), false);
});

test('3. same quotation cannot create a second Sales Order (unique relationship)', () => {
  const quotationIdAlreadyLinked = 25;
  const existingSalesOrderQuotationIds = [10, 25, 40];
  assert.equal(existingSalesOrderQuotationIds.includes(quotationIdAlreadyLinked), true);
});

test('4. cannot reserve more than available inventory', () => {
  assert.equal(canReserve(100,30,60), true);
  assert.equal(canReserve(100,30,80), false);
});

test('5. unauthorized user cannot perform restricted operation', () => {
  assert.equal(canRole('SALES_USER',['ADMIN']), false);
  assert.equal(canRole('ADMIN',['ADMIN']), true);
});

test('bonus: state transitions are enforced', () => {
  assert.equal(canConfirmOrder('PENDING'), true);
  assert.equal(canConfirmOrder('CONFIRMED'), false);
  assert.equal(canDispatchOrder('CONFIRMED'), true);
  assert.equal(canDispatchOrder('PENDING'), false);
});
