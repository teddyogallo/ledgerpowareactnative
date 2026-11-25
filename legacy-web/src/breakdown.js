// Builds the category breakdown for a set of entries.
//
// Critically, this includes categories that no longer exist. Deleting a category
// does not reclassify past entries - they keep the name they were logged under -
// so a breakdown built only from the current category list silently omits them,
// and the rows stop summing to the reported total. Money going missing from a
// financial report is worse than an untidy list.
export function buildBreakdown(entries, categories) {
  const rows = categories.map((c) => ({
    id: c.id,
    name: c.name,
    icon_key: c.icon_key,
    color: c.color,
    exclude_from_total: c.exclude_from_total,
    orphaned: false,
    total: entries
      .filter((e) => e.category === c.name)
      .reduce((s, e) => s + Number(e.amount), 0),
  }));

  const known = new Set(categories.map((c) => c.name));
  const orphanTotals = new Map();
  entries.forEach((e) => {
    if (!known.has(e.category)) {
      orphanTotals.set(e.category, (orphanTotals.get(e.category) || 0) + Number(e.amount));
    }
  });

  orphanTotals.forEach((total, name) => {
    rows.push({
      id: `orphan:${name}`,
      name,
      icon_key: "more",
      color: "#5A5A5A",
      exclude_from_total: false,
      orphaned: true,
      total,
    });
  });

  return rows;
}
