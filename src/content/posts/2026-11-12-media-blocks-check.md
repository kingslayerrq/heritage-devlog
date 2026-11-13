---
title: "Checking video, model and Blueprint blocks"
date: "2026-11-12"
discipline: "tech"
authors: ["author-1225896471812112426"]
summary: "A short technical check that uploaded clips, YouTube embeds, 3D models and Unreal Blueprint graphs render on the live journal."
tags: [Publishing, Tooling]
visibility: private
draft: false
---

The sample reference entry shows the syntax for richer blocks as code. This entry uses the real blocks with small placeholder assets, so the journal has a page where each one can be seen working after a normal Git submission.

## Uploaded video

A four-second generated test pattern, uploaded with the entry as an MP4.

<hx-video src="/media/2026-11-12-media-blocks-check/test-pattern.mp4" caption="Generated test pattern, uploaded with the entry"></hx-video>

## YouTube video

Longer footage is embedded rather than uploaded. This is the open film *Big Buck Bunny* from the Blender Foundation.

<hx-video youtube="aqz-KE-bpKQ" caption="Big Buck Bunny, embedded from YouTube"></hx-video>

## 3D model

A self-contained GLB with its geometry and material embedded. Drag to turn it.

<hx-model src="/media/2026-11-12-media-blocks-check/brass-cube.glb" alt="A brass-colored cube" caption="A placeholder cube exported as a single GLB file"></hx-model>

## Unreal Blueprint

Blueprint graphs are embedded from blueprintUE. This is a public sample graph, not project logic.

<hx-blueprint src="https://blueprintue.com/render/0ovgynk-/" caption="A public sample graph rendered by blueprintUE"></hx-blueprint>

## What this confirms

- [x] Uploaded MP4 playback
- [x] YouTube embedding
- [x] GLB model viewing
- [x] Blueprint graph embedding

Real entries should replace these placeholders with footage and assets from the project.
