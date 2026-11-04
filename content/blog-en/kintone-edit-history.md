---
slug: kintone-edit-history
lang: en
title: "Where to find kintone's record change history (and what you can't revert)"
description: "kintone shows who changed a record and when from the record details screen. Here's what Revert to this version can restore, and what it can't, as of October 2026."
date: 2026-11-02
theme: A
keyword: "kintone record change history"
product: none
approved: true
reviewed: true
translated_from_sha1: 79f136b1b4f389bd1a6567ce0c967e9bc0a0a788
translated_at: 2026-11-03T17:31:34-05:00
---

You can see who changed a kintone record, when, and which field was edited from the record details screen, under the History icon. Entries are listed newest first, and the fields that changed in each version are highlighted in green. Clicking "Revert to this version" restores the record to that version's content. However, process management status and assignee, along with the values of fields you don't have edit permission for, can't be restored to a past version (as of October 2026).

## Find change history from the record details screen

According to kintone's official help, to check a record's change history, click the History icon in the Comment field on the right side of the record details screen. Once opened, "the most recent changes are displayed at the top." For each version, "the fields that were changed in that version are highlighted in green," so you can spot what changed without scanning through every field, even in a record with many items. Because a new version is added every time the record is saved, you can check the history on the spot after someone edits a value.

## What "Revert to this version" can and can't restore

According to kintone's official help, clicking "Revert to this version" next to any entry in the History field restores the record to that version's content. Most fields can be restored this way, but there are two exceptions. First, "process management status and assignee can't be restored to a past version." For any version where the status or assignee changed, the "Revert to this version" option doesn't even appear (as of October 2026). Second, "the values of fields you don't have edit permission for can't be restored to a past version." If a field you don't have edit permission for changed, you can still see the change in the history, but you can't revert it (as of October 2026).

## Check which items you can't revert in your own app

Open the record in question and select a past version from the History icon. Check whether "Revert to this version" appears; if it doesn't, look at whether the process management status or assignee changed in that version. Next, if any fields in your app have edit permission restricted by field access settings, check whether those fields are highlighted in green in the change history. If a field is highlighted green but you can't revert it, that's a sign the restriction comes from permissions.

## Change history works per record, not as an app-wide audit log

According to kintone's official help, the History field on a record shows "when and by whom the record was created, and what was changed, version by version." You check this by opening the record details screen for each record individually. It isn't a feature for tracking, in one list, how many changes were made by whom across multiple records (as of October 2026). If you just need to compare a handful of records, the standard change history is enough, but if you're trying to find which records across a whole app have had a lot of changes, you still have to open and check them one by one.

