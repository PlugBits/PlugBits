---
slug: kintone-lookup-master-pitfalls
lang: en
title: "Why kintone Lookup values don't update when you edit the master record"
description: "kintone Lookup copies a value from another app once. Editing the master app later won't change records that already looked it up — a common trap with part numbers and vendor data."
date: 2026-10-29
theme: B
keyword: "kintone lookup field not updating"
product: none
approved: true
reviewed: true
translated_from_sha1: 6626f470c15cbfb45c5feaace6e0fe03663df745
translated_at: 2026-10-31T18:32:09-04:00
---

kintone's Lookup field copies a value from a record in another app (the master app) into your record. If you later change the unit price in a part number master or the contact person for a vendor, the value that was already copied into existing records does not change. Teams that don't know this run into a common trap: after a part number revision or a price change, old values stay in place and nobody notices.

## Changing the part number or price in the master doesn't update records that already looked it up

The official kintone help states: "Even if the record in the master data (referenced) app is changed, the value already retrieved through Lookup is kept as is. It does not automatically update to the latest value. Clicking [Copy] again overwrites it with the latest value." This is because Lookup performs a one-time copy; it is not a live sync with the source app.

On the shop floor, this shows up right when a part number master gets a price revision. Even if quotes and orders pulled in the unit price through Lookup, past records keep the old price, and only the records where someone clicks to re-copy pick up the new value. If revisions are rare, this default behavior is manageable, but the more frequent and widespread the changes are, the heavier the workload becomes.

## Reusing the same part number code causes trouble with bulk updates and reselecting records

A different problem shows up when, instead of issuing a new part number for every revision, a team keeps the same code and just changes the specification. The official kintone help states: "If the value of the field is duplicated within the app that is the master data (referenced), the target record cannot be identified when the file is imported, so the value cannot be updated." This means a bulk update by CSV import stops cold when the key is duplicated. The same applies to vendor codes: whether a key is unique or not determines whether the update succeeds.

## What to check before deleting a master record

What happens to an already-copied Lookup value when the source record is deleted, or when the user no longer has access to it, does not appear to be documented in the official kintone help (as of October 2026). Before making this kind of change, it's safer to use a test record and click [Copy] again to confirm how the field behaves.

## A Lookup field placed inside a table can only copy into fields in that same table

There's also a restriction when you place a part number Lookup field inside a table (subtable) for each row. The official kintone help states: "When a [Lookup] field is placed inside a [Table], the only fields that can be specified as the copy destination for the retrieved data are fields placed inside the same [Table] as the [Lookup] field." This means you can't copy to a field outside the table, and you can't specify a copy source from outside the table either (as of October 2026). To use the value in a calculation outside the table, you need either a separate calculated field or a second Lookup field set up outside the table.

If you're using Lookup for part number or vendor masters, the quickest way to avoid surprises is to confirm exactly how far changes propagate before you revise or delete a master record.

