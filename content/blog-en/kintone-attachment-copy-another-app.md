---
slug: kintone-attachment-copy-another-app
lang: en
title: "kintone: why attachment files can't be copied to another app automatically"
description: "kintone's Lookup field and App Action field mapping both exclude the Attachment field, so there is no standard way to auto-copy files to another app (as of October 2026)."
date: 2026-11-12
theme: A
keyword: "kintone copy attachment field to another app"
product: none
approved: true
reviewed: true
translated_from_sha1: 447cd3e2d58e94448172a3b034e108a06e1ade3f
translated_at: 2026-11-12T17:31:09-05:00
---

In kintone, the Attachment field cannot be selected as a source or destination in a Lookup field's "Copy Other Fields' Values" setting, and it cannot be chosen as a destination field in an App Action's field mapping either. Across both of kintone's built-in ways to carry field values into another app, the Attachment field is the one type left out (as of October 2026). If you need the same file in a second app, plan on uploading it again in the receiving app rather than expecting kintone to copy it for you.

## The Lookup field's "Copy Other Fields' Values" setting does not include attachments

A Lookup field can pull values from a matching record in another app using the "Copy Other Fields' Values" setting. kintone's official help lists which field types can be mapped as a source or destination for this copy, and it covers combinations such as text, number, date and time, and user selection fields. The Attachment field never appears in that list, either as a source or as a destination. For example, in a quote app with a drawing attached as a file, a Lookup field on an order app can still pull in the item number or quantity, but the attached file itself simply does not come along. Because text and number fields copy over without any trouble, it is easy to miss that the attachment is the one piece quietly left behind.

## App Actions can't set the Attachment field as a destination field either

The same limitation shows up in App Actions, which create a record in another app and map fields from the current record. kintone's official help states plainly that the Attachment field cannot be specified as a destination field. The Attachment field doesn't appear as a source field option either. In other words, neither Lookup nor App Actions give you a standard way to automatically carry an attachment into another app. The official help also notes that you cannot copy field values that are part of a Related Records field, so routing a file through a Related Records field isn't an option either. If you want to avoid storing the same file in two places, one approach is to keep the file only in the original app and let the receiving app trace back to that record through a Related Records field.

## How to check whether your own app excludes the Attachment field from copying

To confirm this in your own app, open the Lookup field's settings and look at the list of source and destination field candidates for "Copy Other Fields' Values" — the Attachment field will not appear there. If you're using an App Action, check the field mapping screen the same way and confirm that the Attachment field isn't selectable there either. Verifying this at the design stage makes it easier to settle on the assumption that attachments will always need to be handled separately from the rest of the record's data.

