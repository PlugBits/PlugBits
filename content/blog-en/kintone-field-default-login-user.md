---
slug: kintone-field-default-login-user
lang: en
title: "How to Auto-Fill kintone's Assignee Field with the Logged-In User"
description: "Set a kintone User Selection field's default value to \"Login User\" so the person creating the record is auto-filled as assignee. Also covers how this differs from the Creator field."
date: 2026-11-05
theme: A
keyword: "kintone set login user as default value"
product: none
approved: true
reviewed: true
translated_from_sha1: 57ba2964919ac886b821b6a69845c4f2978ee7a0
translated_at: 2026-11-06T17:30:47-05:00
---

kintone has a built-in way to automatically fill the assignee field with the person who created the record. Set a User Selection field's default value to "Login User," and on the record creation screen, that field is automatically pre-filled with whoever is logged in at the time. The Creator field behaves similarly, but it can't be changed after the record is created — that's the key difference (as of October 2026).

## Setting a User Selection field's default value to "Login User"

According to kintone's official help, add a User Selection field to the app for entering the assignee, then open its settings from the gear icon on the form settings screen. Type "Login User" into the Default Value field, and you can select [Login User] from the suggestions that appear. You can also add [Login User] from the [Others] tab in the dialog. After saving the setting, run [Update App], then click [Update App] again in the confirmation dialog to apply it. No functions or formulas are required — you just pick the option from the list.

## Use User Selection, not Creator, if you need to reassign records later

kintone also has a Creator field that automatically records who created a record, but it can't be changed afterward. If all you need is a record of who originally created the record, the Creator field is enough. But if your workflow requires handing the assignment off to someone else later, you need a User Selection field with its default value set to Login User, not the uneditable Creator field (as of October 2026). Which one to use depends on a simple question: do you need to preserve a fixed record of the original creator, or do you need to move the assignment later?

## Confirm the default value actually tracks the login user, not a fixed name

Even after selecting "Login User" as the default value, it can look like a fixed name is entered, since the field simply shows whoever is logged in when you set it up. After applying the setting, log in with a different account, add a new record, and check whether the assignee field fills in with that account's name. This confirms the field is genuinely tied to the logged-in user rather than a fixed value, so there's no mix-up later.
