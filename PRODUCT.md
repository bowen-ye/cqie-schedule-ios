# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Existing static HTML, CSS, and JavaScript application, delivered as an installable PWA and reused by the Android and iOS native wrappers.

## Users

Chongqing Institute of Engineering students checking their own timetable, primarily on iPhone in short, repeated sessions between classes.

## Product Purpose

Turn the official academic system's dense, overlapping timetable data into a fast, legible personal schedule. Success means a student can identify the next class, time, and room within seconds without courses obscuring one another.

## Positioning

The product reads the student's official timetable but owns the presentation layer: conflicts are detected, dense weeks become a day-focused mobile agenda, and the same cached schedule remains useful offline.

## Operating Context

The intended Safari flow is blocked because the school's OAuth client rejects external callback URLs. Until the school adds an approved callback, iPhone users must install the native wrapper, which safely intercepts the school's registered callback. Account credentials remain on official school pages. Timetable and OAuth tokens stay on the student's device.

## Capabilities and Constraints

- Official CAS/OAuth login and direct read-only timetable API access in the native wrappers; external web callbacks are confirmed blocked by the school's allowlist.
- Week, today, next-class, course details, offline cache, and manual entries.
- iOS requires the user to perform Safari's final Share > Add to Home Screen action; websites cannot trigger it automatically.
- Mobile schedules must never overlay course content. True conflicts remain visible and explicitly identified.
- Public deployment is deliberately deferred until the user approves it.

## Brand Commitments

The product name is `cqie课表`. Its language is direct, calm, and student-oriented rather than promotional.

## Evidence on Hand

The repository contains the working Android application, iOS wrapper, official API mappings, and the existing H5 timetable implementation. No fabricated school endorsements or usage claims may be added.

## Product Principles

- Show the next useful fact first.
- Never trade legibility for a seven-column screenshot.
- Keep credentials inside official login surfaces.
- Preserve every returned course, including conflicts and online courses.
- Make offline and failure states useful rather than empty.

## Accessibility & Inclusion

Touch targets must be at least 44px on mobile, text must remain readable without zoom, focus states must be visible, and reduced-motion preferences must be respected.
