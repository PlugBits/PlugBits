---
slug: kintone-app-settings-history
lang: en
title: "How to See Who Changed kintone App Settings (and When)"
description: "App administrators can check the date, user, and a summary of changes in kintone's settings change history, though a few actions aren't logged (as of October 2026)."
date: 2026-11-04
theme: A
keyword: "kintone app settings change history"
product: none
approved: true
reviewed: true
translated_from_sha1: 1af315cbe68039d6c22d489505f7c39e766258c5
translated_at: 2026-11-06T17:30:20-05:00
---

If you need to know who changed a kintone app's settings and when, check the settings change history. From the app's settings screen, open the "Settings" tab, then "Operation Management," and click "Settings Change History" to see a list of dates, the user who made each change, and a summary of what changed. That said, a few operations are not recorded in this history (as of October 2026).

## Settings Change History shows the date, user, and a summary of each change

According to the official kintone help, app setting changes are "recorded along with the date and time, the user who made the change, and a summary of the change." Equivalent changes made through the REST API are also captured. Only users with administrator rights for that app can view this history, and a cybozu.com system administrator can view the history for every app. Even small configuration changes, such as adding a field or updating permissions, can be traced back to who made them and when. When more than one person in your organization has administrator rights for an app, this history gives you a way to confirm what actually happened instead of relying on memory.

## Key milestones, like publishing an app, are also recorded

The history doesn't just track configuration edits; it also records major milestones in an app's lifecycle. The official help lists "the app was made public," "the app was updated," and "changes to the app were canceled" as examples of significant actions that get recorded. Because saving a form edit doesn't take effect in the live app until you actually update it, knowing exactly when "the app was updated" happened lets you confirm when the new settings actually went into effect.

## Some operations are not recorded

The official help also spells out which actions are excluded from this history. As of October 2026, the following five operations are not recorded: downloading the app as a template, moving the app to a different space, deleting the app, restoring the app, and saving the app's maintenance mode settings. If an app quietly ends up in a different space, or a similar change happens, this history alone won't show it. Settings Change History isn't a complete audit log of every possible action—it only covers a defined set of operations, and it's worth keeping that scope in mind.

## Open the settings change history and scan for anything unexpected

Open the app's "App Settings" screen, go to the "Settings" tab, choose "Operation Management," and click "Settings Change History." Scan the list of dates, users, and change summaries starting from the most recent entry, and look for anything you didn't expect. If you suspect an operation that falls outside this history's scope, such as a space move or a template download, remember it won't show up here, and you'll need to check with the people involved separately.

