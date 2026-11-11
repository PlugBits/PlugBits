---
slug: kintone-formula-error-causes
lang: en
title: "kintone Calculated Field Error? Here's How to Find the Cause"
description: "kintone splits calculated field errors into two groups: save-time errors from a bad formula, and record-time symbols like #ERROR! or #VALUE! from a bad value. Here's how to tell them apart."
date: 2026-11-10
theme: A
keyword: "kintone calculated field error"
product: none
approved: true
reviewed: true
translated_from_sha1: db3c24771a8393894bc61abce386b85bcbfee91f
translated_at: 2026-11-10T17:31:52-05:00
---

When a kintone calculated field throws an error, where you see the error tells you where to look for the cause. An error that appears while you're saving the field's settings points to a problem in the formula itself, such as a wrong field code or a circular reference. A symbol like "#ERROR!" that shows up in the value column when a record is entered points to a value that didn't work with the formula. The official kintone help documents these two situations separately, so checking which one you're in is the fastest way to narrow down the cause.

## Save-Time Errors Point to the Formula Itself

An error shown while you're trying to save a calculated field's settings is a problem with the formula's syntax or its field references. Official kintone help documents a message that reports a circular reference of fields, which appears when the formula points to itself, or to another calculated field that in turn points back to it. It also documents a message reporting that a field code used in the formula does not exist, which appears when the formula references a field code that isn't actually on the form. Full-width characters typed by mistake, wrong operators, or mismatched parentheses all produce this same kind of save-time error.

## Record-Time Symbols Point to a Mismatch Between the Value and the Formula

The symbols that appear in a field's value when a record is entered and saved belong to a different category than save-time errors. Official kintone help lists "#ERROR!", shown when the calculation includes something like division by zero; "#VALUE!", shown when the combination of operators and data types doesn't work, such as adding a number to a string; "#CONVERT!", shown when the result comes out as a string that can't be converted to a number or date; and "#PRECISION!", shown when the result exceeds the configured number of significant digits. This category only shows up once the formula has already been saved successfully — it's the specific combination of entered values that triggers it.

## First, Check Where the Error Appears

The first step in narrowing down the cause is simply noticing where the error shows up. If the error message appears while you're saving the field's settings screen, the problem is in the formula's syntax or in the fields it references. If a symbol appears in a record's value column instead, the problem is a mismatch between the entered values and the formula. Matching the specific symbol against the official kintone help list narrows it down further: "#ERROR!" points to things like division by zero or an exponent out of range, while "#VALUE!" points to an operator and data type that don't match. Even an admin who isn't the one who wrote the formula can use the symbol to describe the problem clearly when asking for help.

## Complex Apps May Need More Than Just This Split

Because save-time errors and record-time symbols are two separate mechanisms, this split from the official documentation is usually enough to point you in the right direction. There's one more case to watch for, though: for formulas that reference fields inside a table (subtable) and work with array-type values, official kintone help also lists a separate error reporting that an appropriate function isn't being used for an array-type value, which adds one more thing to check. In apps where calculated fields reference each other in a chain, it helps to check each field's formula to find which calculated field is the actual starting point of the reference before deciding what order to fix things in. Starting from these two basic categories is still the fastest way in.

