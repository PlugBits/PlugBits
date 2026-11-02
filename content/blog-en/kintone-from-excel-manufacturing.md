---
slug: kintone-from-excel-manufacturing
lang: en
title: "Moving Excel Ledgers to kintone on the Shop Floor: Where to Start"
description: "Move master ledgers first. Ledgers with multiple tables per sheet, merged cells, or cross-sheet formulas can't convert directly to a kintone app (as of October 2026)."
date: 2026-10-30
theme: B
keyword: "kintone migrate excel ledgers manufacturing"
product: none
approved: true
reviewed: true
translated_from_sha1: 5a84d050643a3c644cc7aa20740fb87faa0ba5eb
translated_at: 2026-11-01T17:31:23-05:00
---

When a manufacturing site moves its Excel ledgers into kintone, the first ledger to migrate is not a transaction log but a "master" ledger: the kind of ledger that other ledgers look up. That's because Lookup fields, which connect one app to another, assume the referenced master app already exists. On top of that, a ledger with multiple tables on one sheet, merged cells, or formulas that span sheets cannot be converted directly into an app (as of October 2026). Decide the order and clean up the layout before you start migrating.

## Move the "master" ledgers that other ledgers look up to first

Move reference-side ledgers, such as an item master or a customer master, into kintone before anything else. A Lookup field pulls a record from the referenced app using one of these field types as the key: Text, Number, Calculated, Lookup, Link, or Record number, and then copies values from other fields in bulk through the lookup's field mapping settings. None of this works until the referenced app exists.

Purchase order logs and inspection records often paste in master-side columns such as item code, item name, and unit price as-is. If you build the transaction-side app before the master, every time you add a Lookup field you end up comparing and re-entering the same information by hand.

If your operation only has one ledger, the order doesn't matter much. The distinction matters when the same item code or customer name is duplicated across multiple ledgers. On sites with several ledgers, move the master first and connect the transaction-side ledgers to it with Lookup fields.

## Split ledgers with multiple tables on one sheet before migrating

The "Create an App from an Excel File" feature reads the first row as-is and turns it into field names. Whether it can correctly read a sheet where the header row repeats multiple times isn't documented in the official kintone help (as of October 2026). Manufacturing ledgers are often built so that a revision history continues right below an item list on the same sheet, so splitting each table onto its own sheet before migrating avoids confusion. Conditions you need to fix on the file side, such as merged cells or formulas, fall under a separate topic about Excel files that fail to import; this article focuses only on migration order.

## Check for merged cells and multi-table sheets in the app creation wizard's preview for each ledger

You can check which ledgers are ready to migrate first using the preview screen in the "Create an App from an Excel File" wizard. On the screen that confirms the field names shown in the first row, a header displayed with a number or symbol attached, such as "Address (2)*", signals a leftover merged cell. A header row that appears a second time partway down signals that the sheet has two or more tables on it.

Move ledgers that come through cleanly into the actual migration, and set aside the ones that don't. Running each ledger through this check one at a time is enough to settle the order of migration.

