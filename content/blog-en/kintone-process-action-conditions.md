---
slug: kintone-process-action-conditions
lang: en
title: "How to Branch Approval Routes in kintone Process Management by Amount"
description: "Use the Conditions for enabling an action setting in kintone process management to show different approval actions, such as section manager vs. department manager approval, based on amount."
date: 2026-11-05
theme: A
keyword: "kintone process management conditions for actions"
product: none
approved: true
reviewed: true
translated_from_sha1: cc63b79ce2291aeb879a7e608bb8b03b8c8dd7e7
translated_at: 2026-11-07T17:31:24-05:00
---

kintone process management lets you set "Conditions for enabling an action" for each status. With this setting, you can show a "Section Manager Approval" action or a "Department Manager Approval" action from the same status depending on, for example, the expense amount on the record. Until a condition is met, the action button itself isn't shown to the person working on the record (as of October 2026).

## Branching into multiple actions from the same status using conditions

The official kintone help states that setting Conditions for enabling an action lets you configure process management that branches based on conditions. The example given is a case where, at the "Before Submission" status, the approver differs depending on the expense amount. The documented steps show a business rule such as "if the expense is under ¥100,000, send it to the Section Manager for approval" and "if the expense is ¥100,000 or more, send it to the Department Manager for approval," implemented with two separate actions — one with the condition "expense is 100000 or more" and the other with "expense is 99999 or less." A single status isn't limited to one action: you can place several actions, each with its own condition, on the same status.

## What you can use as a condition: field values, status, and assignee — and the fields you can't use

Conditions can reference a field value, the process management status, or the assignee. If you want to use the assignee as a condition, the official help notes that to select Assignee in Conditions for enabling an action, you need to check Enable process management and save the app once first — so complete that save step before trying to set an assignee-based condition. On the other hand, some field types can't be used in a condition at all: Multi-line Text, Rich Text, Label, Attachment, and Related Records fields are not supported (as of October 2026). If your approval route is simply decided case-by-case by a person, you don't need conditional branching, but this feature is a good fit when the threshold — such as an amount — is already fixed in advance.

## Testing with a record right at the boundary value to confirm the expected action appears

When a condition uses a numeric range, it's easy to end up with boundary values that don't quite line up, such as "100000 or more" and "99999 or less." After setting this up, create a test record with an amount that falls exactly on the boundary (in this example, exactly 100000) and check that the action you expect is the one that actually shows up. Testing one value on each side of the boundary lets you catch a mistake where a single digit in the condition causes both actions to appear, or causes neither one to appear.

