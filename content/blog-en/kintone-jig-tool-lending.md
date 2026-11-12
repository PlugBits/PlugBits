---
slug: kintone-jig-tool-lending
lang: en
title: "How to manage tool and jig lending in kintone with standard features"
description: "Track tool and jig lending in kintone using process management status and related records—no plug-in needed. Here's how to set up checkout, return, and notifications."
date: 2026-11-11
theme: B
keyword: "kintone tool lending management"
product: none
approved: true
reviewed: true
translated_from_sha1: 32cc99984e36d37c075caa4bf6c28ae3145da81d
translated_at: 2026-11-11T17:32:46-05:00
---

To manage tool and jig lending in kintone, you can build the whole workflow with standard features: process management status combined with a related records list. Give your lending-record app a status field with "On loan" and "Returned," and set up an action to switch from one to the other so you have a record of who borrowed what and when. To see the lending status of multiple tools at a glance, you'll also need a related records list on the tool master app.

## Switching from "on loan" to "returned" with process management

Process management lets you configure, for each status, the status before an action runs, who's assigned to work on it, the conditions under which the action can run, the action's name, and the status after it runs. For a tool lending-record app, you can set "On loan" as the status before the action, "Return" as the action name, and "Returned" as the status after the action—and that covers the entire flow from checkout to return. If "Returned" is your final status, there's no need to configure any further steps after it.

## Assign a person in charge, and notifications go out automatically

When you configure an action, you can assign the person in charge of that status. If you assign your tool manager as the person in charge of the "On loan" status, confirming returns becomes part of that person's job. Process management automatically sends a notification to a user when they're assigned as the person in charge, and the record also shows up in that user's unprocessed items list on the portal—so you don't need to build a separate notification setup for the person in charge to notice when something is checked out. Note that anyone assigned as the person in charge needs permission to view that record.

## A related records list is what lets you see who currently has which tool

The lending-record app alone lets you track each checkout and return individually, but it doesn't give you a single view of which tools are currently on loan—that takes an additional setup. Add a related records list field to the tool master app, configured to show records from the lending-record app that match the tool code, and you'll be able to see that tool's full lending history on its own record details screen. Keep in mind that a related records list only displays records: whether a tool is currently on loan is still something a person needs to check by looking at the status on the lending-record side.

## Try the checkout action and confirm the notification and history

Once you've saved your process management settings, go to the lending-record app and actually run the "Return" action from the "On loan" status to confirm that the status switches to "Returned" and that the person in charge receives a notification. It's also worth checking that the tool's lending records line up correctly in the related records list on the tool master app—doing this early makes it easier to tell whether the setup will hold up once the number of tools grows.
