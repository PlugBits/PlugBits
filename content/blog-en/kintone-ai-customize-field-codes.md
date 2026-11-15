---
slug: kintone-ai-customize-field-codes
lang: en
title: "Why AI gets kintone field codes wrong (and how to fix it)"
description: "AI tools guess kintone field codes from field names instead of reading your app, which causes mistakes. Pasting the field code list and form JSON prevents this."
date: 2026-10-21
theme: A
keyword: "kintone get a list of all field codes in an app"
product: launcher
approved: true
reviewed: true
translated_from_sha1: 3716a559e9da9213d72a295db06bbfeae057a6c9
translated_at: 2026-11-14T17:31:02-05:00
---

When you ask an AI tool to write kintone customization code, it can invent a field code that doesn't exist, or use the code for a different field. This happens because the AI isn't looking inside your app — it's guessing the field code from the words you use in conversation. If you share the app's field code list at the start of the conversation, this mistake is almost entirely avoidable. This article is for app administrators running their own kintone environment, including small manufacturers building apps in-house, and explains how to hand that list over.

## Why AI guesses field codes wrong

AI doesn't look directly at an app's field settings. From a phrase like "the customer name field," it guesses at a plausible field code.

A field code is assigned automatically when a field is created and is a separate value from the field name (the label shown on screen). Words such as "Status," "Assignee," and "Category" are listed in kintone's official help as reserved words that can't be used as field codes, and when a code would duplicate an existing one or start with a number, kintone automatically appends a symbol.

If you ask the AI to "put a value into the customer name field" without this context, it writes something plausible like `customer_name` or `client_name`. If that doesn't match the actual code, saving the record either throws an error or silently fails to fill in the value with no error at all.

For a small app with only a handful of fields, where the administrator already knows every code by heart, describing fields in words alone sometimes works. But for apps with many fields, or apps inherited from someone else, this approach is more likely to miss, and handing over the actual codes is the safer bet.

## You can see the field code list with standard screens or the API, but it takes effort

To check a field code using the standard kintone screens, open the form settings and click the gear icon on the field to open its settings. The field code appears toward the bottom of that settings panel.

The catch is that you can only check one field at a time, so an app with 10 or 20 fields means repeating the same steps that many times. The REST API's "Get Form Fields" endpoint can retrieve all field codes at once, but it requires issuing an API token and setting up authentication, which is itself extra work for an administrator who doesn't normally write code. If your app has few fields, or you're comfortable working with the API, the standard approach is enough.

## Pasting the field list and JSON before asking AI for help

As more work involves building and maintaining kintone apps in-house, asking AI for customization code has become more common. At first, describing field names in words alone was the usual approach, and the AI sometimes came back with field codes that didn't actually exist in the app.

Now, the field code list gets pasted in at the very start of the conversation, and when Lookup field settings are also needed, the form settings get pasted in as JSON. This experience is described in more detail in the note article "The features I use every day in a self-built kintone extension, and the screens I stopped opening" (in Japanese).

https://note.com/plugbits/n/n998e60ca4337

Both the field code list and the form definition JSON can be copied for free from the command palette in the Chrome extension PlugBits Launcher.
