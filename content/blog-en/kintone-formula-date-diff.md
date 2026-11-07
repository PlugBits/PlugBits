---
slug: kintone-formula-date-diff
lang: en
title: "How to Calculate the Number of Days Between Two Dates in a kintone Calculated Field"
description: "Learn the kintone formula (end date - start date) ÷ (60×60×24) that turns a date difference into days or weeks, with display format tips and a way to test it before going live."
date: 2026-11-05
theme: A
keyword: "kintone calculate date difference formula"
product: none
approved: true
reviewed: true
translated_from_sha1: 2a2d38d1b76d30c066df47e387e6948e620126a8
translated_at: 2026-11-06T17:31:23-05:00
---

To turn the difference between two dates into a number such as "days" or "weeks" in a kintone Calculated field, subtract one date field from the other and divide by the number of seconds in that unit. Dates are handled internally as UNIX time (in seconds), so one day can be expressed as 60×60×24. Set the display format to "Number," add a unit symbol, and the result of the calculation will display directly as a day count or week count (as of October 2026).

## Subtracting the start date from the end date and dividing by seconds per day gives you days

The official kintone help shows the formula for calculating days as "(End date - Start date) / (60*60*24)." In place of "End date" and "Start date," enter the field codes of the respective date fields. To get weeks instead, change the denominator to "60*60*24*7." For the display settings, set the display format to "Number," set the number of decimal places to "0," and enter a unit symbol such as "days" or "weeks," choosing to place it after the number. Because dates are handled as UNIX time in seconds, the formula also has to be written in seconds, which is why "one day" takes the form "60*60*24."

## If you want a readable date string instead, use the DATE_FORMAT function in a different type of field

If the goal isn't a day or week count but a date/time value displayed as a readable string, such as "November 5, 2026," a different function is needed. The official kintone help states that "the DATE_FORMAT function converts a date/time or date value into a string in the specified date/time format," with a format such as "DATE_FORMAT(date/time, \"YYYY/M/d\", \"Asia/Tokyo\")." This function is set up not in the Calculated field used for day counts, but in the "Calculate automatically" option of a Text field. Whether you want a numeric day count or a readable date string, the function you use and the type of field you enter the formula into are both different (as of October 2026).

## Test the formula with date pairs whose answer you already know before relying on it

Because date formulas rely on subtracting seconds under the hood, which isn't easy to see at a glance, it's worth testing a new formula right away with date pairs whose expected answer is already known. Use test records to confirm that entering the same date twice produces a difference of 0, and that two dates one week apart produce a difference of 7. If the result doesn't match what's expected, the divisor (60*60*24 versus 60*60*24*7) is the most likely place to check first.

