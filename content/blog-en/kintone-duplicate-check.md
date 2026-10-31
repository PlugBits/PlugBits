---
slug: kintone-duplicate-check
lang: en
title: "Why kintone's \"Prevent Duplicate Values\" setting doesn't catch every duplicate record"
description: "A look at kintone's built-in duplicate value check: which field types support it, the 64-character limit, what happens when existing data already has duplicates, and its limits in tables and multi-field checks."
date: 2026-10-28
theme: A
keyword: "kintone prevent duplicate field values"
product: none
approved: true
reviewed: true
translated_from_sha1: 2620f4f9d43128edca835fcefa6b2d39678060d9
translated_at: 2026-10-30T18:31:52-04:00
---

kintone has a built-in field setting called "Prevent Duplicate Values," which can be turned on for Text fields (single line) and similar fields. Once enabled, records with a matching value can't be registered or updated. However, as of October 2026, the official kintone help does not document whether this setting works on fields inside a table (subtable), or whether it can check a combination of multiple fields at once.

## Turning on "Prevent Duplicate Values" blocks registering or updating a record with a matching value

kintone's field settings include a "Prevent Duplicate Values" checkbox. Once you check it and save, any record entered with the same value as an existing record can no longer be registered or updated. This stops duplicate order numbers or customer codes before they get entered.

The check only looks at the value of the single field where the setting is turned on. If your workflow only needs uniqueness within one field, this is enough on its own — but it does not check that field in combination with other fields (more on this below).

## The setting only works on Text fields (single line) and link-type fields, and input is limited to 64 characters

"Prevent Duplicate Values" is only available on Text fields (single line) and link-type fields (website address, phone number, email address). Fields like Number, Date, and Radio button don't even have this setting as an option. On top of that, the official help clearly states that the maximum input length is 64 characters, whether full-width or half-width.

If you want to keep short codes unique — serial numbers or order numbers, for example — the standard setting is enough. But for values longer than 64 characters, or for field types outside those two categories, there's no such setting available at all.

## If existing records already contain duplicate values, the setting itself can't be saved

"Prevent Duplicate Values" can't be saved if existing records already contain a duplicate value in that field. According to the official help, trying to save triggers the error "GAIA_UN35," and the setting won't take effect until the duplicates are resolved.

The official help describes a way to find duplicate values: use the Graph feature to create a summary table that counts records by value, then identify any value that appears two or more times as a duplicate. Checking your existing data for duplicates before turning on this setting for the first time can save you from getting stuck partway through.

## Duplicate checks on fields inside a table, or across a combination of fields, aren't documented in the official help

"Does this work on fields inside a table?" and "Can it check a combination of multiple fields?" are common questions about kintone's duplicate check. As far as can be confirmed, neither is documented in the official kintone help as of October 2026. Neither the page describing "Prevent Duplicate Values" nor the separate pages covering table (subtable) field restrictions mention this behavior.

The quickest way to check this in your own app is to add a Text field (single line) inside a table and see whether the checkbox appears the same way it does for a field outside the table. For a combination of fields, apply the setting individually to each field and confirm that each one is checked independently — this helps avoid design assumptions that don't hold up later.

If your workflow can guarantee uniqueness with just one field, you don't need to worry about tables or field combinations. But if your design calls for uniqueness across table rows, or across a combination of multiple fields, keep in mind that the standard setting has real limits here, and the official help doesn't document this behavior — plan your process accordingly.

