---
slug: kintone-fifo-inventory
lang: en
title: "kintone has no built-in FIFO inventory feature: how to set one up with standard tools"
description: "kintone has no automatic FIFO logic (as of October 2026). Here's how to combine a receiving date field with list view sort order to pick the oldest stock first."
date: 2026-11-11
theme: B
keyword: "kintone FIFO inventory management"
product: none
approved: true
reviewed: true
translated_from_sha1: 05beb68835efd093ccaaa7f5b852aff8e793828b
translated_at: 2026-11-11T17:32:31-05:00
---

kintone has no built-in feature that automatically enforces first-in, first-out (FIFO) picking (as of October 2026). With standard features, the best you can do is add a receiving date field to your records, sort the list view by that date in ascending order, and have whoever handles shipping pick from the top of the list. There's no way to build a mechanism that automatically assigns the oldest stock to an outgoing order using only standard features combined this way (as of October 2026).

## There's no automatic FIFO logic, so sort order by receiving date is the substitute

The list of things you can do with list view settings includes adding and duplicating views, changing the number of records displayed, and changing sort order, but it does not mention any feature for automatically picking the oldest stock first or enforcing FIFO (as of October 2026). What you can do is set the list view's sort order to receiving date ascending, so the oldest records appear at the top, and let a person choose which records to consume from there. The record for an outgoing shipment is not determined automatically.

## Combine a receiving date field with list view sorting

Set up a separate app for inbound and outbound records, apart from your item master app, and add a receiving date field to each inbound record. In the list view's sort order settings, you can choose a date, time, or date and time field to sort by, so setting this receiving date field to ascending order brings the oldest inbound records to the top of the list. When creating an outgoing record, open this list, select records from the top until you've covered the quantity needed, and log that consumption as an outbound record.

## If you stock multiple item numbers, sort by item number, then receiving date

List view sort order isn't limited to a single field. The official kintone help states, "You can specify up to five levels for sort order." If you set item number as the first level and receiving date (ascending) as the second, the oldest inbound record for each item number rises to the top within its own group. If you only track a single item number, sorting by receiving date alone is enough. Keep in mind that sort order only helps with finding records faster: tracking which inbound record was used for how many units, and how much stock remains, is still left to whoever creates the outbound record.

## Count your item numbers to check whether this setup will hold up

Once you've set the sort order to item number, then receiving date, check that the oldest inbound record for each item number actually appears at the top. From there, it helps to track how many different item numbers ship out per day and how many inbound records a single outgoing shipment typically spans, which gives you a sense of whether this setup can keep up with your operation. For items that ship frequently, setting up a separate filtered view for just that item number can cut down the time spent searching even further.
