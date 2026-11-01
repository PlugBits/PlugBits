---
slug: kintone-filter-and-or
lang: en
title: "Can You Mix AND and OR Conditions in a kintone Filter?"
description: "kintone filters apply only one rule to all conditions, either match all (AND) or match any (OR). Here's how to approximate mixed AND/OR logic and when to use a Calculated field instead."
date: 2026-10-29
theme: A
keyword: "kintone filter and or conditions"
product: none
approved: true
reviewed: true
translated_from_sha1: 94cd6b4c6273570cd4fd37f39ddce27773e48e50
translated_at: 2026-10-31T18:31:25-04:00
---

When you add more than one condition in kintone's filter dialog, you can only choose to match all conditions (AND) or match any condition (OR) for the whole filter — kintone does not let you mix AND and OR freely across conditions (as of October 2026). That said, choosing the right operator inside a single condition lets you effectively build a "(A or B) and C" filter. "(A and B) or C" falls outside what the standard filter supports, so you'll need a judgment Calculated field as a workaround instead. Once a filter works the way you want, you can save it as a view.

## Multiple conditions can only be set to "match all" or "match any," not a mix of both

When you add two or more conditions in the filter dialog, kintone shows a single "Match all of the following conditions" checkbox that applies to the whole set. Check it and the conditions are combined with AND; uncheck it and they're combined with OR — either way, the same logic applies to every condition. The official kintone help documentation illustrates this with an example like "To display records that meet both the customer name and sales month conditions, select Match All Conditions," and it does not describe any way to set a different combination method per condition (as of October 2026). Once you have three or more conditions, it's common to want AND and OR mixed together, which is exactly where this limitation shows up.

## You can effectively build "(A or B) and C" using the right operator inside a condition

Even though the overall combination method is fixed to one setting, you can get close to mixed logic by building OR logic into an individual condition. The official help documentation gives an example for "customer name is Company A or Company B, and sales month is this month": set the customer name condition's operator to "is one of" and enter both Company A and Company B, then add a separate sales month condition and set the overall filter to "Match all of the following conditions." This produces the equivalent of "(A or B) and C." However, this operator only works with Text fields, Link fields, or Lookup fields whose source field is a Text or Link field (as of October 2026) — it cannot be used with Number or Date fields.

## "(A and B) or C" is outside the standard filter — work around it with a judgment Calculated field

The official kintone help documentation explicitly states that "(A and B) or C" style filtering is not supported (as of October 2026). Because the filter only lets you pick one combination method for the whole set, there's no way to group A and B together and then combine that group with C using OR.

The workaround is to add a Calculated field that uses the IF function together with AND and OR functions to output a value such as "Match" or "No match." The official help documentation confirms that the IF function can be combined with AND, OR, and NOT functions to evaluate multiple conditions together. Once that judgment field exists, your filter can be reduced to a single simple condition, such as "equals Match," on that field. Note that adding a Calculated field to an app requires the appropriate permissions.

## Test with sample records before you trust a saved filter

Before saving a filter that relies on a clever operator or a judgment Calculated field, it's worth confirming it actually captures the records you intend — and only those records.

1. Create one test record for each of A, B, and C, plus one record that matches none of them.
2. Click "Apply" on the filter and check whether only the intended combination of records remains.
3. If you're using a Calculated field, compare the judgment result against each condition to make sure it's correct.
4. If everything behaves as expected, click "Save."

Since this only takes a handful of test records to compare, it's easy to verify the logic before relying on it in production.
