---
slug: kintone-formula-substring
lang: en
title: "Why there's no LEFT, RIGHT, MID, or SUBSTRING function in kintone's calculated field"
description: "kintone's list of calculated field operators and functions has no LEFT, RIGHT, MID, or SUBSTRING function. The only string operator is & for concatenation (as of October 2026)."
date: 2026-11-12
theme: A
keyword: "kintone calculated field extract substring"
product: none
approved: true
reviewed: true
translated_from_sha1: ee7b96df6ab0a035033e715dc80fef3903ca2132
translated_at: 2026-11-12T17:32:14-05:00
---

kintone's calculated field has no function for pulling out part of a string. The official help page's list of operators and functions only covers arithmetic operators (+ - * / ^), comparison operators, the string concatenation operator "&", and the functions SUM, YEN, DATE_FORMAT, IF, AND, OR, NOT, the ROUND family, and CONTAINS. Functions that extract part of a string, such as LEFT, RIGHT, MID, or SUBSTRING, are not on the list (as of October 2026).

## There's no function for extracting part of a string in the calculated field function list

kintone's help page "List of Operators and Functions" enumerates every operator and function that a calculated field can use. The only operator that works on strings is "&", used for concatenation, and there is no mention at all of a function that pulls out part of a string. That means something like showing only the first 3 characters of a product code in a separate field can't be done with a calculated field alone. Admins who have used LEFT or MID in spreadsheet software naturally look for the same kind of function here, but kintone doesn't have one.

## The only string operator is concatenation (&) — IF and CONTAINS do something different

The only string operation a calculated field supports is joining the values of multiple fields together with "&" into one string. IF and CONTAINS can switch which string is displayed based on a condition, but that's a different mechanism from "extracting part of the original string." For example, if you want to classify records by just the first few characters of a product code, a calculated field can't do it. Setting up a separate field for classification instead — a drop-down field filled in at input time, for instance — keeps the solution inside kintone's standard functionality.

## Check the list of available functions directly in the calculated field setup screen

To confirm this for a specific app, open the calculated field's setup screen and look through the function suggestions and help links to see which functions are actually available. Once you've confirmed that no function named LEFT, MID, RIGHT, or SUBSTRING shows up in the suggestions, you can plan the field design around the fact that extracting part of a string isn't something a calculated field can do.

