---
slug: kintone-list-column-width
lang: en
title: "Why kintone list view column widths keep resetting (and how to make them stick)"
description: "In kintone, list view column widths save per login user and browser by default. Here's how an app administrator can set one shared width for everyone (as of October 2026)."
date: 2026-10-27
theme: A
keyword: "kintone list view column width not saving"
product: launcher
approved: true
reviewed: true
translated_from_sha1: d60b7cf3852e1690061b8ae5a6154f65bb264893
translated_at: 2026-10-29T18:32:02-04:00
---

If widening a column in a kintone list view goes back to normal the next time you open it, or your screen and a coworker's screen show different widths, that doesn't mean the setting "isn't being saved." By default, kintone saves column widths per combination of login user and web browser, so the width resets whenever the device or browser changes. If you want the same width for everyone, an app administrator can save it as part of the app's settings through a separate operation - but once that's done, any individual who changes the column width afterward will see their own setting take priority, which can make the layout look inconsistent again.

## Default column widths are saved per login user and browser combination

Dragging a field's border to resize a column in the list view is saved even with no customization at all. The official kintone help states that a changed column width is retained for the combination of login user and web browser, and is not shown when that combination changes. In other words, the setting is stored per person and per browser. The same person may see different widths on a work PC and a laptop, or a few members of a team may see different column widths even though they're looking at the same list - in most cases this simply means each person adjusted the columns separately and that individual change stuck, not that anything is broken.

For someone who only uses one PC, this narrow scope of saving isn't a problem. For people who use multiple devices, or for teams that want a consistent screen, it helps to know upfront that per-user saving alone won't be enough, so you can avoid unnecessary trial and error.

## Getting everyone the same width requires saving it to the app, and personal changes override it afterward

To show the same column widths to everyone, someone with app management permissions needs to go to the list view menu and choose to save the current column widths as part of the app's settings. The official help states that once this is done, the adjusted list becomes available to other users in the same way. However, this shared setting isn't absolute: the same help also notes that each user's own column width setting takes priority over it. If a team member has already changed their own column widths, that individual setting wins over the shared one, which is why some people's screens may still look different even after an administrator has aligned everyone.

For anyone who hasn't touched the column widths yet, the app's saved width simply applies, so this one operation is enough in most cases. If you want to realign people who have already changed their own widths, keep in mind that the personal setting takes priority, and talk to those individuals directly.

## How to check which state your app is in right now

You can check which state your app is currently in with the following steps. If the option to save the current column widths as part of the app's settings appears in the app settings menu at the top right of the list view, that means you have app management permissions. If it doesn't appear, you only have viewing-level permissions. Next, open the same list in a different browser and see whether the widths differ. If they differ, your own individual setting is in effect; if they match, either the shared setting or the default is still active. When you want to align a team, having each person check these two things makes it easy to narrow down who you need to talk to.

If you'd like to save your own column width patterns and switch between them, Grid Edit in the free Chrome extension PlugBits Launcher lets you keep column layouts as presets.

