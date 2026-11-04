---
slug: kintone-register-multiple-records
lang: en
title: "How to Add Multiple Records to kintone at Once (Without Creating a File First)"
description: "kintone has no built-in way to register multiple records at once from the list screen (as of October 2026). Here's how file import compares to adding rows on screen."
date: 2026-11-02
theme: A
keyword: "kintone add multiple records at once"
product: gep
approved: true
reviewed: true
translated_from_sha1: ebe394a82538c2da652d642031668976bf874074
translated_at: 2026-11-03T17:32:33-05:00
---

kintone's record list screen and the add record screen have no built-in way to register several records in a single operation (as of October 2026). The only standard option is importing from a file. If you want to add records straight on screen without creating a file, a browser extension that opens the list view as a spreadsheet, lets you add rows, and saves them in bulk is one option worth considering.

## The standard screens have no way to bulk-register multiple records

The add record screen is built for entering one record at a time, and the list screen has no button for registering several records in a single action (as of October 2026). The official kintone help page on importing data from a file does not describe any way to bulk-register multiple records on screen without using a file (as of October 2026). Only two methods are available: importing a file, or adding records one at a time. If you only need to add a handful of records, adding them one by one is not much extra work. But if you need to add dozens of records at once, the standard on-screen operations alone will not get you there (as of October 2026).

## Adding rows on screen without creating a file

If you want to skip the work of preparing a file, there is a browser extension that opens the list screen as a spreadsheet, lets you add rows directly, and saves everything in bulk. According to Grid Edit Pro's product description, it lets you "edit the list view directly in spreadsheet format, add rows, and save them in bulk," and it also supports pasting copied Excel cells into the list. If you copy new data from Excel and paste it into the rows you've added in the list, then save, you can add multiple records without ever creating a file. If your existing file-import workflow already works well for you, there's no need to change it just for this.

## Checking how many rows you can add and save at once in your own list

Open the list screen and click the add-row button a few times to see how many empty rows appear. Copy several rows of data from an Excel sheet, paste them into the rows you added, and check whether each value landed in the right column. If the screen shows a count of unsaved rows before you save, check that the number matches how many rows you pasted. After saving, check that the number of records reflected in the kintone list matches what you intended to add.

## When your data is already in a file, file import is the better fit

If your data is already organized as an Excel or CSV file, and you also need to update existing records in bulk, file import is the better fit. File import can register new records and update existing ones in the same operation, which suits workflows built around a fixed file format. If your routine involves importing a file in the same format every month, file import gives you a more consistent process than adding rows on screen. Which method suits you better depends on whether you'd rather keep working directly on screen or your data is already organized as a file.

