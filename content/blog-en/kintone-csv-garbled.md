---
slug: kintone-csv-garbled
lang: en
title: "Why kintone CSV exports show garbled text in Excel (and how to fix it)"
description: "The cause is usually a character encoding mismatch. kintone lets you choose the encoding on export, and you can also change it when importing an already garbled CSV file."
date: 2026-10-27
theme: A
keyword: "kintone csv garbled text in excel"
product: none
approved: true
reviewed: true
translated_from_sha1: e61e2d7d22b3305b199cc43a3cc0ca0ee65d6a80
translated_at: 2026-10-29T18:30:27-04:00
---

When a CSV file exported from kintone shows garbled text (mojibake) in Excel, the cause is almost always a mismatch in character encoding. kintone's export feature lets you choose the character encoding, and selecting the format meant for opening files in Excel fixes the problem. If you already have a garbled file and need to import it, the import screen has a setting for changing the character encoding. The steps on the Excel side below are limited to what could be confirmed through Microsoft's official support documentation.

## Choose the right character encoding for Excel when you export

kintone's export feature includes an option for selecting the character encoding. The choices are UTF-8, UTF-8 with BOM, Shift-JIS, Latin1, and GBK/GB2312. The official kintone help describes "UTF-8 with BOM" as the format to choose when the exported file will be opened in a program like Excel. For the delimiter, it recommends choosing "comma" when opening the file in Excel. The help also notes that data containing variant characters or special characters requires choosing one of the UTF-8 encodings.

## If a file is already garbled, change the encoding on the import screen

Even if you did not notice the encoding mismatch at export time and ended up with a file in the wrong encoding, you can still fix it using the import feature. The CSV import screen has settings for [Character Code] and [Delimiter], and the official kintone help states that if the file's data is garbled, you should change the [Character Code] setting. Which encoding actually fixes the file depends on its contents, so plan on testing a few options while checking the preview.

## Check the export screen's options directly in your own app

The easiest way to see how these options are actually laid out is to open [Export to File] from the record list screen in your own kintone app, where the character encoding and delimiter settings appear side by side. The import side works the same way: opening the [Import from File] screen shows the same character encoding and delimiter settings. Neither screen requires app administrator rights to open, so when you run into garbled text, comparing these two screens first makes it easier to pinpoint where the encoding changed.

## What Microsoft's support site actually covers for the Excel side

On Microsoft's official support page about importing data using [Data] > [From Text/CSV], the documented steps cover changing the delimiter, but there are no documented steps for choosing a character encoding (as of October 2026). Excel's list of save formats for CSV files only includes CSV (Comma delimited), CSV (Macintosh), and CSV (MS-DOS), with no format description that explicitly specifies UTF-8 (as of October 2026). Rather than looking for a fix on the Excel side, it is more reliable to match the character encoding using kintone's export and import screens.

