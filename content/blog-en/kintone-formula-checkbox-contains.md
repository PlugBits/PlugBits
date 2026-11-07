---
slug: kintone-formula-checkbox-contains
lang: en
title: "How to check which Checkbox options are selected in a kintone Calculated field (CONTAINS function)"
description: "kintone calculated fields can't read Checkbox or Multi-choice values directly, but the CONTAINS function lets you test whether a specific option is checked, combined with IF, AND, and OR."
date: 2026-11-05
theme: A
keyword: "kintone CONTAINS function checkbox field"
product: none
approved: true
reviewed: true
translated_from_sha1: 3067f8d97bc6572199622c9ff65017b1d2c67177
translated_at: 2026-11-06T17:31:04-05:00
---

You can't put a Checkbox field's value directly into a kintone Calculated field, but the CONTAINS function lets you test whether a specific option is checked. CONTAINS returns true when the specified field contains a value that exactly matches the given text, and kintone's official help uses it as an example for checking whether a particular option is selected in a Checkbox or Multi-choice field (as of October 2026).

## Use CONTAINS to check whether one option is selected

The syntax in the official help is `CONTAINS(field code, "search text")`. As a Checkbox field example, the help introduces a formula that shows "Checked" when the option "Done" is checked, written as `IF(CONTAINS(Checkbox, "Done"),"Checked","Not checked")`. This formula references the field code, not the field's display name, and is set in the "Auto-calculate" setting of a Text field. In other words, it converts whether an option is checked into a different text string to display.

## Combine CONTAINS with AND or OR to check multiple options

When you need to base a condition on more than one option, combine CONTAINS with AND or OR. The official help shows a formula that displays "Weekend work" if either Saturday or Sunday is checked, written as `IF(OR(CONTAINS(Work days, "Saturday"),CONTAINS(Work days, "Sunday")), "Weekend work", "")`, and another that displays "Inspection complete" only if A, B, and C are all checked, written as `IF(AND(CONTAINS(Inspection, "A"),CONTAINS(Inspection, "B"),CONTAINS(Inspection, "C")),"Inspection complete","")`. If you only need to check one option, CONTAINS and IF are enough; use OR for "any of these" and AND for "all of these." The more options you add, the longer the formula gets as you line up more CONTAINS calls (as of October 2026).

## Test with sample records that toggle the checkboxes on and off

A formula using CONTAINS only matches when the search text is identical, character for character, to the Checkbox option's label. After setting up the formula, create test records with the checkbox both checked and unchecked, and confirm the resulting text switches the way you expect. For formulas that use AND or OR, it also helps to test with only one of the relevant options checked, and then with all of them checked, so you can catch cases the formula might miss.

