---
slug: kintone-outsourcing-management
lang: en
title: "Can kintone Track Outsourcing Progress and Deadlines Without Custom Code?"
description: "Process management status can track outsourcing progress, and reminder notifications can flag records with an approaching deadline. Coordinating with vendors themselves is outside standard features (as of October 2026)."
date: 2026-11-02
theme: B
keyword: "kintone outsourcing management"
product: none
approved: true
reviewed: true
translated_from_sha1: 4a9eb581250f90ed5056c997999fdbeeb7a51d5d
translated_at: 2026-11-03T17:32:08-05:00
---

If you want to manage outsourced work in kintone, you can track progress from request to inspection using process management status. If you want to be notified when a deadline is approaching, you can use a reminder notification tied to a date field. However, kintone does not have a standard feature for structuring communication with the outsourcing vendor itself (as of October 2026).

## Track Outsourcing Progress with Process Management Status

You can put the entire outsourcing flow, from placing the order to final inspection, into process management. The official kintone help documentation states that when you set up process management, your app gains information about which status a record is in, who (the assignee) is responsible for it, and what action should be taken next. Three statuses are configured by default, and you can add, delete, or rename statuses as needed. For example, you could rename the three default statuses to "Order Placed," "In Progress," and "Awaiting Inspection," then move a record to a "Completed" status using an action once inspection is finished. If your outsourcing flow has many statuses or complex branching, setting it up takes time, but tracking progress on a single screen is something process management can do out of the box.

## Use Reminder Notifications to Flag an Approaching Deadline

You can also get automatic notifications when a vendor's delivery deadline is approaching. Reminder notifications let you choose a date field as the base date, then specify how many days before or after that date a notification should be sent. The official kintone help documentation includes an example that uses a "Due Date" field, sending a notification at 9 a.m. on the day to records with a status of "Not Started." If you set your vendor's delivery date field as the base date and schedule the notification for a few days ahead in the morning, you won't forget to follow up. That said, the official documentation does not use the term "delivery date" from an outsourcing context specifically, so whether the due-date example applies cleanly to a vendor delivery date is not explicitly documented (as of October 2026).

## Checking How Process Management and Reminders Work Together in Practice

Create one test record and click the action button to confirm that the status moves through the steps in the order you intended. Next, enter a date close to today in the field you use for the delivery deadline, and check whether the notification arrives as configured. If no notification arrives, review which field type you set as the base date and double-check the status filter condition on the reminder.

## Communication with the Vendor Itself Falls Outside Standard Features

kintone does not have a standard feature for sending purchase orders to a vendor or for structuring the exchange of messages with them (as of October 2026). Both process management and reminder notifications are built to manage the state of records inside your organization; the process management help page does not mention using it to communicate with an outside company (as of October 2026). If you need to generate a purchase order document and send it to a vendor, you'll need a separate method, such as generating a printed report or attaching it to an email. Vendor information itself can be linked in using a Lookup field pulled from a master app. If internal progress tracking is all you need, the combination of process management and reminder notifications is enough. Once you need automatic delivery to the vendor, or direct data entry from the vendor's side, you're beyond what standard features can do.

