---
slug: kintone-related-records-or-condition
lang: en
title: "How to Show Related Records That Match Either of Two Conditions in kintone"
description: "kintone's Related Records field has a separate \"Filter Condition\" setting. Choosing \"Match any of the conditions\" gives OR-style filtering. Here's how to set it up, and its limits."
date: 2026-11-11
theme: A
keyword: "kintone related records OR condition"
product: none
approved: true
reviewed: true
translated_from_sha1: 22644582c4a1386c86236afd9419c25c890efb59
translated_at: 2026-11-11T17:33:07-05:00
---

In kintone, a Related Records field can be set up to show records that match either of two conditions. The standard settings include a "Filter Condition" section, and after adding multiple conditions there, choosing "Match any of the conditions" produces OR-style filtering. This filter condition, however, is layered on top of the main "Condition to display records" that you set first, so it cannot make the basic lookup condition itself reference multiple possible field pairs.

## The "Filter Condition" setting can show records matching either condition

In the Related Records field settings, besides the "Condition to display records" that determines the related app and the fields it references, there's a separate "Filter Condition" section. The official kintone help states: "To set multiple filters, click the plus-shaped Add icon on the right," and continues, "When you set multiple filter conditions, choose either Match all of the conditions or Match any of the conditions." This option is useful, for example, when a Related Records field on a customer master app should only list records that are either "urgent orders" or "this month's quotes."

## How to set it up

Open the settings screen for the Related Records field, and use the plus icon under "Filter Condition" to add a condition. After specifying the first and second conditions, select "Match any of the conditions" from the choices below, then save. Records matching either condition will now appear in the list. If you add three or more conditions, the same choice applies to all of them together.

## The main condition that determines the related app can't be set to multiple options

One thing to keep in mind: the core "Condition to display records" for a Related Records field — which field in the current app must match which field in the related app — can only be set as a single pair. The OR logic in "Filter Condition" is an additional filter applied to the records already returned by that one pair of fields; it cannot be used to register several possible field-pair combinations and display records that match any one of them (as of October 2026). For apps where there's only one reference axis, this limitation rarely causes problems.

## Deciding whether you need a second Related Records field

Before adding a filter condition, it helps to work out whether what you want to display is "either of two cases within the same reference axis," or "two different reference axes entirely." In the first case, the OR option under "Filter Condition" is enough. In the second case, you'll need to set up a separate Related Records field and check the results on two different sections of the screen. After saving the condition, it's worth checking in the actual app that records for both intended cases show up correctly in their respective lists.

