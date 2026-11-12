---
slug: kintone-attachment-filter-presence
lang: en
title: "How to filter a kintone list view to show only records with attachments"
description: "kintone's Attachment field has built-in \"file exists\" / \"no file\" filter conditions, but they can misbehave once an app passes 100,000 records with files."
date: 2026-11-11
theme: A
keyword: "kintone filter records with attachments"
product: none
approved: true
reviewed: true
translated_from_sha1: ac98bb72609f56ea4cb9885ced0d5e81b8cf06c4
translated_at: 2026-11-11T17:31:43-05:00
---

You can filter a kintone list view by whether a record has an attachment. The standard filter settings include "file exists" and "no file" conditions, so you can narrow the list down to records with (or without) attachments using nothing but the default configuration. One caveat: in apps where the total number of records containing attachments goes over 100,000, this filter condition stops working correctly.

## Attachment fields have built-in "file exists" and "no file" conditions

kintone's list filter settings include a dedicated option for Attachment fields. According to kintone's official help, an Attachment field lets you filter records by whether a file has been attached. The condition names are "file exists" and "no file," which is different wording from the "is empty" and "is not empty" conditions used for Text (multi-line) fields. For apps like quotes or inspection photo logs, where whether a file has been attached is itself a sign of how far the work has progressed, this condition alone is enough to surface every record that's still missing its attachment.

## Setting up the filter condition

Open the list filter settings and select the Attachment field you want to filter on; "file exists" and "no file" appear as condition options. Choose one and save, and the list will show only the records matching that condition. You can also combine it with conditions on other fields, such as date or the person in charge, to build a filter like "assigned to me, with no attachment." Setting this up only takes a few clicks and doesn't require rebuilding the app.

## In apps with a large number of records, the filter may not work correctly

The "file exists" and "no file" conditions come with a record-count caveat. kintone's official help notes that once the total number of records containing attachments (regardless of whether a given record currently has one) exceeds 100,000, this filter condition no longer narrows the list correctly. For long-running apps such as order management or inspection record apps, where records with attachments have been piling up for years, it's safer not to rely on this condition alone. Instead, narrow the list first with a condition like a date range, then check the results. Also note that this condition can be selected in an app's test environment but won't filter correctly there, so it needs to be verified in the production environment.

## Check roughly how many records have attachments before you filter

Before setting up the condition, it helps to know roughly how many records in the app contain attachments overall. If an app is approaching the 100,000-record mark, check once whether the number of filtered results matches what you expect. If it doesn't, add conditions such as a date range or person in charge to narrow things down further before applying "file exists" or "no file." This makes it easier to get the result you actually intended. The more an app relies on attachment status to track how work is progressing, the more worth it is to check that rough record count ahead of time.
