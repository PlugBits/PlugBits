---
slug: kintone-list-filter-basics
lang: en
title: "How to Filter Records in a kintone List View (and Save the Conditions)"
description: "Learn how to filter kintone list view records with the Filter icon and Apply button, why available operators depend on field type, and who can save filter conditions to an app."
date: 2026-11-03
theme: A
keyword: "kintone filter records in list view"
product: none
approved: true
reviewed: true
translated_from_sha1: 8f69151287f0fbae48bfc76db2f89533ca689e70
translated_at: 2026-11-04T17:32:36-05:00
---

To filter records on a kintone record list screen, click the Filter icon, add your conditions, and click Apply to change the display immediately. Which operators you can choose depends on the field type, and only users with app administration rights can save filter conditions so they stay with the app (as of October 2026).

## Add conditions from the Filter icon and click Apply to change the display

According to the official kintone help, "On the Record List screen of an app, you can filter records by specifying conditions," and the steps begin with "On the Record List screen, click the Filter icon." To choose which field to filter on, click the V-shaped button in the field selection area under Condition and pick a field from the list that appears, or type the field name directly. After setting your conditions, click Apply to show the filtered list for that session only. To remove conditions, use Clear All: clicking it "deletes all the conditions that have been added." Applying a filter itself does not require app administration rights (as of October 2026).

## Which operators you can choose depends on the field type

The range of filter operators available depends on the field type. For example, the official help notes that the "is any of" operator can be used with Text (single-line) fields, Link fields, and Lookup fields (only when the copy source is a single-line text or Link field). Filtering on Date fields works differently: in the example shown in the official help, to show only orders scheduled to be sold this month, you select "=" (equals) and then choose "This month" and "All." In other words, date filtering combines "equals" with a date range rather than offering the same list of operators as text fields (as of October 2026).

## Check whether the operator you want is available for a given field

Open the Filter icon on the list view you are working with and select the field you want to filter on. Open the operator dropdown and check whether the operator you expected, such as "is any of," appears in the list. If it does not, that field type likely does not support it, so look for a different operator to use or consider whether the field type can be changed.

## Only users with app administration rights can save filter conditions to the app

Filter conditions can also be saved so they remain with the app. However, the official help states, "Save: You can save the list of configured conditions in the app settings," and goes on to note that "the Save button is displayed only for users with app administration rights." For users without administration rights, the screen lets them apply a filter but does not show the option to save it at all (as of October 2026). The mobile version is even more limited: the official help states that "in the mobile version, you cannot save filter conditions regardless of whether you have app administration rights."
