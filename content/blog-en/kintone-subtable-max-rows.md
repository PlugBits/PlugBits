---
slug: kintone-subtable-max-rows
lang: en
title: "How Many Rows Can a kintone Table (Subtable) Hold in One Record?"
description: "kintone's official help page doesn't list a hard row limit for table (subtable) fields, but it recommends keeping each table to 10 fields and 100 rows, and explains what happens if you go over."
date: 2026-11-10
theme: A
keyword: "kintone subtable maximum rows limit"
product: none
approved: true
reviewed: true
translated_from_sha1: 7613ba25a44a03ae0f3e2a996930d0bc78b4978c
translated_at: 2026-11-10T17:32:59-05:00
---

kintone's table (subtable) field doesn't have a published hard limit on the number of rows you can add to a single record (as of October 2026). That said, the official kintone help page on limits and restrictions does include a recommendation: "We recommend using no more than 10 fields and 100 rows per table." Going past that guideline can slow down screen display and affect how records behave. The app-wide field limit is a separate number — "up to 500 fields per app" — and fields inside a table count toward that same total.

## There's no hard row limit, but kintone's help page gives a recommended guideline

The official kintone help page that lists limits and restrictions doesn't include a specific maximum for table rows (as of October 2026). Instead, it frames the number as a recommendation: "We recommend using no more than 10 fields and 100 rows per table." If your plan is to stack dozens of rows per record for things like process steps or parts lists, 100 rows is a ceiling you can reach surprisingly fast. It's not a hard stop — it's the point where things start to feel heavier. If your tables only hold a handful to a few dozen rows, this guideline isn't something you need to worry about.

## Going past 100 rows or 10 fields affects screen speed and record operations

The same help page goes on to say: "As the number of fields or rows in a table increases, screen display speed may slow down, and this can affect record operations and customizations." In practical terms, the more rows you add, the longer it can take to open a record, work with it, and run any customizations against it. There's also the app-wide field limit of "up to 500 fields per app," and fields placed inside a table are counted as "the number of fields placed in the table, plus 1." That means apps with multiple tables reach the 500-field ceiling faster than apps with none. Going over the recommended guideline doesn't mean the app stops working, but if both row count and field count are high, it's worth figuring out separately which one is actually driving the slowdown.

## Check where things start to feel slow before you add more rows

Before scaling up a table, create a single test record and add rows in stages — 10, then 50, then 100 — reopening the record details screen each time to compare how long it takes to display. At the same time, count the fields inside the table to confirm you're staying under 10. If a production app is already approaching the recommended row count, consider splitting the table into smaller tables, or redesigning it to keep only the rows you actually need. Treat the 10-fields/100-rows guideline not as a hard stop you hit after the fact, but as an early warning number — a way to catch slowdowns before they happen.

