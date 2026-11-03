---
slug: kintone-notification-not-arriving
lang: en
title: "Why kintone notifications aren't arriving: a checklist for updates, comments and reminders"
description: "Troubleshoot missing kintone notifications by checking app/record/reminder notification settings, process management, mentions, and personal email notification settings per kintone help."
date: 2026-10-31
theme: A
keyword: "kintone notification not arriving"
product: none
approved: true
reviewed: true
translated_from_sha1: 59264f744c1f38fa7b1a560dea281fc094a4438f
translated_at: 2026-11-02T17:32:06-05:00
---

kintone notifications fail to arrive for different reasons depending on the type of notification, so you need to check the right place for each one. The kintone help page on app notification settings covers three kinds: app notifications, record notifications, and reminder notifications. On top of these, there are notifications sent when you become the assignee in process management, and notifications for comment mentions. kintone's official help states that notifications are not sent when no notification recipient is specified, when you act in a test environment, or when you act in an app that belongs to a private app group. The same symptom also shows up when an individual has turned off email notifications in their personal settings, or when an administrator has disabled the notification-sending feature.

## Work out which notification type you're actually missing

According to kintone's official help, app notifications are described as "notifications based on conditions involving operations performed on the app," record notifications are "notifications sent when a record meets specific conditions," and reminder notifications are "reminder notifications based on date and time conditions." Process management notifications are sent to the new assignee whenever an assignee changes. Comment mentions are notifications where, as kintone's help puts it, "if you are specified as a recipient (mentioned), the notification is sent to you." Before troubleshooting further, confirm which of these categories the missing notification belongs to, since the settings screen and the conditions differ for each.

## Check the notification recipient settings

kintone's official help states plainly: "Notifications are not sent in the following cases: when you perform operations on an app in a test environment; when you perform operations on an app that belongs to an app group set to [Private]; or when a record notification or reminder notification setting was saved without specifying a recipient." For record notifications specifically, the help adds: "You can save a condition notification setting without specifying a recipient. However, no notification is sent from a notification setting that has no recipient specified." In an environment with many apps, this means going through each app's notification settings one by one to confirm a recipient is actually set, since a saved setting with no recipient will look configured but will never send anything.

## Check whether your own updates are supposed to trigger a notification

For comments, kintone's official help includes this note: "If you mention yourself as the recipient when posting a comment, you will not receive a notification." For adding or updating records, no equivalent exclusion for the record owner's own actions appears in the official help (as of October 2026). A practical way to check this is a two-step test: first update a record and look for a notification addressed "to me," then mention yourself with @ in a comment and compare that no notification arrives. Because self-mentions are excluded by design, this is a common point of confusion that gets mistaken for a misconfigured notification setting.

## Check personal email notification settings and administrator-level settings

For personal settings, kintone's official help describes the steps as: click the gear-shaped [Settings] icon at the top of the kintone screen, click [Personal Settings], then "select whether to receive email notifications, which notifications to receive, and the format to receive them in," and click [Save]. The feature itself is described as "enabled by default," and "when this feature is enabled, each user can also choose whether to receive email notifications individually." If the feature has been disabled at the administrator level, an individual user's personal settings alone cannot turn email notifications back on. Whether a notification is still sent when the recipient user lacks permission to access the app is not documented (as of October 2026), so the checks you can perform are limited to personal settings and administrator-level settings.

