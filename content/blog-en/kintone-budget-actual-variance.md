---
slug: kintone-budget-actual-variance
lang: en
title: "How to Track Budget vs. Actual Variance in kintone for Manufacturing"
description: "Separate a budget master app from an actuals app, pull the budget with Lookup, and calculate variance automatically. Chart the trend on the app's top page."
date: 2026-11-09
theme: B
keyword: "kintone budget vs actual variance tracking"
product: none
approved: true
reviewed: true
translated_from_sha1: f35e356f26746ae20bd4b018fb57914a7a46fb2e
translated_at: 2026-11-09T17:31:10-05:00
---

Comparing budget and actual figures for each process or month in a separate Excel sheet means redoing the totals every time new actuals come in. The basic setup you can build with standard kintone features is to separate a budget master app from an actuals-entry app, pull the budget value into the actuals app with Lookup, and let a Calculated field work out the variance automatically. If you also want to see how the variance is trending, the chart feature can display it right on the same app's top page.

## Separate a budget master app from an actuals app and calculate the variance with a Calculated field

Create a master app that holds one record per budget amount, broken down by process and by month. In the app where actuals are entered, use Lookup to pull in that budget amount from the master app. On the actuals-entry side, place both the budget amount field brought in by Lookup and a field for the actual amount that users enter themselves, then add a Calculated field that works out "budget amount − actual amount" automatically. This removes the need to recalculate the variance by hand every time actuals are entered, and the size of the gap becomes visible the moment the data is entered.

## Chart the variance trend and show it on the same top page

To see how the variance is moving month by month or process by process, you can use kintone's chart feature. As the official kintone help explains, charts are built from the record list screen by aggregating numeric values or record counts, and any user can create one without needing administrator rights. A saved chart isn't tucked away on a separate screen either: it always shows the latest data right on the app's top page (the record list screen), so checking it after every round of actuals entry is enough to spot which process or month the gap is widening in. That said, according to the official kintone help, saving a chart's settings does require administrator permissions for the app.

## Decide which unit (monthly, by process, etc.) you want to track variance by before you start building

Before building out the master app and chart, decide whether you want to see the budget-versus-actual gap by month, by process, or both. What you decide to treat as a single record in the master app changes how Lookup matches records and what axis the chart aggregates on, so writing this unit down on paper first saves you from having to rebuild the structure later.

