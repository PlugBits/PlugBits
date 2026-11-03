---
slug: kintone-default-value-not-applied
lang: en
title: "Why a kintone field's default value doesn't show up (and when it's not supposed to)"
description: "A kintone default value only shows on the screen for adding a new record. Editing, CSV import, and record reuse can show a different value instead. Here's what the official help says for each case."
date: 2026-10-31
theme: A
keyword: "kintone default value not applied"
product: none
approved: true
reviewed: true
translated_from_sha1: 37a01fc51709de945888e9fe98b045b5fe99ef94
translated_at: 2026-11-02T17:31:18-05:00
---

If a default value you set "isn't being applied," the first thing to check is which screen you're looking at. A default value is a setting that shows up in the input field on the screen for adding a new record. When you edit an existing record, update records through a CSV import, or reuse a record, a different value can appear instead of the default value. Depending on the field type, there may not even be a default value setting to begin with (as of October 2026).

## A default value only appears on the screen for adding a new record

A default value is a setting that displays in the input field on the screen for adding a new record. The help for the Text field explains that you set this "when you want to display a default value for the input field." The help for the Checkbox field specifies exactly when it applies: "On the screen for adding a record, the box is shown already checked." The Radio Button field setting is actually required, with the help stating, "For [Radio Button], you must set a default value." If the screen where the value didn't show up wasn't the record-add screen, check the other scenarios below instead.

## Default values don't carry over for editing existing records, CSV import, or record reuse

Outside of the screen for adding a new record, there are several places where the default value isn't applied as-is. When you use CSV import to update records and set a field to [Do not specify], the official help says: "For a new record: the field is left blank, or the default value is entered if one is set." "For an existing record: the existing value is not updated." The record reuse feature works the same way: "A record created through reuse is populated with all the values from fields that can be copied," meaning it carries over the original record's values rather than the default value. If the goal is to overwrite existing records with the default value, neither of these two features can do that (as of October 2026).

## Checking whether default values apply to App Actions and new table rows

Whether a default value is applied when a record is added through an App Action, or when a new row is added to a table (subtable), can't be determined from the official help documentation alone (as of October 2026). No mention of how default values interact with these features appears on the App Action settings page or on the table add/configuration page (as of October 2026). When in doubt, duplicate the app into a test environment and confirm the behavior there before changing settings in the production app.

## Some field types don't have a default value setting at all

Depending on the field type, there may be no default value setting to configure in the first place (as of October 2026). Text, Number, Date, Checkbox, and Radio Button fields all have a default value setting, but Calculated, Record Number, Attachment, and Related Records fields have no default value setting (as of October 2026). The Lookup field also has no "default value" setting; instead, it pulls in a value from another app's record through a separate mechanism called the "copied field" (as of October 2026). Expecting a default value on these fields won't work, simply because there's no setting for it.
