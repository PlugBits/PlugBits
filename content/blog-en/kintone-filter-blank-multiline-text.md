---
slug: kintone-filter-blank-multiline-text
lang: en
title: "How to Filter kintone Records by Blank or Non-Blank Text Area Field"
description: "kintone lets you filter list views by whether a Text Area field is blank or not, but with over 100,000 matching records the filter can silently return wrong results."
date: 2026-11-09
theme: A
keyword: "kintone filter by blank field"
product: none
approved: true
reviewed: true
translated_from_sha1: caf841e9ec9e177745584d22b6f4bed04d0f9305
translated_at: 2026-11-09T17:31:32-05:00
---

In kintone's list view filters, you can set a condition for a Text Area field to check whether it "is empty" or "is not empty." Whether you want to find records where a field was never filled in, or the opposite -- records where something was actually entered -- the standard filter feature handles both cases on its own. The one thing to watch for is that on apps with a large number of records, this condition may not filter correctly (as of October 2026).

## Text Area fields have "is empty" and "is not empty" conditions

From the filter icon on the list view screen, select a Text Area field as the field to filter by, and "is empty" and "is not empty" appear in the list of conditions. Choose one and select Apply to filter immediately, or select Save to keep it as a saved view for the app (Save only appears for users with app management permissions). Whether you want to pull only the records where a Notes or Remarks field (a Text Area field) actually has content, or the reverse -- flagging records where that field was left blank -- this single condition covers both situations.

## On apps with many records, the filter may not work correctly

The official kintone help states that for filtering or aggregation that includes an "is empty" or "is not empty" condition, once the number of matching records exceeds 100,000, a warning is displayed and the records are not filtered correctly. The help also notes that in the app's test environment, you can set this condition, but it will not filter correctly there either. This limitation goes unnoticed while an app has few records, but it becomes a real concern for operational apps that have accumulated several years' worth of data. When the warning appears, it's important not to simply trust and use the result as-is.

## Check your record count before relying on this filter

Before using this filter in production, check the list view screen to see roughly how many records the target app currently holds. Knowing where your app stands relative to the 100,000-record threshold lets you judge in advance whether you can trust the filter's results as they are.

