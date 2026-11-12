---
slug: kintone-subtable-fixed-rows
lang: en
title: "Can you lock the number of rows in a kintone table (subtable) field?"
description: "kintone table (subtable) fields have no setting to lock the row count or block adding/deleting rows (as of October 2026). Here's what admins can do instead."
date: 2026-11-11
theme: A
keyword: "kintone fix the number of rows in a table (subtable) field"
product: none
approved: true
reviewed: true
translated_from_sha1: 555cb7b5f533e7951e9c499348b3b26b39db845f
translated_at: 2026-11-11T17:33:27-05:00
---

Table (subtable) fields in kintone have no setting that blocks adding or deleting rows, and no setting that locks the row count at a fixed number (as of October 2026). The official help also does not describe any setting for specifying how many rows a table should start with on the record creation screen (as of October 2026). If a team wants every new record to start with a fixed set of rows, the workaround is to reuse a sample record that already has the rows lined up. Either way, the standard behavior stays the same: whoever opens a record can add or remove rows every time.

## Table fields have no setting to fix the number of rows

The official help page on table field settings does not mention any option for blocking row additions or deletions, or for setting an upper or lower limit on the number of rows (as of October 2026). The only sentence on the page that touches row operations is a note that "you can add or remove rows in a table on each record," and it describes this as standard behavior rather than something that can be restricted. Even in cases like inspection checklists, where a fixed number of rows is really what's needed, there is no dedicated setting to lock the row count.

## Adding and removing rows is always available to anyone editing the record

The official help explains that to add a row, click the "+"-shaped "add a row" icon, and to delete a row, click the "−"-shaped "delete this row" icon; both icons sit alongside each row of the table on the record creation and edit screens. Even for an app where inspection items are managed as a 10-row table, if someone accidentally deletes a row and saves the record, that one record ends up with a different row count than the rest. Catching that kind of discrepancy later, by scrolling through the list view or opening the table contents, is not easy.

## To start from a fixed set of rows, reuse a sample record

Setting a default value on a field inside a table only fills in that field's default value; it does not increase the number of rows shown on the record creation screen. If every new record needs to start with a fixed set of rows, create one sample record with, for example, 10 rows of inspection items already filled in, then reuse that record whenever a new one is needed. The official help states that the "reuse this record" icon fills in all the field values that can be copied over, and you then edit just the parts that need to change. However, the page does not clearly state whether table rows are carried over when a record is reused, so test it on one record before relying on it in production. This won't stop someone from adding or removing rows afterward, but it does save the person creating the record from having to build every row from scratch.

## Checking existing records for row-count drift

Open a few records that use the table field in question and confirm whether the add-row and delete-row icons are actually available for editing. Next, reuse the sample record to create a new record and check whether the row count matches the sample right after it opens. From there, review the row counts in records already in use—through the list view or by opening the table contents—and note how far they've drifted from the sample. That gives a concrete basis for deciding whether the current operation can keep running as-is, given that the row count can't be locked.
