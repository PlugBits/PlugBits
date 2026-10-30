---
slug: kintone-process-management
lang: en
title: "How to Track Which Production Step a Work Order Is In with kintone"
description: "kintone's Process Management status, tables (subtables), and Related Records lists can track which step each work order is in, though copying process rows for new work orders still has to be done by hand."
date: 2026-10-27
theme: B
keyword: "kintone track work order process status"
product: none
approved: true
reviewed: true
translated_from_sha1: 0bbfa191c330f1d521695e79aa327dc57c1dfbbd
translated_at: 2026-10-29T18:32:39-04:00
---

Most of the work involved in tracking "which process step is this work order in" inside kintone can be handled with standard features. The Process Management status can record the current process for each work order, and if a history of multiple steps is needed, a table (subtable) or a separate process app combined with a Related Records list can be used. What kintone does not do is automatically set up a new row for the next work order with the same process steps as the previous one — that still has to be created by hand every time.

## Track the current process step for each work order in a single record

To follow how far a work order has progressed, the basic approach is to list process names as the statuses in Process Management. Once Process Management is set up, the app adds information about which status a record is in, who the assignee is, and what action moves it forward. Status is a value that represents a record's current state; the default values are "Not Started," "In Progress," and "Completed," but these can be renamed to actual process names such as Cutting, Welding, Inspection, or Awaiting Shipment. Records assigned to a given user show an action button, and pressing it moves the status to the next process. For a workflow where processes run in a straight line, the Status column in the list view alone is enough to see which process every work order is currently in.

## To keep a record of each process step, use a table (subtable) or a separate process app with a Related Records list

If you also need to record the start time, end time, and person in charge for each process, use a table (subtable) or a separate app dedicated to process records. A table (subtable) is a field whose rows can be added or removed, and it is suited to managing multiple entries as a list. Placed inside the work order record, it lets you track process history within that same record. However, if a Lookup field is placed inside a table, the fields it can copy values into are limited to other fields within that same table. If you need to view process records across multiple work orders, it works better to create a separate process-record app, connect it to the work order via a Lookup field, and trace the records using a Related Records list. A Related Records list displays records whose values match a given field.

## Needing to see where work was stalling on the shop floor, in numbers

One account of turning around a loss-making manufacturing company describes how figuring out where costs were piling up, and where work was stalling on the shop floor, required looking at both the numbers and the shop floor itself ([Why a manufacturing GM started building kintone plug-ins](https://note.com/plugbits/n/n9ddb45afa0da)). Keeping a record of each process's status creates the foundation for tracking that kind of bottleneck in numbers later on.

## The manual work of recreating the same process rows for every new work order

What standard features do not provide is a setting that automatically duplicates the previous work order's process rows (subtable rows, or records in a process-record app) whenever a new work order is added. Neither the documentation for tables (subtables) nor the documentation for combining them with Process Management mentions any feature for duplicating the previous process structure when a new record is created (as of October 2026). If there are five processes, adding a new work order means adding five rows (or five records) by hand every time.

- Lookup fields inside a table (subtable) can be placed, but the fields they copy values into are limited to other fields within the same table: https://jp.kintone.help/k/ja/app/form/lookup/set_lookup (confirmed via WebFetch, 2026-10-22)
