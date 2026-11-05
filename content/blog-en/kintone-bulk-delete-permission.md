---
slug: kintone-bulk-delete-permission
lang: en
title: "What permissions do you need to bulk delete records in a kintone app?"
description: "Bulk deleting records in kintone requires the App Management and Delete Records permissions, plus enabling bulk delete in the app's settings first. Up to 50,000 records can be deleted at once, and deletions cannot be undone."
date: 2026-11-03
theme: A
keyword: "kintone bulk delete records permissions"
product: none
approved: true
reviewed: true
translated_from_sha1: 0867b8daa9af2684ec86dda0fafea5b59b7a699b
translated_at: 2026-11-04T17:30:28-05:00
---

To delete multiple records from a kintone list view at once, filter the list down to the records you want, then use Bulk Delete Records. Before anyone can do this, the app administrator must enable the bulk delete feature in the app's settings, and the user performing the action needs both the App Management and Delete Records permissions (as of October 2026). Only records the user has permission to delete will actually be deleted.

## Bulk delete works on a filtered set of records, and must be turned on in the app's settings first

Bulk delete is not a matter of checking boxes next to records one by one in the list view. The official kintone help describes the steps as starting with "Click the Filter icon, and specify the conditions for the records you want to delete," followed by "Click the Options icon, and click Bulk Delete Records." There is also a limit on how many records can be removed in a single operation: the help states "You can delete up to 50,000 records at one time." Just as important, there's a prerequisite: "Before you can bulk delete records, you need to enable the bulk delete feature in the app's settings." If this setting is left off, the Bulk Delete Records option simply won't be available (as of October 2026).

## Bulk delete requires both the App Management and Delete Records permissions

Performing a bulk delete requires specific permissions. The official help states: "The user performing this action must have both App Management and Delete Records selected in the app's permission settings." There's also a limit on scope: "Only records that the user has permission to delete can be deleted." If an app also has record-level permissions configured, a user needs delete permission on each individual record in addition to the app-wide Delete Records permission — otherwise those records will be skipped during a bulk delete (as of October 2026).

## How to check whether bulk delete is available and whether a user has record-level delete permission

Open the app's settings for the app in question and check whether the bulk delete feature is turned on. If it isn't, also check whether the account has the App Management permission needed to turn it on. Next, open the permission settings for whoever normally performs deletions and confirm that Delete Records is checked. For apps where record-level permissions are configured separately, also check the Delete permission within those record-level settings — this helps avoid a situation where some records are left behind after a bulk delete because the user lacked delete rights on them specifically.

## Deleted records cannot be recovered

Once records are deleted in kintone, whether through bulk delete or individually, there is no way to restore them. The official help states plainly: "Deleted records cannot be recovered" (as of October 2026). The two safeguards kintone documents are exporting records to a file to keep a backup, and restricting which users can delete records through the record-level permission settings. Because bulk delete can target a large number of records at once based on a filter, running it with the wrong filter conditions can cause significant damage — so it's worth double-checking the count and contents of the filtered records before executing the operation.

