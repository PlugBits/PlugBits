---
slug: kintone-shortcut-keys
lang: en
title: "kintone Keyboard Shortcuts: The Full List (and What They Can't Reach)"
description: "A screen-by-screen list of kintone's built-in keyboard shortcuts for the record list, record details and notifications screens, plus what they can't do."
date: 2026-10-21
theme: A
keyword: "kintone keyboard shortcuts"
product: launcher
approved: true
reviewed: true
translated_from_sha1: 91c8ab1d37dcb3c8d15336bb40ae4da064ea04ca
translated_at: 2026-11-14T17:33:22-05:00
---

kintone comes with built-in keyboard shortcuts that let you work without touching the mouse. No setup is required, and they work on three screens: the record list screen, the record details/edit/add screen, and the notifications screen (click the "?" icon in the top right of any of these screens to see the shortcut list for that screen). This article lists the shortcuts for each screen and explains what they can't do.

## Navigate the record list screen with just the keyboard

On the record list screen, you can use the following keys.

| Key | Action |
|---|---|
| j / k | Select the next/previous record |
| Enter / o | Open record details |
| e / c | Edit/create a record |
| n / p | Go to the next/previous page |
| / | Focus the search box |
| ? | Show the shortcut list |

If your task is to check records one by one, these six keys alone get you through it without ever reaching for the mouse. For a job like opening a series of inspection records, j and k are all you need to move through the list. Since this is a standard kintone feature, no extra tool is required.

## The shortcuts carry over to the record details, edit and add screens

On the record details, edit and add (reuse) screens, the following keys work.

| Key | Action |
|---|---|
| j / k | Select the next/previous record |
| Ctrl+s | Save changes |
| Esc | Cancel editing |
| g → a / g → i | Return to the list/filtered results |
| / , ? | Search/show the shortcut list |

The flow of list → details → edit → save stays connected without ever leaving the keyboard. Anyone who does a lot of data entry will find it worth learning Ctrl+s for saving, if nothing else.

## The notifications screen works the same way

The notifications screen has its own set of shortcuts.

| Key | Action |
|---|---|
| j / k | Select the next/previous notification |
| Enter | Open the notification |
| x | Toggle read/unread |
| g → a/m/u | Switch between filters |

On a day when notifications pile up, j, k and x alone let you skim through all of them. If you don't normally open notifications, you won't need these.

## What these shortcuts can't do

All of the shortcuts above speed up actions within a screen. They don't help with switching between screens, and in particular, there is no built-in way to jump straight to a settings screen, such as plug-in settings, JavaScript/CSS customization, permissions, or notification settings (as of October 2026). None of kintone's official shortcut lists mention this either.

For anyone building and maintaining kintone apps on an ongoing basis, this is where the gap starts to matter. The more apps an admin manages, the more often they repeat the same path: gear icon → settings tab → the setting they're after. This unresolved friction around navigating to settings screens was the reason a tool was built, as described in an earlier note (https://note.com/plugbits/n/nc648a8a99f2e).

For working with lists and records, the built-in shortcuts are enough on their own. If you rarely change settings, you don't need anything more. But even if you learn every shortcut in this article, jumping to a settings screen is still outside what they cover.

A free Chrome extension fills in just that one gap: jumping straight to a settings screen, which kintone's standard shortcuts don't cover. PlugBits Launcher opens a command palette with Ctrl+/, and typing a few letters like "plugin" or "js" takes you directly to that app's settings screen.
