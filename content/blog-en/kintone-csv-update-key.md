---
slug: kintone-csv-update-key
lang: en
title: "How to Overwrite Existing Records When Importing a CSV File into kintone (Setting an Update Key)"
description: "To overwrite existing kintone records during a CSV or Excel import, choose record update and addition and set an update key field whose value never repeats across records."
date: 2026-11-03
theme: A
keyword: "kintone csv import update key"
product: none
approved: true
reviewed: true
translated_from_sha1: 87e6a424054345ad30eaf580df8f4b85c262513a
translated_at: 2026-11-04T17:30:59-05:00
---

To overwrite existing records in kintone from a CSV or Excel file, choose **Update and Add Records** when importing the file, then specify which field to use as the update key. If a record's update key value matches an existing record in the app, that record is overwritten; if it doesn't match any existing record, a new record is added instead (as of October 2026). The field you choose as the update key must have a value that never repeats across other records in the app.

## Choose "Update and Add Records" during import and set the update key

On the file import screen, you're first asked to select how the imported file should be reflected in the app, with two options: **Add Records Only** and **Update and Add Records**. If you choose Update and Add Records, you then configure which field in the app will serve as the update key and which column in the imported file corresponds to it. According to kintone's official help, an update key is "a field in the app used to link the app's records with the rows of the imported file." If you skip this setting and leave the import set to Add Records Only, every row in the file is added as a brand-new record, regardless of how many records already exist in the app.

## Pick a field whose value never repeats across other records

Not just any field can serve as the update key. Official kintone help states that the update key should be a field "such as Record Number or an order number, whose value does not overlap with any other record in the same app." Fields with exactly one value per record, such as an order number or a part number, work well for this purpose. If you use Record Number as the update key, the behavior is as follows: when the record number in the file matches the record number of a record already registered in the app, the matching record is updated with the data from that row of the file. If you choose a field whose values can repeat, kintone has no way to determine which single record should be updated.

## Checking whether your chosen update key field actually has unique values

Before relying on a field as your update key, open the list view for that field and sort it to check whether any records share the same value. If nothing turns up, try importing a small batch of records with Update and Add Records selected, then confirm that only the intended records were changed. If records you didn't expect to be updated end up changing, the update key value is likely duplicated somewhere.

## Rows whose update key doesn't match any existing record become new records

Even with Update and Add Records selected, if a row's update key value in the file doesn't match any record currently in the app, that row is added as a new record rather than updating an existing one. Even a file you intended purely for updates can end up creating extra records if the update key column's values are off by even a single character (as of October 2026). Before importing, double-check that nothing has rewritten the update key values on the CSV-generation side, and that full-width/half-width characters and leading or trailing spaces match the original data exactly.

