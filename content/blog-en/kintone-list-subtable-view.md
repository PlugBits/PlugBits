---
slug: kintone-list-subtable-view
lang: en
title: "Can kintone Show Table (Subtable) Contents for Multiple Records in a List View?"
description: "kintone list views open subtable contents one record at a time, and the Help Center confirms you can't view multiple records' tables at once (as of October 2026). Here's how to spot row counts faster."
date: 2026-11-05
theme: A
keyword: "kintone show subtable in list view"
product: launcher
approved: true
reviewed: true
translated_from_sha1: cdd83aca1ccdb2d9e8865570a68d8136bf3a4628
translated_at: 2026-11-06T17:32:03-05:00
---

You can add a table (subtable) column to a kintone list view (the record list screen) using standard functionality. However, the contents aren't shown all the time — you have to click **Show** on each record to open it. The official Help Center states that you cannot display the table contents of multiple records at the same time (as of October 2026). If you need to compare many records at once, this behavior alone makes it slow to find the row you're looking for.

## Adding a table column to the list view only lets you open one record at a time

According to the official Help Center's steps, open the gear icon and choose **App settings** from the record list screen, go to the **Views** tab, add or edit a view, add the table you want to the view, and save. Once added, each record's row shows a **Show** link. Clicking it opens that record's table contents; clicking **Close**, or clicking **Show** on a different record, closes whatever was open. The Help Center notes that the table contents of multiple records cannot be displayed at the same time. If your workflow is to check records one by one anyway, this default behavior is enough as-is.

## If you just want to compare row counts first, you can change how the list looks

The pain point when you have many records to review is that you can't tell which rows actually have table content until you click **Show** on each one. The free Chrome extension PlugBits Launcher includes a feature called Grid Edit that opens the list view as a plain table, where table columns show the row count as a plain number. Opening the actual contents still works the same one-record-at-a-time way as the standard screen, but the difference is that you can scan the column first and narrow down which records have table rows, and how many, before opening anything. This is a good fit when knowing the row count is all you need.

## Before rolling it out, check how the layout looks with different row counts

Once you've added a table column to a list view, it's worth opening **Show** on both a record with many table rows and a record with none, to see how the displayed area changes size in each case. Check how "Show" itself looks for an empty table, and how far the list row height stretches for a table with many rows, directly in your app before you put it into regular use. That way you won't be caught off guard by layout shifts later.

