function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = "";
      if (character === "\r" && source[index + 1] === "\n") index += 1;
    } else {
      value += character;
    }
  }

  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

function numericValue(value) {
  const normalized = String(value ?? "").replace(/[,$%\s]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function analyzeDemoCsv(text) {
  const [headerRow, ...dataRows] = parseCsvRows(text);
  const columns = (headerRow || []).map((column) => column.trim());
  if (!columns.length || !dataRows.length) {
    throw new Error("The CSV must contain a header row and at least one data row.");
  }

  const records = dataRows.map((row) =>
    Object.fromEntries(columns.map((column, index) => [column, row[index]?.trim() ?? ""]))
  );
  const normalize = (value) => value.toLowerCase().replace(/[\s-]+/g, "_");
  const findColumn = (pattern) => columns.find((column) => pattern.test(normalize(column)));
  const demandColumn = findColumn(/^(units_sold|units|demand|quantity|sales|qty|quantity_sold)$/)
    || findColumn(/(units|demand|quantity|sales|qty)/);

  if (!demandColumn) {
    throw new Error("No demand or quantity column was found. Add a column such as units_sold, demand, or quantity.");
  }

  const dateColumn = findColumn(/date|time/);
  const productColumn = findColumn(/product_id|sku|item_id/)
    || findColumn(/product|item/);
  const productNameColumn = findColumn(/^(product_name|item_name|name)$/);
  const categoryColumn = findColumn(/^(category|product_category)$/);
  const priceColumn = findColumn(/^(price|unit_price|selling_price)$/);
  const stockColumn = findColumn(/^(current_stock|stock|stock_quantity|inventory|inventory_quantity|on_hand)$/);
  const demandByDate = new Map();

  records.forEach((record, index) => {
    const demand = numericValue(record[demandColumn]);
    if (demand === null) return;
    let key = "";
    let label = "";
    if (dateColumn && record[dateColumn]) {
      const date = new Date(record[dateColumn]);
      if (!Number.isNaN(date.getTime())) {
        key = date.toISOString().slice(0, 10);
        label = key;
      }
    }
    if (!key) {
      key = productColumn ? record[productColumn] || `Record ${index + 1}` : `Record ${index + 1}`;
      label = key;
    }
    const current = demandByDate.get(key) || { label, value: 0, date: dateColumn ? key : null };
    current.value += demand;
    demandByDate.set(key, current);
  });

  let demandHistory = Array.from(demandByDate.values());
  if (dateColumn && demandHistory.every((point) => point.date)) {
    demandHistory.sort((a, b) => a.date.localeCompare(b.date));
  } else {
    demandHistory = demandHistory
      .sort((a, b) => b.value - a.value)
      .slice(0, 180)
      .reverse();
  }
  demandHistory = demandHistory.slice(-180);

  const productTotals = new Map();
  const categoryTotals = new Map();
  let totalSales = null;
  let salesRows = 0;
  let salesTotal = 0;
  records.forEach((record) => {
    const demand = numericValue(record[demandColumn]);
    if (demand === null) return;
    const productId = productColumn ? record[productColumn] || "Unknown Product" : null;
    if (productId !== null) {
      const current = productTotals.get(productId) || {
        product_id: productId,
        product_name: productNameColumn ? record[productNameColumn] || productId : productId,
        category: categoryColumn ? record[categoryColumn] || null : null,
        units_sold: 0,
      };
      current.units_sold += demand;
      productTotals.set(productId, current);
    }
    if (categoryColumn && record[categoryColumn]) {
      categoryTotals.set(record[categoryColumn], (categoryTotals.get(record[categoryColumn]) || 0) + demand);
    }
    const price = priceColumn ? numericValue(record[priceColumn]) : null;
    if (price !== null) {
      salesTotal += demand * price;
      salesRows += 1;
    }
  });
  if (salesRows) totalSales = salesTotal;
  const topProducts = Array.from(productTotals.values())
    .sort((left, right) => right.units_sold - left.units_sold)
    .slice(0, 10);
  const categories = Array.from(categoryTotals, ([category, units_sold]) => ({ category, units_sold }))
    .sort((left, right) => right.units_sold - left.units_sold)
    .slice(0, 10);
  const validDateCount = dateColumn
    ? new Set(records.map((record) => {
        const parsed = new Date(record[dateColumn]);
        return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
      }).filter(Boolean)).size
    : 0;
  const datedDemand = dateColumn
    ? records.reduce((sum, record) => {
        const parsed = new Date(record[dateColumn]);
        const demand = numericValue(record[demandColumn]);
        return !Number.isNaN(parsed.getTime()) && demand !== null ? sum + demand : sum;
      }, 0)
    : null;
  const forecastRows = demandHistory.map((point, index) => {
    const recent = demandHistory.slice(Math.max(0, index - 2), index + 1);
    const estimate = recent.reduce((sum, item) => sum + item.value, 0) / recent.length;
    return {
      forecast_date: point.date || point.label,
      predicted_demand: estimate,
      confidence_level: null,
    };
  });
  const uniqueProducts = productColumn
    ? new Set(records.map((record) => record[productColumn]).filter(Boolean)).size
    : records.length;
  const totalDemand = records.reduce((sum, record) => sum + (numericValue(record[demandColumn]) || 0), 0);

  return {
    row_count: records.length,
    column_count: columns.length,
    column_names: columns,
    preview: records.slice(0, 20),
    summary: {
      row_count: records.length,
      total_products_tracked: uniqueProducts,
      total_units_sold: totalDemand,
      total_sales: totalSales,
      average_daily_sales: validDateCount && datedDemand !== null ? datedDemand / validDateCount : null,
      has_inventory_columns: Boolean(stockColumn),
      inventory_health: stockColumn ? "Stock data available" : "Sales data only",
      demand_history: demandHistory,
      total_demand: totalDemand,
    },
    top_products: topProducts,
    categories,
    trend_granularity: validDateCount > 45 ? "monthly" : dateColumn ? "daily" : null,
    forecast_rows: forecastRows,
  };
}