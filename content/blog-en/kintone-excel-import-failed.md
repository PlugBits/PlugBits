---
slug: kintone-excel-import-failed
lang: en
title: "Why kintone Won't Import Your Excel File: Official Format and Size Requirements"
description: "kintone only imports .xlsx files (Excel 2007 or later) within 1MB, 1,000 rows and 500 columns. Password protection, merged cells, multiple sheets and formulas can also block the import."
date: 2026-10-30
theme: A
keyword: "kintone excel file won't import"
product: none
approved: true
reviewed: true
translated_from_sha1: e02c6464bc648704b3d5cdd2041a8b7803863ca8
translated_at: 2026-11-01T17:30:53-05:00
---

kintone can create an app directly from an Excel file, but it only reads **.xlsx files created in Excel 2007 or later**, and only when the file meets the conditions listed in the official kintone help. If you choose an unsupported file format, a password-protected file, or a file that exceeds the size, row, or column limits, the import stops immediately and an error message appears. The cause isn't always the numeric limits — Excel-specific details such as the number of sheets, merged cells, formulas, and cell formatting can also block the import.

## Supported format is ".xlsx (Excel 2007 or later)" — older formats and password protection won't work

The official kintone help states that the supported format for creating an app from an Excel file is "Excel 2007 or later file format (.xlsx)." Excel 2003 workbook files (.xls) cannot be imported (as of October 2026). If the file is password protected, you're instructed to remove the password before selecting the file again. Even if the file extension is .xlsx, the import won't proceed if the content isn't recognized as a valid .xlsx file or if password protection is still in place. This commonly happens with old backup files or files created in other software where only the file extension was changed to .xlsx.

## Only one sheet can be imported at a time, and merged cells or formulas aren't carried over as-is

According to the official kintone help, even if a file has multiple sheets, you can only specify one sheet to import, and data on additional sheets can't be imported in the same operation (as of October 2026). If the first row of the range you're importing contains merged cells or blank cells, the field names generated for the app can change. If a cell contains a formula, only the calculated result is imported — not the formula itself — and cell display formats and conditional formatting aren't carried over to the app either (as of October 2026). Bringing in a nicely formatted summary table as-is can produce unexpected results here. A simple data-entry table without this kind of formatting won't run into these issues.

## What the error screen looks like when the import fails

The official kintone help lists the following message for an unsupported format: "The uploaded file's content could not be recognized as .xlsx. Please check the file's content." The same help topic also instructs that a password-protected file should be unprotected and saved again before uploading. When the file size exceeds the limit, a different message appears: "The file size of '(file name)' exceeds the limit." Checking which message you get tells you whether you're dealing with a format/password issue or a size-limit issue.

## Before creating an app, check which condition your Excel file runs into

Before importing, open your Excel file and check: whether the extension is .xlsx, whether it asks for a password when opened, which sheet you intend to import if there are two or more, whether the first row has any merged or blank cells, and whether the columns you want to import use formulas or special formatting. Checking these in advance saves you from having to redo the file. After that, confirm the file is within the limits of 1MB, 1,000 rows, and 500 columns, and you'll have covered most of the points where the import is likely to fail.

