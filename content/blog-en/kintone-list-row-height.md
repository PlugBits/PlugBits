---
slug: kintone-list-row-height
lang: en
title: "Why kintone list view text gets cut off instead of wrapping to a new line"
description: "No official kintone setting changes list view row height or wraps long text onto multiple lines (as of October 2026). Widening columns, trimming shown fields, or opening the record details screen are the standard workarounds."
date: 2026-10-31
theme: A
keyword: "kintone list view row height"
product: none
approved: true
reviewed: true
translated_from_sha1: 22657cea5b3f72b2abfdeedd01f5e14275e784cf
translated_at: 2026-11-02T17:31:41-05:00
---

For the common complaint that long text in the kintone record list screen gets cut off instead of wrapping onto multiple lines, and that there seems to be no way to make rows taller, a review of the official kintone help does not turn up any setting that changes list view row height or wraps cell contents onto multiple lines (as of October 2026). What's available as standard are three workarounds — widening a column, showing fewer fields, or opening the record details screen — not a feature that makes the row itself taller.

## No official setting for list view row height or text wrapping (as of October 2026)

For the table-style list view, the official help describes it this way: "Each field is displayed as a column, and each record is displayed as a row." Looking through the list view settings screen, the column width adjustment page, and the help page for the Text (multiple lines) field, there is no item for changing row height or for wrapping cell contents onto multiple lines (as of October 2026). For example, if several lines of meeting notes are entered in a Text (multiple lines) field, the list view only shows as much text as fits in that column's width on a single line, and the rest is truncated. This isn't a display bug — it's how the list view works by design, since it is built as a table where one row always equals one record, and no setting exists to change that.

## The standard workarounds: widen the column or show fewer fields

Row height can't be changed, but there is a standard way to fit more characters on that single line. The official help describes adjusting column width this way: "On the Record List screen, drag the border on the right side of the field you want to adjust." Widening the column for the field in question lets more characters show. You can also narrow down which fields are shown in the first place. The list view settings say: "From the fields on the left side of the screen, select the fields you want to display on the Record List screen and drag and drop them into the area on the right." Removing fields you don't need makes it easier to give more width to the columns you want to keep. Either way, though, this only increases how many characters fit on a single line — it doesn't wrap the text onto multiple lines. Since screen width is limited, fitting all of a long passage into the list view isn't realistic within the standard feature set.

## Checking the full text on the record details screen instead of the list view

Even without a setting that stops the list view from truncating text, there is a standard way to check a record's full content. The help for editing records explains: "Click the View Record Details icon on the left side of the record you want to edit." Opening the record details screen from a row in the list view lets you read a Text (multiple lines) field in full, without it being cut off by a column's width. To check how much text is being truncated in a given app, start by widening the column for the long text field and see whether it still gets cut off. If it does, open that record from the View Record Details icon and confirm whether the line breaks and the rest of the text you entered are still there. A short note of about one line is often fine with just a column-width adjustment, but if you need to read passages that run several lines long from the list, switching to opening the record details screen is the faster approach.

