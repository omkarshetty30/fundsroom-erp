function calculateLineAmount(quantity, unitPrice, discountPercent, gstPercent) {
  if (quantity <= 0 || unitPrice < 0) throw new Error('Invalid quantity or price');
  if (discountPercent < 0 || discountPercent > 100) throw new Error('Invalid discount');
  if (gstPercent < 0) throw new Error('Invalid GST');

  const base = quantity * unitPrice;
  const discounted = base - (base * discountPercent / 100);
  return Number((discounted + discounted * gstPercent / 100).toFixed(2));
}

function calculateQuotationTotal(items) {
  return Number(items.reduce((sum, item) =>
    sum + calculateLineAmount(
      Number(item.quantity),
      Number(item.unitPrice),
      Number(item.discountPercent || 0),
      Number(item.gstPercent || 0)
    ), 0).toFixed(2));
}

function canCreateSalesOrder(status) {
  return status === 'ACCEPTED';
}

function canConfirmOrder(status) {
  return status === 'PENDING';
}

function canDispatchOrder(status) {
  return status === 'CONFIRMED';
}

function canReserve(physical, reserved, requested) {
  return requested > 0 && (physical - reserved) >= requested;
}

function canRole(role, allowedRoles) {
  return allowedRoles.includes(role);
}

module.exports = {
  calculateLineAmount,
  calculateQuotationTotal,
  canCreateSalesOrder,
  canConfirmOrder,
  canDispatchOrder,
  canReserve,
  canRole
};
