---
slug: kintone-app-copy
lang: en
title: "Copying an app in kintone: what carries over and what doesn't"
description: "Learn what settings carry over and what doesn't when you copy an app in kintone, and how reusing an app differs from exporting it as a template."
date: 2026-10-29
theme: A
keyword: "kintone duplicate an app"
product: none
approved: true
reviewed: true
translated_from_sha1: f0d5796be59b67a92c0d2aa43e11c7beb1ff1666
translated_at: 2026-10-31T18:30:44-04:00
---

kintone has a standard feature called "Reuse an App" that lets you build a new app based on an existing one. Settings such as the form and views carry over, but records and some integration settings do not. There's also another way to create a similar app — exporting it as a template — and the two methods cover different ground.

## How to copy an app using "Reuse an App"

From the portal's "Create App" icon, select "Reuse an App," choose the app you want to copy, click "Reuse App," make any changes you need, and click "Publish App" to finish. According to the official kintone help, this carries over settings such as the form and views, saving you the work of setting everything up from scratch. This action requires app administrator permissions, and the help explicitly states that this method cannot be used between different kintone domains.

## What carries over, and what doesn't

The official help states that settings such as the form and views carry over, while the app code, API tokens, webhooks, Slack integration, individual plug-in settings (only the enabled/disabled state carries over), the app administrator's notes, and record data do not carry over. The official help does not document (as of October 2026) how permissions, process management, or JavaScript/CSS customization are handled after copying. If you need to carry over records or external integrations as well, you'll need to take additional steps.

## The difference between "Reuse an App" and "Export App as Template"

Besides copying, you can also export an app's settings as a "template" and use that instead. The help explicitly states that templates can be transferred between different kintone domains, which copying cannot do. Templates also include any apps referenced by the app, and the help notes that an app cannot be exported if it references more than 100 apps; the page about copying apps does not mention how referenced apps are handled (as of October 2026). The help also explicitly states that templates do not include permission settings, but the copying page does not list permissions as an item that fails to carry over (as of October 2026). If you just need one more app in the same environment, copying is enough; if you need to bring referenced apps into a different environment too, use a template.

## What to check before you keep copying the same app for every job number or project

A new app created by copying is an independent app: it gets its own app code and starts with no records. If you keep copying the same app for each job number or project, it's worth confirming that list views and graphs only cover the records inside each individual app — which means you'll need to repeat the same setting changes across every copy, and manually add up totals across apps by hand. The extra work is small when you only have two or three copies, but once repeated setting changes and manual totaling start piling up, it's time to reconsider the premise of copying the app over and over. Copying is a simple, standard way to build a new app, but it's safest to use it knowing that every copy adds one more independent app to manage.
