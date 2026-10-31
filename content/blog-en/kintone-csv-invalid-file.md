---
slug: kintone-csv-invalid-file
lang: en
title: "Why kintone shows \"File contents are invalid\" when importing a CSV file (and how to fix it)"
description: "The kintone CSV import error \"File contents are invalid\" is usually caused by the line break character. Switch it to CR+LF or LF in a text editor to fix it."
date: 2026-10-28
theme: A
keyword: "kintone csv file contents are invalid"
product: none
approved: true
reviewed: true
translated_from_sha1: fb17ce8bc3e28c7789e06ef3c0b160af4bab607a
translated_at: 2026-10-30T18:31:09-04:00
---

When importing a CSV file into kintone, the message "File contents are invalid." appears because of the line break character used in the file. According to the official kintone help, kintone can only read CSV files whose line breaks are CR+LF or LF. If any other line break character is mixed into the file, this error appears. The fix is to open the file in a text editor that lets you choose the line break character, then save it again with CR+LF or LF selected. Character encoding, required fields, and date or number formats are not listed as causes of this particular error.

## The cause is the line break character: anything other than CR+LF or LF triggers it

The official kintone help states that kintone can import CSV files whose line breaks are CR+LF or LF. If a file contains any other line break character (for example, a lone CR used by older systems), kintone shows "File contents are invalid." when you try to import it. The official help does not specify which particular software is most likely to produce files with this problem (as of October 2026). This is a different issue from a character encoding mismatch (the kind that causes garbled text when a CSV is opened in Excel), so fixing the encoding will not resolve this error.

## The fix: change the line break character in a text editor

The official help describes two ways to fix this. One is to open the file in a text editor that supports choosing the line break character (such as Hidemaru Editor or TeraPad), then use "Save As" and select CR+LF or LF as the line break before saving again. The other is to delete the problematic line breaks in the same kind of editor and retype them using the Enter key before saving. If you are using a different editor, check its save dialog or preferences for an option to choose the line break character; if there is no such option, retype the line breaks manually instead. Either way, after saving, open the kintone import screen, check the preview, confirm the error no longer appears, and then import the file. The official help also recommends contacting support with a screenshot of the error screen and the CSV file attached if the problem does not go away.

## Character encoding, required fields, and table rows produce different error messages

A CSV import can also fail because of a character encoding mismatch, missing required fields, incorrect date or number formats, or incorrectly formatted table (subtable) rows. However, the official help explains that these cases display separate error codes, such as GAIA_IL16, GAIA_IL17, or GAIA_II02 through GAIA_II04, and are not listed as causes of the "File contents are invalid." message. When you run into an import error, first check whether the message is exactly "File contents are invalid." If it is, check the line break character. If a different error code appears instead, review the required fields or formatting that match that specific code.
